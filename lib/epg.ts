import crypto from 'node:crypto';
import { prisma } from './prisma';

export type EpgProgram = {
  id: string;
  epgChannelId: string;
  channelId: number | null;
  title: string;
  subTitle: string | null;
  description: string | null;
  category: string | null;
  icon: string | null;
  start: Date;
  end: Date;
};

type EpgChannelInput = {
  id: string;
  displayName: string;
  displayNameEn: string | null;
  icon: string | null;
  url: string | null;
};

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function textOf(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, ' ').trim()) : null;
}

function attrOf(tag: string, attr: string) {
  return tag.match(new RegExp(`${attr}=["']([^"']*)["']`, 'i'))?.[1] ?? null;
}

function parseXmltvDate(value: string) {
  const raw = value.trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, sign, oh, om] = match;
  if (!sign) return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  const base = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const offset = (Number(oh) * 60 + Number(om)) * 60_000 * (sign === '+' ? 1 : -1);
  return new Date(base - offset);
}

function normalizeName(value: string) {
  return value.toLowerCase()
    .replace(/[\u200c\u200d]/g, ' ')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[ًٌٍَُِّْ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function stableId(input: string) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

export function parseXmltv(xml: string) {
  const channels: EpgChannelInput[] = [];
  const programs: EpgProgram[] = [];

  for (const match of xml.matchAll(/<channel\b([^>]*)>([\s\S]*?)<\/channel>/gi)) {
    const tag = match[1];
    const block = match[2];
    const id = attrOf(tag, 'id');
    const displayName = textOf(block, 'display-name');
    if (!id || !displayName) continue;
    channels.push({ id, displayName, displayNameEn: null, icon: attrOf(block.match(/<icon\b[^>]*>/i)?.[0] ?? '', 'src'), url: null });
  }

  for (const match of xml.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi)) {
    const tag = match[1];
    const block = match[2];
    const channel = attrOf(tag, 'channel');
    const start = parseXmltvDate(attrOf(tag, 'start') ?? '');
    const end = parseXmltvDate(attrOf(tag, 'stop') ?? '');
    const title = textOf(block, 'title');
    if (!channel || !start || !end || !title || end <= start) continue;
    const category = textOf(block, 'category');
    const icon = attrOf(block.match(/<icon\b[^>]*>/i)?.[0] ?? '', 'src');
    programs.push({
      id: stableId(`${channel}|${start.toISOString()}|${end.toISOString()}|${title}`),
      epgChannelId: channel,
      channelId: null,
      title,
      subTitle: textOf(block, 'sub-title'),
      description: textOf(block, 'desc'),
      category,
      icon,
      start,
      end,
    });
  }

  return { channels, programs };
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'user-agent': process.env.SOURCE_HTTP_USER_AGENT || 'MomSatEPG/1.0' },
    signal: AbortSignal.timeout(Number(process.env.EPG_FETCH_TIMEOUT_MS || 20000)),
  });
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.text();
}

export async function syncEpg() {
  const urls = Array.from(new Set((process.env.EPG_XMLTV_URLS ?? '').split(/[\n,]/).map(v => v.trim()).filter(Boolean)));
  if (!urls.length) return { status: 'unconfigured' as const, sources: 0, channels: 0, programs: 0 };

  const payloads = await Promise.all(urls.map(fetchText));
  const parsed = payloads.map(parseXmltv);
  const channelInputs = Array.from(new Map(parsed.flatMap(p => p.channels).map(c => [c.id, c])).values());
  const programInputs = parsed.flatMap(p => p.programs);

  const dbChannels = await prisma.channel.findMany({ select: { id: true, name: true, nameEn: true, url: true } });
  const byName = new Map<string, number>();
  const byUrl = new Map<string, number>();
  for (const channel of dbChannels) {
    for (const name of [channel.name, channel.nameEn]) {
      if (name) byName.set(normalizeName(name), channel.id);
    }
    try { byUrl.set(new URL(channel.url).toString(), channel.id); } catch {}
  }

  const matched = new Map<string, number>();
  let matchedChannels = 0;
  for (const channel of channelInputs) {
    const idMatch = dbChannels.find(c => normalizeName(c.name) === normalizeName(channel.id) || normalizeName(c.nameEn) === normalizeName(channel.id));
    const channelId = byName.get(normalizeName(channel.displayName)) ?? idMatch?.id ?? null;
    if (channelId) { matched.set(channel.id, channelId); matchedChannels++; }
    await prisma.epgChannel.upsert({
      where: { id: channel.id },
      update: { displayName: channel.displayName, displayNameEn: channel.displayNameEn, icon: channel.icon, url: channel.url },
      create: { id: channel.id, displayName: channel.displayName, displayNameEn: channel.displayNameEn, icon: channel.icon, url: channel.url },
    });
  }

  const horizonDays = Math.max(1, Math.min(30, Number(process.env.EPG_HORIZON_DAYS || 7)));
  const cutoff = new Date(Date.now() - 6 * 60 * 60_000);
  const horizon = new Date(Date.now() + horizonDays * 24 * 60 * 60_000);
  const activePrograms = programInputs.filter(p => p.end > cutoff && p.start < horizon);
  await prisma.program.deleteMany({ where: { end: { lt: cutoff } } });

  for (const program of activePrograms) {
    await prisma.program.upsert({
      where: { id: program.id },
      update: { channelId: matched.get(program.epgChannelId) ?? null, title: program.title, subTitle: program.subTitle, description: program.description, category: program.category, icon: program.icon, start: program.start, end: program.end, epgChannelId: program.epgChannelId },
      create: { id: program.id, channelId: matched.get(program.epgChannelId) ?? null, title: program.title, subTitle: program.subTitle, description: program.description, category: program.category, icon: program.icon, start: program.start, end: program.end, epgChannelId: program.epgChannelId },
    });
  }

  return { status: 'ready' as const, sources: urls.length, channels: channelInputs.length, matchedChannels, programs: activePrograms.length };
}

export async function getEpg(options?: { channelId?: number; from?: Date; to?: Date }) {
  const from = options?.from ?? new Date();
  const to = options?.to ?? new Date(from.getTime() + 24 * 60 * 60_000);
  return prisma.program.findMany({
    where: { channelId: options?.channelId, start: { lt: to }, end: { gt: from } },
    include: { channel: { select: { id: true, name: true, nameEn: true, image: true } } },
    orderBy: [{ channelId: 'asc' }, { start: 'asc' }],
  });
}