import type { CsvTable } from './table-csv-import';
import { importTable, parseCsv } from './table-csv-import';

export type UniversalImportDetection = {
  format: 'csv' | 'json';
  table: CsvTable;
  confidence: number;
  reason: string;
  rows: number;
};

type JsonObject = Record<string, unknown>;

function normalizedKeys(row: Record<string, unknown>) {
  return new Set(Object.keys(row).map((key) => key.trim().toLowerCase().replace(/[\s-]+/g, '_')));
}

function hasAny(keys: Set<string>, values: string[]) {
  return values.some((value) => keys.has(value));
}

function detectRows(rows: Array<Record<string, unknown>>): Omit<UniversalImportDetection, 'format'> {
  if (!rows.length) throw new Error('The uploaded data contains no rows.');

  const keys = normalizedKeys(rows[0]);
  const channelSignals = Number(hasAny(keys, ['channel_name', 'channelname', 'name', 'name_en']))
    + Number(hasAny(keys, ['channel_url', 'channelurl', 'url', 'stream_url']))
    + Number(hasAny(keys, ['category_id', 'categoryid', 'category', 'category_name']));
  const sourceSignals = Number(hasAny(keys, ['source_url', 'url', 'channel_url']))
    + Number(hasAny(keys, ['channel_id', 'channelid', 'channel_name', 'channelname']))
    + Number(hasAny(keys, ['source_title', 'title']));
  const programSignals = Number(hasAny(keys, ['program_title', 'title', 'start', 'start_time']))
    + Number(hasAny(keys, ['end', 'end_time']))
    + Number(hasAny(keys, ['epg_channel_id', 'epgchannelid', 'channel_id', 'channel_name']));
  const categorySignals = Number(hasAny(keys, ['category_id', 'categoryid', 'id']))
    + Number(hasAny(keys, ['category_name', 'categoryname', 'name', 'title']))
    - Number(hasAny(keys, ['url', 'channel_url', 'start', 'start_time']));

  const candidates: Array<{ table: CsvTable; score: number; reason: string }> = [
    { table: 'channel', score: channelSignals, reason: 'channel identity and stream URL fields detected' },
    { table: 'source', score: sourceSignals, reason: 'source URL and channel association fields detected' },
    { table: 'program', score: programSignals, reason: 'program title and time fields detected' },
    { table: 'category', score: categorySignals, reason: 'category identity/name fields detected' },
  ];

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score < 2) {
    throw new Error(`Could not identify the uploaded schema from its fields. Detected fields: ${Object.keys(rows[0]).slice(0, 20).join(', ')}`);
  }

  const tied = candidates.filter((candidate) => candidate.score === best.score);
  if (tied.length > 1 && best.table === 'channel') {
    const looksLikeSource = rows.some((row) => Boolean(row.source_url || row.sourceUrl));
    if (looksLikeSource) return { table: 'source', confidence: 0.9, reason: 'source_url field disambiguated the upload', rows: rows.length };
  }

  return {
    table: best.table,
    confidence: Math.min(0.99, 0.55 + best.score * 0.12),
    reason: best.reason,
    rows: rows.length,
  };
}

function jsonRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter((item): item is JsonObject => Boolean(item && typeof item === 'object'));
  if (payload && typeof payload === 'object') {
    const value = payload as Record<string, unknown>;
    for (const key of ['rows', 'data', 'channels', 'sources', 'programs', 'categories', 'posts']) {
      if (Array.isArray(value[key])) return value[key].filter((item): item is JsonObject => Boolean(item && typeof item === 'object'));
    }
  }
  return [];
}

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows: Array<Record<string, unknown>>) {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n');
}

export async function detectAndImportUpload(fileName: string, text: string) {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new Error('The uploaded file is empty.');

  const lower = fileName.toLowerCase();
  if (lower.endsWith('.m3u') || lower.endsWith('.m3u8') || trimmed.startsWith('#EXTM3U')) {
    throw new Error('M3U playlists are detected correctly, but they should be ingested through a channel/source playlist pipeline rather than the relational CSV importer.');
  }

  if (lower.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let payload: unknown;
    try { payload = JSON.parse(trimmed); }
    catch { throw new Error('The uploaded JSON is invalid.'); }
    const rows = jsonRows(payload);
    const detected = detectRows(rows);
    const result = await importTable(detected.table, rowsToCsv(rows));
    return { ...detected, format: 'json' as const, result };
  }

  const rows = parseCsv(trimmed);
  const detected = detectRows(rows);
  const result = await importTable(detected.table, trimmed);
  return { ...detected, format: 'csv' as const, result };
}
