import { importTable as importLegacy, parseCsv as parseLegacy, type CsvTable as LegacyCsvTable } from './table-csv-import';

export type CsvTable = LegacyCsvTable;

type Row = Record<string, string>;

const norm = (value: string) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ًٌٍَُِّْ]/g, '').replace(/\s+/g, ' ').trim();
const value = (row: Row, ...names: string[]) => { const keys = Object.keys(row); const key = keys.find((k) => names.some((n) => norm(k) === norm(n))); return key ? String(row[key] ?? '').trim() : ''; };
const integer = (v: string) => { const n = Number(v); return Number.isInteger(n) ? n : 0; };
const stableId = (key: string) => { let h = 2166136261; for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) & 0x7fffffff || 1; };

function inferCategory(row: Row) {
  const haystack = norm([value(row, 'channel_name', 'channelName', 'name', 'title'), value(row, 'channel_name_en', 'channelNameEn', 'nameEn'), value(row, 'channel_url', 'channelUrl', 'url')].join(' '));
  if (/radio|رادیو/.test(haystack)) return { id: stableId('category:radio'), name: 'رادیو', nameEn: 'Radio' };
  if (/news|خبر|voa|bbc/.test(haystack)) return { id: stableId('category:news'), name: 'اخبار', nameEn: 'News' };
  if (/music|موزیک|موسیقی|pmc/.test(haystack)) return { id: stableId('category:music'), name: 'موزیک', nameEn: 'Music' };
  if (/sport|ورزش|football|soccer/.test(haystack)) return { id: stableId('category:sport'), name: 'ورزش', nameEn: 'Sport' };
  if (/movie|film|فیلم|سینما|cinema/.test(haystack)) return { id: stableId('category:movies'), name: 'فیلم و سریال', nameEn: 'Movies & Series' };
  if (/kids|child|کودک|نوجوان/.test(haystack)) return { id: stableId('category:kids'), name: 'کودک و نوجوان', nameEn: 'Kids & Teens' };
  return { id: stableId('category:tv'), name: 'سرگرمی', nameEn: 'Entertainment' };
}

function enrichRows(rows: Row[]) {
  return rows.map((row) => {
    const categoryId = integer(value(row, 'category_id', 'categoryId', 'catId'));
    const categoryName = value(row, 'category_name', 'categoryName', 'category');
    const categoryNameEn = value(row, 'category_name_en', 'categoryNameEn');
    if (categoryId > 0 && categoryName) return row;
    const inferred = inferCategory(row);
    return {
      ...row,
      category_id: String(categoryId > 0 ? categoryId : inferred.id),
      category_name: categoryName || inferred.name,
      category_name_en: categoryNameEn || inferred.nameEn,
    };
  });
}

function csvCell(value: string) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows: Row[]) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header] ?? '')).join(','))].join('\n');
}

function looksLikeChannel(rows: Row[]) {
  if (!rows.length) return false;
  const keys = new Set(Object.keys(rows[0]).map(norm));
  return (keys.has('channel_name') || keys.has('channelname')) && (keys.has('channel_url') || keys.has('channelurl') || keys.has('url'));
}

function validate(table: CsvTable, rows: Row[]) {
  if (!rows.length) throw new Error('CSV is empty');
  if (table === 'category' && looksLikeChannel(rows)) throw new Error('CSV schema mismatch: this file is a Channel CSV. Select Channel.');
  const errors: string[] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    if (table === 'category' && !value(row, 'name', 'category_name', 'categoryName', 'title')) errors.push(`Row ${line}: name is required`);
    if (table === 'channel') {
      if (!value(row, 'name', 'channel_name', 'channelName', 'title')) errors.push(`Row ${line}: channel name is required`);
      if (!value(row, 'url', 'channel_url')) errors.push(`Row ${line}: channel URL is required`);
    }
    if (table === 'source') {
      if (!value(row, 'url', 'channel_url', 'source_url')) errors.push(`Row ${line}: source URL is required`);
      if (!value(row, 'channelId', 'channel_id', 'channelName', 'channel_name', 'channel', 'title')) errors.push(`Row ${line}: channel reference is required`);
    }
    if (table === 'program') {
      if (!value(row, 'title', 'program_title', 'name')) errors.push(`Row ${line}: title is required`);
      if (!value(row, 'start', 'startTime', 'start_time')) errors.push(`Row ${line}: start is required`);
      if (!value(row, 'end', 'endTime', 'end_time')) errors.push(`Row ${line}: end is required`);
    }
  });
  if (errors.length) throw new Error(`CSV validation failed before import: ${errors.slice(0, 8).join('; ')}${errors.length > 8 ? `; +${errors.length - 8} more` : ''}`);
}

export async function importTable(table: CsvTable, text: string) {
  const parsed = parseLegacy(text);
  validate(table, parsed);
  if (table === 'channel' || table === 'source') return importLegacy(table, rowsToCsv(enrichRows(parsed)));
  return importLegacy(table, text);
}
