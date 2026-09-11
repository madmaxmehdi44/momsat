import crypto from 'node:crypto';
import { prisma } from './prisma';
import { parseCsv } from './table-csv-import';

type Row = Record<string, string>;

function norm(v: unknown) {
  return String(v ?? '').normalize('NFKC')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[أإآ]/g, 'ا')
    .replace(/[ًٌٍَُِّْ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function val(row: Row, ...names: string[]) { const keys = Object.keys(row); const key = keys.find((candidate) => names.some((name) => norm(candidate) === norm(name))); return key ? String(row[key] ?? '').trim() : ''; }
function int(v: string) { const n = Number(v); return Number.isInteger(n) ? n : 0; }
function bool(v: string) { return ['1', 'true', 'yes', 'y', 'on'].includes(norm(v)); }
function normalizeUrl(value: string) { const raw = String(value ?? '').trim(); if (!raw) return ''; try { const url = new URL(raw); url.hash = ''; url.hostname = url.hostname.toLowerCase(); return url.toString().replace(/\/+$/, ''); } catch { return norm(raw).replace(/\/+$/, ''); } }
function stableInt(key: string) { return Math.abs(Number.parseInt(crypto.createHash('sha1').update(key).digest('hex').slice(0, 7), 16)) || 1; }
function channelHints(row: Row) { return { id: int(val(row, 'channelId', 'channel_id', 'channelID')), name: val(row, 'channelName', 'channel_name', 'channel', 'title'), nameEn: val(row, 'channelNameEn', 'channel_name_en', 'nameEn', 'channel_en', 'name_en'), url: val(row, 'channelUrl', 'channel_url', 'channelURL', 'channel_link') }; }
function sourceUrl(row: Row) { return val(row, 'source_url', 'sourceUrl', 'url', 'stream_url', 'channel_url'); }

export async function importSourceCsvFast(text: string) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('The uploaded data contains no rows.');

  const [channels, categories] = await Promise.all([
    prisma.channel.findMany({ select: { id: true, name: true, nameEn: true, url: true, catalogKey: true } }),
    prisma.category.findMany({ select: { id: true, name: true, nameEn: true } }),
  ]);

  const byId = new Map(channels.map((channel) => [channel.id, channel.id]));
  const byName = new Map<string, number>();
  const byUrl = new Map<string, number>();
  const byCatalogKey = new Map<string, number>();
  for (const channel of channels) {
    for (const name of [channel.name, channel.nameEn]) { const key = norm(name); if (key) byName.set(key, channel.id); }
    const url = normalizeUrl(channel.url); if (url) byUrl.set(url, channel.id);
    if (channel.catalogKey) byCatalogKey.set(channel.catalogKey, channel.id);
  }
  const categoryByName = new Map<string, number>();
  for (const category of categories) { categoryByName.set(norm(category.name), category.id); categoryByName.set(norm(category.nameEn), category.id); }

  const missingChannels = new Map<string, { row: Row; hints: ReturnType<typeof channelHints }>();
  const resolved: Array<{ row: Row; channelId: number; missingKey?: string }> = [];
  let channelsMatched = 0;

  for (const row of rows) {
    const hints = channelHints(row);
    let channelId = hints.id > 0 ? byId.get(hints.id) || 0 : 0;
    if (!channelId) for (const name of [hints.nameEn, hints.name]) { const id = byName.get(norm(name)); if (id) { channelId = id; break; } }
    if (!channelId && hints.url) channelId = byUrl.get(normalizeUrl(hints.url)) || 0;
    if (channelId) { channelsMatched++; resolved.push({ row, channelId }); }
    else {
      const key = norm(hints.nameEn || hints.name);
      if (key) { missingChannels.set(key, { row, hints }); resolved.push({ row, channelId: 0, missingKey: key }); }
      else resolved.push({ row, channelId: 0 });
    }
  }

  if (missingChannels.size) {
    const existingMissing = await prisma.channel.findMany({
      where: {
        OR: [...missingChannels.values()].flatMap(({ row, hints }) => {
          const clauses: Array<Record<string, unknown>> = [];
          if (hints.name) clauses.push({ name: hints.name });
          if (hints.nameEn) clauses.push({ nameEn: hints.nameEn });
          clauses.push({ catalogKey: `csv:${norm(hints.nameEn || hints.name)}` });
          return clauses;
        }),
      },
      select: { id: true, name: true, nameEn: true, catalogKey: true, url: true },
    });
    for (const channel of existingMissing) {
      byId.set(channel.id, channel.id);
      for (const name of [channel.name, channel.nameEn]) { const key = norm(name); if (key) byName.set(key, channel.id); }
      const url = normalizeUrl(channel.url); if (url) byUrl.set(url, channel.id);
      if (channel.catalogKey) byCatalogKey.set(channel.catalogKey, channel.id);
    }
  }

  let channelsCreated = 0;
  for (const [key, { row, hints }] of missingChannels) {
    let existingId = byName.get(norm(hints.name)) || byName.get(norm(hints.nameEn)) || byCatalogKey.get(`csv:${key}`);
    if (!existingId && hints.id > 0) existingId = byId.get(hints.id);
    if (!existingId) {
      const name = hints.name || hints.nameEn;
      if (!name) continue;
      const nameEn = hints.nameEn || hints.name || name;
      let categoryId = int(val(row, 'categoryId', 'category_id', 'catId'));
      if (!categoryId) categoryId = categoryByName.get(norm(val(row, 'category', 'category_name', 'categoryName'))) || 0;
      if (!categoryId) {
        const categoryName = val(row, 'category', 'category_name', 'categoryName') || 'Imported';
        const categoryKey = norm(categoryName);
        const categoryExisting = categoryByName.get(categoryKey);
        if (categoryExisting) categoryId = categoryExisting;
        else {
          const id = stableInt(`category:${categoryKey}`);
          const createdCategory = await prisma.category.upsert({ where: { id }, create: { id, name: categoryName, nameEn: categoryName }, update: {} });
          categoryId = createdCategory.id;
          categoryByName.set(categoryKey, categoryId);
        }
      }
      if (!categoryId) throw new Error(`No category could be resolved for channel: ${name}`);
      const url = hints.url || sourceUrl(row);
      if (!url) throw new Error(`Channel URL is required to create missing channel: ${name}`);
      let id = hints.id > 0 ? hints.id : stableInt(`channel:${key}`);
      while (byId.has(id)) id++;
      const createdChannel = await prisma.channel.create({ data: { id, name, nameEn, catalogKey: `csv:${key}`, image: val(row, 'image', 'channel_image', 'logo') || null, url, referer: val(row, 'referer', 'channel_referer') || null, origin: val(row, 'origin', 'channel_origin') || null, vpn: bool(val(row, 'vpn', 'need_vpn')), iran: bool(val(row, 'iran', 'for_iran')), popular: BigInt(int(val(row, 'popular'))), vip: bool(val(row, 'vip', 'isvip')), language: val(row, 'language') || null, country: val(row, 'country') || null, platform: val(row, 'platform') || null, satellite: val(row, 'satellite', 'sat') || null, frequency: val(row, 'frequency', 'freq') || null, polarization: val(row, 'polarization') || null, symbolRate: val(row, 'symbolRate', 'symbol_rate') || null, serviceId: val(row, 'serviceId', 'service_id') || null, categoryId, categoryName: val(row, 'category_name', 'categoryName', 'category') || null, categoryNameEn: val(row, 'category_name_en', 'categoryNameEn') || null }, select: { id: true } });
      existingId = createdChannel.id;
      byId.set(createdChannel.id, createdChannel.id);
      byName.set(norm(name), createdChannel.id);
      byName.set(norm(nameEn), createdChannel.id);
      byUrl.set(normalizeUrl(url), createdChannel.id);
      byCatalogKey.set(`csv:${key}`, createdChannel.id);
      channelsCreated++;
    }
    if (existingId) for (const item of resolved) if (item.channelId === 0 && item.missingKey === key) item.channelId = existingId;
  }

  const valid = resolved.filter((item) => item.channelId > 0);
  const channelIds = [...new Set(valid.map((item) => item.channelId))];
  const existingSources = await prisma.source.findMany({ where: { channelId: { in: channelIds } }, select: { id: true, channelId: true, url: true } });
  const existingKeys = new Set(existingSources.map((source) => `${source.channelId}|${normalizeUrl(source.url)}`));
  const usedIds = new Set(existingSources.map((source) => source.id));
  const createData: Array<{ id: number; channelId: number; title: string | null; url: string; referer: string | null; origin: string | null; country: string | null; vip: boolean }> = [];
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < valid.length; i++) {
    const { row, channelId } = valid[i];
    const url = sourceUrl(row);
    if (!url) { errors.push(`row ${i + 2}: url/source_url is required`); continue; }
    const key = `${channelId}|${normalizeUrl(url)}`;
    if (existingKeys.has(key)) { skipped++; continue; }
    let id = int(val(row, 'id', 'source_id', 'ID')) || stableInt(`source:${channelId}:${normalizeUrl(url)}`);
    while (usedIds.has(id)) id++;
    usedIds.add(id);
    existingKeys.add(key);
    createData.push({ id, channelId, title: val(row, 'title', 'source_title') || null, url, referer: val(row, 'referer', 'channel_referer') || null, origin: val(row, 'origin', 'channel_origin') || null, country: val(row, 'country') || null, vip: bool(val(row, 'vip', 'isvip')) });
  }

  const BATCH = 250;
  let created = 0;
  for (let i = 0; i < createData.length; i += BATCH) {
    const result = await prisma.source.createMany({ data: createData.slice(i, i + BATCH), skipDuplicates: true });
    created += result.count;
  }

  return { rows: rows.length, created, updated: channelsCreated, skipped, errors, channelsCreated, channelsMatched, sourcesCreated: created, sourcesSkipped: skipped };
}
