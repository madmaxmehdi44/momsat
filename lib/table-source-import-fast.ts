import crypto from 'node:crypto';
import { prisma } from './prisma';
import { parseCsv } from './table-csv-import';

type Row = Record<string, string>;
type ChannelHints = ReturnType<typeof channelHints>;

function norm(v: unknown) {
  return String(v ?? '').normalize('NFKC').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[أإآ]/g, 'ا').replace(/[ًٌٍَُِّْ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function val(row: Row, ...names: string[]) { const keys = Object.keys(row); const key = keys.find(k => names.some(n => norm(k) === norm(n))); return key ? String(row[key] ?? '').trim() : ''; }
function int(v: string) { const n = Number(v); return Number.isInteger(n) ? n : 0; }
function bool(v: string) { return ['1', 'true', 'yes', 'y', 'on'].includes(norm(v)); }
function normalizeUrl(value: string) { const raw = String(value ?? '').trim(); if (!raw) return ''; try { const url = new URL(raw); url.hash = ''; url.hostname = url.hostname.toLowerCase(); return url.toString().replace(/\/+$/, ''); } catch { return norm(raw).replace(/\/+$/, ''); } }
function stableInt(key: string) { return Math.abs(Number.parseInt(crypto.createHash('sha1').update(key).digest('hex').slice(0, 7), 16)) || 1; }
function channelHints(row: Row) { return { id: int(val(row, 'channelId', 'channel_id', 'channelID')), name: val(row, 'channelName', 'channel_name', 'channel', 'title'), nameEn: val(row, 'channelNameEn', 'channel_name_en', 'nameEn', 'channel_en', 'name_en'), url: val(row, 'channelUrl', 'channel_url', 'channelURL', 'channel_link') }; }
function sourceUrl(row: Row) { return val(row, 'source_url', 'sourceUrl', 'url', 'stream_url', 'channel_url'); }
function channelKey(hints: ChannelHints) { return norm(hints.nameEn || hints.name); }

export async function importSourceCsvFast(text: string) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('The uploaded data contains no rows.');
  const [channels, categories] = await Promise.all([
    prisma.channel.findMany({ select: { id: true, name: true, nameEn: true, url: true, catalogKey: true } }),
    prisma.category.findMany({ select: { id: true, name: true, nameEn: true } }),
  ]);
  const byId = new Map(channels.map(c => [c.id, c.id]));
  const byName = new Map<string, number>();
  const byUrl = new Map<string, number>();
  for (const c of channels) { for (const n of [c.name, c.nameEn]) { const key = norm(n); if (key) byName.set(key, c.id); } const url = normalizeUrl(c.url); if (url) byUrl.set(url, c.id); }
  const categoryByName = new Map<string, number>();
  for (const c of categories) for (const n of [c.name, c.nameEn]) { const key = norm(n); if (key) categoryByName.set(key, c.id); }

  const resolved: Array<{ row: Row; channelId: number }> = [];
  const missingChannels = new Map<string, { row: Row; hints: ChannelHints }>();
  let channelsMatched = 0;
  for (const row of rows) {
    const hints = channelHints(row);
    let channelId = hints.id > 0 ? byId.get(hints.id) || 0 : 0;
    if (!channelId) for (const name of [hints.nameEn, hints.name]) { const id = byName.get(norm(name)); if (id) { channelId = id; break; } }
    if (!channelId && hints.url) channelId = byUrl.get(normalizeUrl(hints.url)) || 0;
    if (channelId) { channelsMatched++; } else { const key = channelKey(hints); if (key) missingChannels.set(key, { row, hints }); }
    resolved.push({ row, channelId });
  }

  let channelsCreated = 0;
  if (missingChannels.size) {
    const names = [...new Set([...missingChannels.values()].flatMap(({ hints }) => [hints.name, hints.nameEn]).filter(Boolean))];
    const catalogKeys = [...missingChannels.keys()].map(key => `csv:${key}`);
    const existing = await prisma.channel.findMany({ where: { OR: [ ...(names.length ? [{ name: { in: names } }, { nameEn: { in: names } }] : []), { catalogKey: { in: catalogKeys } } ] }, select: { id: true, name: true, nameEn: true, catalogKey: true, url: true } });
    for (const channel of existing) { byId.set(channel.id, channel.id); for (const name of [channel.name, channel.nameEn]) { const key = norm(name); if (key) byName.set(key, channel.id); } const url = normalizeUrl(channel.url); if (url) byUrl.set(url, channel.id); }

    const newChannels = new Map<string, { row: Row; hints: ChannelHints }>();
    for (const entry of missingChannels.values()) { const key = channelKey(entry.hints); if (!key || byName.has(key) || (entry.hints.id > 0 && byId.has(entry.hints.id)) || existing.some(c => c.catalogKey === `csv:${key}`)) continue; newChannels.set(key, entry); }
    for (const { row, hints } of newChannels.values()) {
      const name = hints.name || hints.nameEn; if (!name) continue;
      const nameEn = hints.nameEn || hints.name || name; const key = channelKey(hints);
      let categoryId = int(val(row, 'categoryId', 'category_id', 'catId')) || categoryByName.get(norm(val(row, 'category', 'category_name', 'categoryName'))) || 0;
      if (!categoryId) { const categoryName = val(row, 'category', 'category_name', 'categoryName') || 'Imported'; const categoryKey = norm(categoryName); const existingCategory = categoryByName.get(categoryKey); if (existingCategory) categoryId = existingCategory; else { const id = stableInt(`category:${categoryKey}`); const createdCategory = await prisma.category.upsert({ where: { id }, create: { id, name: categoryName, nameEn: categoryName }, update: {} }); categoryId = createdCategory.id; categoryByName.set(categoryKey, categoryId); } }
      if (!categoryId) throw new Error(`No category could be resolved for channel: ${name}`);
      const url = hints.url || sourceUrl(row); if (!url) throw new Error(`Channel URL is required to create missing channel: ${name}`);
      let id = hints.id > 0 ? hints.id : stableInt(`channel:${key}`); while (byId.has(id)) id++;
      const created = await prisma.channel.create({ data: { id, name, nameEn, catalogKey: `csv:${key}`, image: val(row, 'image', 'channel_image', 'logo') || null, url, referer: val(row, 'referer', 'channel_referer') || null, origin: val(row, 'origin', 'channel_origin') || null, vpn: bool(val(row, 'vpn', 'need_vpn')), iran: bool(val(row, 'iran', 'for_iran')), popular: BigInt(int(val(row, 'popular'))), vip: bool(val(row, 'vip', 'isvip')), language: val(row, 'language') || null, country: val(row, 'country') || null, platform: val(row, 'platform') || null, satellite: val(row, 'satellite', 'sat') || null, frequency: val(row, 'frequency', 'freq') || null, polarization: val(row, 'polarization') || null, symbolRate: val(row, 'symbolRate', 'symbol_rate') || null, serviceId: val(row, 'serviceId', 'service_id') || null, categoryId, categoryName: val(row, 'category_name', 'categoryName', 'category') || null, categoryNameEn: val(row, 'category_name_en', 'categoryNameEn') || null }, select: { id: true } });
      byId.set(created.id, created.id); byName.set(norm(name), created.id); byName.set(norm(nameEn), created.id); byUrl.set(normalizeUrl(url), created.id); channelsCreated++;
    }
    for (const item of resolved) if (item.channelId === 0) { const hints = channelHints(item.row); item.channelId = byId.get(hints.id) || byName.get(channelKey(hints)) || (hints.url ? byUrl.get(normalizeUrl(hints.url)) || 0 : 0); }
  }

  const valid = resolved.filter(item => item.channelId > 0);
  const channelIds = [...new Set(valid.map(item => item.channelId))];
  const existingSources = channelIds.length ? await prisma.source.findMany({ where: { channelId: { in: channelIds } }, select: { id: true, channelId: true, url: true } }) : [];
  const existingKeys = new Set(existingSources.map(s => `${s.channelId}|${normalizeUrl(s.url)}`));
  const usedIds = new Set(existingSources.map(s => s.id));
  const createData: Array<{ id: number; channelId: number; title: string | null; url: string; referer: string | null; origin: string | null; country: string | null; vip: boolean }> = [];
  let skipped = 0; const errors: string[] = [];
  for (let i = 0; i < valid.length; i++) { const { row, channelId } = valid[i]; const url = sourceUrl(row); if (!url) { errors.push(`row ${i + 2}: url/source_url is required`); continue; } const key = `${channelId}|${normalizeUrl(url)}`; if (existingKeys.has(key)) { skipped++; continue; } let id = int(val(row, 'id', 'source_id', 'ID')) || stableInt(`source:${channelId}:${normalizeUrl(url)}`); while (usedIds.has(id)) id++; usedIds.add(id); existingKeys.add(key); createData.push({ id, channelId, title: val(row, 'title', 'source_title') || null, url, referer: val(row, 'referer', 'channel_referer') || null, origin: val(row, 'origin', 'channel_origin') || null, country: val(row, 'country') || null, vip: bool(val(row, 'vip', 'isvip')) }); }
  const BATCH = 250; let created = 0;
  for (let i = 0; i < createData.length; i += BATCH) { const result = await prisma.source.createMany({ data: createData.slice(i, i + BATCH), skipDuplicates: true }); created += result.count; }
  return { rows: rows.length, created, updated: channelsCreated, skipped, errors, channelsCreated, channelsMatched, sourcesCreated: created, sourcesSkipped: skipped };
}
