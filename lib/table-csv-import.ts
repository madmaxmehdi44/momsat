import { prisma } from './prisma';
import crypto from 'node:crypto';

export type CsvTable = 'category' | 'channel' | 'source' | 'program';
type Row = Record<string, string>;

type ChannelLookup = {
  byId: Map<number, number>;
  byName: Map<string, number>;
  byUrl: Map<string, number>;
};

export function parseCsv(text: string): Row[] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); if (row.some(v => v.trim() !== '')) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift()!.map((h, i) => h.trim() || `column_${i + 1}`);
  return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').trim()])));
}

function norm(v: unknown) {
  return String(v ?? '').normalize('NFKC')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[أإآ]/g, 'ا')
    .replace(/[ًٌٍَُِّْ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function val(row: Row, ...names: string[]) {
  const keys = Object.keys(row);
  const key = keys.find(k => names.some(n => norm(k) === norm(n)));
  return key ? row[key] : '';
}
function int(v: string, fallback = 0) { const n = Number(v); return Number.isInteger(n) ? n : fallback; }
function bool(v: string) { return ['1','true','yes','y','on'].includes(norm(v)); }
function stableInt(key: string) { return Math.abs(Number.parseInt(crypto.createHash('sha1').update(key).digest('hex').slice(0, 7), 16)) || 1; }
function iso(v: string) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }

function normalizeUrl(value: string) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/+$/, '');
  } catch {
    return norm(raw).replace(/\/+$/, '');
  }
}

async function uniqueChannelId(preferred: number, key: string) {
  if (preferred > 0 && !(await prisma.channel.findUnique({ where: { id: preferred }, select: { id: true } }))) return preferred;
  let id = stableInt(key);
  while (await prisma.channel.findUnique({ where: { id }, select: { id: true } })) id++;
  return id;
}

async function buildChannelLookup(): Promise<ChannelLookup> {
  const channels = await prisma.channel.findMany({
    select: { id: true, name: true, nameEn: true, url: true },
  });
  const byId = new Map<number, number>();
  const byName = new Map<string, number>();
  const byUrl = new Map<string, number>();
  for (const channel of channels) {
    byId.set(channel.id, channel.id);
    for (const value of [channel.name, channel.nameEn]) {
      const key = norm(value);
      if (key && !byName.has(key)) byName.set(key, channel.id);
    }
    const urlKey = normalizeUrl(channel.url);
    if (urlKey && !byUrl.has(urlKey)) byUrl.set(urlKey, channel.id);
  }
  return { byId, byName, byUrl };
}

function channelHints(row: Row) {
  return {
    id: int(val(row, 'channelId', 'channel_id', 'channelID')),
    name: val(row, 'channelName', 'channel_name', 'channel', 'title'),
    nameEn: val(row, 'channelNameEn', 'channel_name_en', 'nameEn', 'channel_en', 'name_en'),
    url: val(row, 'channelUrl', 'channel_url', 'channelURL', 'channel_link'),
  };
}

function resolveChannelFromLookup(lookup: ChannelLookup, row: Row) {
  const hints = channelHints(row);
  if (hints.id > 0) {
    const byId = lookup.byId.get(hints.id);
    if (byId) return byId;
  }
  for (const candidate of [hints.nameEn, hints.name]) {
    const key = norm(candidate);
    if (!key) continue;
    const byName = lookup.byName.get(key);
    if (byName) return byName;
  }
  const urlKey = normalizeUrl(hints.url);
  if (urlKey) {
    const byUrl = lookup.byUrl.get(urlKey);
    if (byUrl) return byUrl;
  }
  return 0;
}

export async function importTable(table: CsvTable, text: string) {
  const rows = parseCsv(text);
  let created = 0, updated = 0, skipped = 0;
  const errors: string[] = [];
  const channelLookup = table === 'source' ? await buildChannelLookup() : null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], line = i + 2;
    try {
      if (table === 'category') {
        const id = int(val(r, 'id', 'category_id', 'categoryId'));
        const name = val(r, 'name', 'category_name', 'categoryName', 'title');
        const nameEn = val(r, 'nameEn', 'category_name_en', 'categoryNameEn', 'name_en') || name;
        if (!name) throw new Error('name is required');
        const cid = id || stableInt(`category:${norm(nameEn)}`);
        const existing = await prisma.category.findUnique({ where: { id: cid } });
        await prisma.category.upsert({ where: { id: cid }, create: { id: cid, name, nameEn }, update: { name, nameEn } });
        existing ? updated++ : created++;
      }

      if (table === 'channel') {
        const name = val(r, 'name', 'channel_name', 'channelName', 'title');
        const nameEn = val(r, 'nameEn', 'channel_name_en', 'channelNameEn', 'name_en') || name;
        if (!name) throw new Error('name/channel_name is required');
        const key = norm(nameEn) || norm(name);
        const catalogKey = `csv:${key}`;
        const existing = await prisma.channel.findFirst({ where: { OR: [{ catalogKey }, { name }, { nameEn }] } });
        const id = existing?.id ?? await uniqueChannelId(int(val(r, 'id', 'channel_id', 'channelId')), `channel:${key}`);
        const categoryId = int(val(r, 'categoryId', 'category_id', 'catId'));
        let catId = categoryId;
        if (!catId) {
          const catName = val(r, 'category', 'category_name', 'categoryName');
          const cat = catName ? await prisma.category.findFirst({ where: { name: catName } }) : null;
          catId = cat?.id ?? 0;
        }
        if (!catId || !(await prisma.category.findUnique({ where: { id: catId }, select: { id: true } }))) throw new Error('valid categoryId is required');
        const data = {
          id, name, nameEn, catalogKey, image: val(r, 'image', 'channel_image', 'logo') || null,
          url: val(r, 'url', 'channel_url'), referer: val(r, 'referer', 'channel_referer') || null,
          origin: val(r, 'origin', 'channel_origin') || null, vpn: bool(val(r, 'vpn', 'need_vpn')),
          iran: bool(val(r, 'iran', 'for_iran')), popular: BigInt(int(val(r, 'popular'))), vip: bool(val(r, 'vip', 'isvip')),
          language: val(r, 'language') || null, country: val(r, 'country') || null, platform: val(r, 'platform') || null,
          satellite: val(r, 'satellite') || null, frequency: val(r, 'frequency') || null, polarization: val(r, 'polarization') || null,
          symbolRate: val(r, 'symbolRate', 'symbol_rate') || null, serviceId: val(r, 'serviceId', 'service_id') || null,
          categoryId: catId, categoryName: val(r, 'category_name', 'categoryName', 'category') || null,
          categoryNameEn: val(r, 'category_name_en', 'categoryNameEn') || null,
        };
        if (!data.url) throw new Error('channel_url/url is required');
        if (existing) { await prisma.channel.update({ where: { id: existing.id }, data: { ...data, id: existing.id } }); updated++; }
        else { await prisma.channel.create({ data }); created++; }
      }

      if (table === 'source') {
        const url = val(r, 'url', 'channel_url', 'source_url');
        if (!url) throw new Error('url/channel_url is required');
        let channelId = channelLookup ? resolveChannelFromLookup(channelLookup, r) : 0;
        if (!channelId) {
          const hints = channelHints(r);
          const directId = hints.id;
          if (directId > 0) channelId = (await prisma.channel.findUnique({ where: { id: directId }, select: { id: true } }))?.id ?? 0;
          if (!channelId) {
            const candidates = [hints.nameEn, hints.name].map(norm).filter(Boolean);
            if (candidates.length) {
              const channels = await prisma.channel.findMany({ select: { id: true, name: true, nameEn: true } });
              const match = channels.find(ch => candidates.includes(norm(ch.nameEn)) || candidates.includes(norm(ch.name)));
              channelId = match?.id ?? 0;
            }
          }
        }
        if (!channelId) throw new Error('valid channelId/channel name is required');
        const duplicate = await prisma.source.findFirst({ where: { channelId, url }, select: { id: true } });
        if (duplicate) { skipped++; continue; }
        const preferred = int(val(r, 'id', 'source_id'));
        let id = preferred > 0 && !(await prisma.source.findUnique({ where: { id: preferred }, select: { id: true } }))
          ? preferred : stableInt(`source:${channelId}:${url}`);
        while (await prisma.source.findUnique({ where: { id }, select: { id: true } })) id++;
        await prisma.source.create({ data: {
          id, channelId, title: val(r, 'title', 'source_title') || null, url,
          referer: val(r, 'referer', 'channel_referer') || null,
          origin: val(r, 'origin', 'channel_origin') || null,
          country: val(r, 'country') || null, vip: bool(val(r, 'vip', 'isvip')),
        } });
        created++;
      }

      if (table === 'program') {
        const title = val(r, 'title', 'program_title', 'name');
        const start = iso(val(r, 'start', 'startTime', 'start_time'));
        const end = iso(val(r, 'end', 'endTime', 'end_time'));
        if (!title || !start || !end) throw new Error('title, valid start and end are required');
        const id = val(r, 'id', 'program_id') || crypto.createHash('sha1').update(`${val(r, 'channelId', 'channel_id')}:${title}:${start.toISOString()}`).digest('hex');
        const channelIdRaw = int(val(r, 'channelId', 'channel_id'));
        const epgChannelId = val(r, 'epgChannelId', 'epg_channel_id') || `csv:${channelIdRaw || val(r, 'channelName', 'channel_name') || 'unknown'}`;
        const epg = await prisma.epgChannel.upsert({
          where: { id: epgChannelId },
          create: { id: epgChannelId, displayName: val(r, 'channelName', 'channel_name') || 'Imported EPG', displayNameEn: val(r, 'channelNameEn', 'channel_name_en') || null },
          update: {},
        });
        const existing = await prisma.program.findUnique({ where: { id } });
        const data = {
          channelId: channelIdRaw || null, epgChannelId: epg.id, title,
          subTitle: val(r, 'subTitle', 'subtitle') || null, description: val(r, 'description', 'desc') || null,
          category: val(r, 'category') || null, icon: val(r, 'icon', 'image', 'logo') || null, start, end,
        };
        if (existing) await prisma.program.update({ where: { id }, data });
        else await prisma.program.create({ data: { id, ...data } });
        existing ? updated++ : created++;
      }
    } catch (e) {
      errors.push(`Row ${line}: ${e instanceof Error ? e.message : 'invalid row'}`);
    }
  }
  return { table, rows: rows.length, created, updated, skipped, errors };
}
