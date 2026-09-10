import crypto from 'node:crypto';
import { prisma } from './prisma';

type M3uEntry = {
  name: string;
  url: string;
  attrs: Record<string, string>;
  referer: string | null;
  origin: string | null;
};

export type M3uImportResult = {
  rows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

function norm(value: unknown) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function stableInt(key: string) {
  return Math.abs(Number.parseInt(crypto.createHash('sha1').update(key).digest('hex').slice(0, 7), 16)) || 1;
}

function cleanUrl(value: string) {
  const raw = String(value ?? '').trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function parseAttributes(text: string) {
  const attrs: Record<string, string> = {};
  const pattern = /([\w-]+)=(?:"([^"]*)"|([^\s]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) attrs[match[1].toLowerCase()] = (match[2] ?? match[3] ?? '').trim();
  return attrs;
}

function parseDirectiveValue(line: string) {
  const index = line.indexOf(':');
  return index >= 0 ? line.slice(index + 1).trim() : '';
}

function isUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function parseM3u(text: string): M3uEntry[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const entries: M3uEntry[] = [];
  let pending: Omit<M3uEntry, 'url'> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#EXTM3U')) continue;

    if (line.startsWith('#EXTINF:')) {
      const comma = line.indexOf(',');
      const header = comma >= 0 ? line.slice(8, comma) : line.slice(8);
      const displayName = comma >= 0 ? line.slice(comma + 1).trim() : '';
      const attrs = parseAttributes(header);
      const name = attrs['tvg-name'] || displayName || attrs['tvg-id'] || 'Unnamed channel';
      pending = {
        name,
        attrs,
        referer: null,
        origin: null,
      };
      continue;
    }

    if (line.startsWith('#EXTVLCOPT:')) {
      if (!pending) continue;
      const directive = line.slice('#EXTVLCOPT:'.length);
      const separator = directive.indexOf('=');
      const key = separator >= 0 ? directive.slice(0, separator).trim().toLowerCase() : directive.trim().toLowerCase();
      const value = separator >= 0 ? directive.slice(separator + 1).trim() : '';
      if (key === 'http-referrer' || key === 'http-referer' || key === 'http-referrer-url') pending.referer = value || null;
      if (key === 'http-origin') pending.origin = value || null;
      continue;
    }

    if (line.startsWith('#EXTHTTP:')) {
      if (!pending) continue;
      const directive = parseDirectiveValue(line);
      const separator = directive.indexOf('=');
      const key = separator >= 0 ? directive.slice(0, separator).trim().toLowerCase() : '';
      const value = separator >= 0 ? directive.slice(separator + 1).trim() : '';
      if (key === 'referer' || key === 'referrer') pending.referer = value || null;
      if (key === 'origin') pending.origin = value || null;
      continue;
    }

    if (line.startsWith('#')) continue;
    const url = cleanUrl(line);
    if (!pending || !url || !isUrl(url)) continue;
    entries.push({ ...pending, url });
    pending = null;
  }

  return entries;
}

function firstToken(value: string) {
  return value.split(/[;,|]/).map(v => v.trim()).filter(Boolean)[0] || '';
}

function categoryFor(entry: M3uEntry) {
  const group = firstToken(entry.attrs['group-title'] || '');
  const value = norm(group);
  const known: Array<[RegExp, string, string]> = [
    [/news|خبر/, 'News', 'news'],
    [/sport|sports|ورزش/, 'Sports', 'sports'],
    [/music|موزیک|موسیقی/, 'Music', 'music'],
    [/movie|movies|film|فیلم/, 'Movies & Series', 'movies-series'],
    [/series|سریال/, 'Movies & Series', 'movies-series'],
    [/kids|child|کودک/, 'Kids', 'kids'],
    [/documentary|مستند/, 'Documentary', 'documentary'],
    [/relig|quran|قرآن|مذهبی/, 'Religion', 'religion'],
    [/entertain|سرگرمی/, 'Entertainment', 'entertainment'],
  ];
  for (const [pattern, name, nameEn] of known) if (pattern.test(value)) return { name, nameEn };
  if (group) return { name: group, nameEn: group };
  return { name: 'Other', nameEn: 'other' };
}

async function ensureCategory(group: { name: string; nameEn: string }) {
  const existing = await prisma.category.findFirst({ where: { OR: [{ name: group.name }, { nameEn: group.nameEn }] }, select: { id: true } });
  if (existing) return existing.id;
  const id = stableInt(`m3u-category:${norm(group.nameEn)}`);
  const collision = await prisma.category.findUnique({ where: { id }, select: { id: true } });
  if (collision) return collision.id;
  const created = await prisma.category.create({ data: { id, name: group.name, nameEn: group.nameEn }, select: { id: true } });
  return created.id;
}

async function uniqueChannelId(key: string) {
  let id = stableInt(`m3u-channel:${key}`);
  while (await prisma.channel.findUnique({ where: { id }, select: { id: true } })) id += 1;
  return id;
}

async function uniqueSourceId(channelId: number, url: string) {
  let id = stableInt(`m3u-source:${channelId}:${url}`);
  while (await prisma.source.findUnique({ where: { id }, select: { id: true } })) id += 1;
  return id;
}

export async function importM3u(text: string): Promise<M3uImportResult> {
  const entries = parseM3u(text);
  if (!entries.length) throw new Error('No valid HTTP(S) M3U entries were found.');

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const channelCache = new Map<string, number>();

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    try {
      const url = entry.url;
      const name = entry.name.trim() || entry.attrs['tvg-id'] || `Channel ${i + 1}`;
      const nameEn = entry.attrs['tvg-name'] || entry.attrs['tvg-id'] || name;
      const catalogKey = `m3u:${norm(entry.attrs['tvg-id'] || nameEn)}`;
      const category = categoryFor(entry);
      const categoryId = await ensureCategory(category);
      const country = entry.attrs['tvg-country'] || entry.attrs['country'] || null;
      const language = entry.attrs['tvg-language'] || entry.attrs['language'] || null;
      const logo = entry.attrs['tvg-logo'] || entry.attrs['logo'] || null;
      const satellite = entry.attrs['satellite'] || entry.attrs['sat'] || null;
      const frequency = entry.attrs['frequency'] || entry.attrs['freq'] || null;
      const polarization = entry.attrs['polarization'] || entry.attrs['pol'] || null;
      const symbolRate = entry.attrs['symbolrate'] || entry.attrs['symbol-rate'] || entry.attrs['sr'] || null;
      const serviceId = entry.attrs['service-id'] || entry.attrs['serviceid'] || entry.attrs['sid'] || entry.attrs['tvg-id'] || null;
      const vpn = ['true', '1', 'yes'].includes(norm(entry.attrs['vpn']));
      const iran = ['ir', 'iran'].includes(norm(country));

      let channelId = channelCache.get(catalogKey) || 0;
      if (!channelId) {
        const existing = await prisma.channel.findUnique({ where: { catalogKey }, select: { id: true } });
        if (existing) channelId = existing.id;
      }
      if (!channelId) {
        const existing = await prisma.channel.findFirst({ where: { OR: [{ name }, { nameEn }, { url }] }, select: { id: true } });
        if (existing) channelId = existing.id;
      }

      if (!channelId) {
        channelId = await uniqueChannelId(catalogKey);
        await prisma.channel.create({
          data: {
            id: channelId,
            name,
            nameEn,
            catalogKey,
            image: logo,
            url,
            referer: entry.referer,
            origin: entry.origin,
            vpn,
            iran,
            popular: 0,
            vip: false,
            language,
            country,
            platform: satellite ? 'SATELLITE + INTERNET' : 'INTERNET',
            satellite,
            frequency,
            polarization,
            symbolRate,
            serviceId,
            categoryId,
            categoryName: category.name,
            categoryNameEn: category.nameEn,
          },
        });
        created += 1;
      } else {
        await prisma.channel.update({
          where: { id: channelId },
          data: {
            catalogKey,
            image: logo || undefined,
            url,
            referer: entry.referer || undefined,
            origin: entry.origin || undefined,
            language: language || undefined,
            country: country || undefined,
            platform: satellite ? 'SATELLITE + INTERNET' : undefined,
            satellite: satellite || undefined,
            frequency: frequency || undefined,
            polarization: polarization || undefined,
            symbolRate: symbolRate || undefined,
            serviceId: serviceId || undefined,
            categoryId,
            categoryName: category.name,
            categoryNameEn: category.nameEn,
            vpn: vpn || undefined,
            iran: iran || undefined,
          },
        });
        updated += 1;
      }
      channelCache.set(catalogKey, channelId);

      const duplicate = await prisma.source.findFirst({ where: { channelId, url }, select: { id: true } });
      if (duplicate) {
        skipped += 1;
        continue;
      }

      await prisma.source.create({
        data: {
          id: await uniqueSourceId(channelId, url),
          channelId,
          title: entry.name,
          url,
          referer: entry.referer,
          origin: entry.origin,
          country,
          vip: false,
        },
      });
      created += 1;
    } catch (error) {
      errors.push(`entry ${i + 1}: ${error instanceof Error ? error.message : 'import failed'}`);
    }
  }

  return { rows: entries.length, created, updated, skipped, errors };
}
