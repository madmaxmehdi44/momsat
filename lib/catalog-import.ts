import crypto from 'node:crypto';
import { prisma } from './prisma';

type Row = Record<string, string>;
type ImportStats = { rows: number; created: number; updated: number; skipped: number; sourcesCreated: number; sourcesSkipped: number; errors: string[] };

const clean = (v: unknown) => String(v ?? '').trim();
const truthy = (v: string) => ['1', 'true', 'yes', 'on'].includes(clean(v).toLowerCase());
const int = (v: string, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : fallback; };

export function parseCsv(text: string): Row[] {
  const input = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = (rows.shift() ?? []).map((h) => clean(h));
  return rows.filter((r) => r.some((v) => clean(v))).map((r) => Object.fromEntries(headers.map((h, i) => [h, clean(r[i])]))) as Row[];
}

export function normalizeName(value: string) {
  return clean(value).normalize('NFKC').toLowerCase()
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[أإٱ]/g, 'ا')
    .replace(/[\u064B-\u065F\u0670]/g, '').replace(/[\s\-_–—.]+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function catalogKey(row: Row) {
  const en = normalizeName(row.channel_name_en);
  const fa = normalizeName(row.channel_name);
  return en || fa || `channel-${row.channel_id}`;
}

function stableId(key: string) {
  const n = crypto.createHash('sha1').update(key).digest().readUInt32BE(0) & 0x7fffffff;
  return n || 1;
}

function sourceRows(value: string): Row[] {
  if (!value) return [];
  const matches = value.match(/\{[^{}]*\}/g) ?? [];
  return matches.map((chunk) => {
    const get = (key: string) => {
      const m = chunk.match(new RegExp(`['"]${key}['"]\\s*:\\s*(?:['"]([^'"]*)['"]|([^,}]*))`, 'i'));
      return clean(m?.[1] ?? m?.[2]);
    };
    return { ID: get('ID'), title: get('title'), channel_url: get('channel_url'), channel_referer: get('channel_referer'), channel_origin: get('channel_origin'), country: get('country'), isvip: get('isvip') };
  }).filter((r) => r.channel_url);
}

function first(...values: string[]) { return values.find((v) => clean(v)) ?? ''; }

async function allocateId(preferred: number, key: string) {
  let id = preferred || stableId(key);
  for (let i = 0; i < 20; i++) {
    const existing = await prisma.channel.findUnique({ where: { id }, select: { catalogKey: true } });
    if (!existing || existing.catalogKey === key) return id;
    id = stableId(`${key}:${i + 1}`);
  }
  throw new Error(`Unable to allocate channel id for ${key}`);
}

export async function importCatalogCsv(channelsText: string, verifiedText: string): Promise<ImportStats> {
  const channelsRows = parseCsv(channelsText);
  const verifiedRows = parseCsv(verifiedText);
  const verifiedByKey = new Map<string, Row>();
  for (const row of verifiedRows) verifiedByKey.set(clean(row.channel_id) || catalogKey(row), row);
  const stats: ImportStats = { rows: channelsRows.length, created: 0, updated: 0, skipped: 0, sourcesCreated: 0, sourcesSkipped: 0, errors: [] };

  for (const base of channelsRows) {
    try {
      const verified = verifiedByKey.get(clean(base.channel_id)) ?? verifiedByKey.get(catalogKey(base));
      const row = verified ? { ...base, ...verified } : base;
      const key = catalogKey(row);
      const categoryId = int(row.category_id, 1) || 1;
      await prisma.category.upsert({ where: { id: categoryId }, update: { name: first(row.category_name, 'Persian TV'), nameEn: first(row.category_name_en, 'Persian TV') }, create: { id: categoryId, name: first(row.category_name, 'Persian TV'), nameEn: first(row.category_name_en, 'Persian TV') } });

      const normalized = normalizeName(row.channel_name);
      const normalizedEn = normalizeName(row.channel_name_en);
      const existing = await prisma.channel.findFirst({ where: { OR: [{ catalogKey: key }, ...(normalized ? [{ name: row.channel_name }] : []), ...(normalizedEn ? [{ nameEn: row.channel_name_en }] : [])] }, orderBy: { id: 'asc' } });
      const id = existing?.id ?? await allocateId(int(row.channel_id), key);
      const data = {
        name: first(row.channel_name, existing?.name ?? 'Unknown Channel'), nameEn: first(row.channel_name_en, existing?.nameEn ?? row.channel_name), catalogKey: key,
        image: first(row.channel_image, existing?.image ?? '' ) || null, url: first(row.channel_url, existing?.url ?? ''), referer: first(row.channel_referer, existing?.referer ?? '') || null, origin: first(row.channel_origin, existing?.origin ?? '') || null,
        vpn: truthy(row.need_vpn), iran: truthy(row.for_iran), popular: BigInt(Math.max(0, int(row.popular))), vip: truthy(row.isvip),
        language: first(row.language, row.lang, 'Persian') || null, country: first(row.country, row.channel_country) || null, platform: first(row.platform, row.type, 'INTERNET') || null,
        satellite: first(row.satellite, row.satellite_name) || null, frequency: first(row.frequency, row.freq) || null, polarization: first(row.polarization, row.pol) || null, symbolRate: first(row.symbolRate, row.symbol_rate, row.sr) || null, serviceId: first(row.serviceId, row.service_id, row.sid) || null,
        categoryId, categoryName: first(row.category_name) || null, categoryNameEn: first(row.category_name_en) || null,
      };
      await prisma.channel.upsert({ where: { id }, update: data, create: { id, ...data } });
      existing ? stats.updated++ : stats.created++;

      const sources = sourceRows(row.sourses);
      if (row.channel_url) sources.unshift({ ID: '', title: 'Primary', channel_url: row.channel_url, channel_referer: row.channel_referer, channel_origin: row.channel_origin, country: row.country, isvip: row.isvip });
      const seen = new Set<string>();
      for (const source of sources) {
        const url = clean(source.channel_url); if (!url) continue;
        const sourceKey = `${id}:${url}`.toLowerCase(); if (seen.has(sourceKey)) { stats.sourcesSkipped++; continue; } seen.add(sourceKey);
        const duplicate = await prisma.source.findFirst({ where: { channelId: id, url } });
        if (duplicate) { stats.sourcesSkipped++; continue; }
        let sid = int(source.ID, 0) || stableId(`${key}:source:${url}`);
        const collision = await prisma.source.findUnique({ where: { id: sid }, select: { channelId: true } });
        if (collision && collision.channelId !== id) sid = stableId(`${key}:source:${url}:alternate`);
        try {
          await prisma.source.create({ data: { id: sid, channelId: id, title: first(source.title) || null, url, referer: first(source.channel_referer) || null, origin: first(source.channel_origin) || null, country: first(source.country) || null, vip: truthy(source.isvip) } });
          stats.sourcesCreated++;
        } catch { stats.sourcesSkipped++; }
      }
    } catch (error) { stats.errors.push(`row ${stats.rows}: ${error instanceof Error ? error.message : 'import error'}`); stats.skipped++; }
  }
  return stats;
}
