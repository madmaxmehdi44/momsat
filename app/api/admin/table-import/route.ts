import { NextRequest, NextResponse } from 'next/server';
import { importTable, parseCsv, type CsvTable } from '../../../../lib/table-csv-import';
import { prisma } from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TABLES = new Set<CsvTable>(['category', 'channel', 'source', 'program']);

function hasAny(headers: Set<string>, names: string[]) {
  return names.some(name => headers.has(name));
}

function validateCsv(table: CsvTable, text: string) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('CSV is empty');

  const headers = new Set(Object.keys(rows[0]));
  const looksLikeChannel = hasAny(headers, ['channel_name', 'channelName']) && hasAny(headers, ['channel_url', 'channelUrl', 'url']);
  if (table === 'category' && looksLikeChannel) {
    throw new Error('CSV schema mismatch: this file is a Channel CSV, but Category was selected. Select Channel.');
  }

  const errors: string[] = [];
  const check = (condition: boolean, line: number, message: string) => {
    if (!condition) errors.push(`Row ${line}: ${message}`);
  };

  if (table === 'category') {
    if (!hasAny(headers, ['id', 'category_id', 'categoryId'])) throw new Error('CSV schema mismatch: Category requires id/category_id.');
    if (!hasAny(headers, ['name', 'category_name', 'categoryName', 'title'])) throw new Error('CSV schema mismatch: Category requires name/category_name.');
    rows.forEach((row, i) => check(Boolean(row.name || row.category_name || row.categoryName || row.title), i + 2, 'name is required'));
  }

  if (table === 'channel') {
    if (!hasAny(headers, ['name', 'channel_name', 'channelName', 'title'])) throw new Error('CSV schema mismatch: Channel requires name/channel_name.');
    if (!hasAny(headers, ['url', 'channel_url'])) throw new Error('CSV schema mismatch: Channel requires url/channel_url.');
    rows.forEach((row, i) => {
      check(Boolean(row.name || row.channel_name || row.channelName || row.title), i + 2, 'name/channel_name is required');
      check(Boolean(row.url || row.channel_url), i + 2, 'channel_url/url is required');
    });
  }

  if (table === 'source') {
    if (!hasAny(headers, ['url', 'channel_url', 'source_url'])) throw new Error('CSV schema mismatch: Source requires url/channel_url.');
    if (!hasAny(headers, ['channelId', 'channel_id', 'channelName', 'channel_name', 'channel', 'title'])) throw new Error('CSV schema mismatch: Source requires channelId/channel_name.');
    rows.forEach((row, i) => {
      check(Boolean(row.url || row.channel_url || row.source_url), i + 2, 'url/channel_url is required');
      check(Boolean(row.channelId || row.channel_id || row.channelName || row.channel_name || row.channel || row.title), i + 2, 'channelId/channel name is required');
    });
  }

  if (table === 'program') {
    if (!hasAny(headers, ['title', 'program_title', 'name'])) throw new Error('CSV schema mismatch: Program requires title.');
    if (!hasAny(headers, ['start', 'startTime', 'start_time']) || !hasAny(headers, ['end', 'endTime', 'end_time'])) {
      throw new Error('CSV schema mismatch: Program requires start and end.');
    }
    rows.forEach((row, i) => {
      check(Boolean(row.title || row.program_title || row.name), i + 2, 'title is required');
      check(Boolean(row.start || row.startTime || row.start_time), i + 2, 'start is required');
      check(Boolean(row.end || row.endTime || row.end_time), i + 2, 'end is required');
    });
  }

  if (errors.length) throw new Error(`CSV validation failed before import: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? `; +${errors.length - 5} more` : ''}`);
  return rows.length;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-admin-token');
  if (process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const form = await req.formData();
    const table = String(form.get('table') || '') as CsvTable;
    const file = form.get('file');
    if (!TABLES.has(table)) return NextResponse.json({ ok: false, error: 'Invalid table. Use category, channel, source or program.' }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'CSV file is required.' }, { status: 400 });
    if (!file.name.toLowerCase().endsWith('.csv')) return NextResponse.json({ ok: false, error: 'Only CSV files are accepted.' }, { status: 415 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ ok: false, error: 'Maximum file size is 10 MB.' }, { status: 413 });

    const text = await file.text();
    validateCsv(table, text);
    const result = await importTable(table, text);
    const [categories, channels, sources, programs] = await Promise.all([
      prisma.category.count(), prisma.channel.count(), prisma.source.count(), prisma.program.count(),
    ]);
    return NextResponse.json({ ok: result.errors.length === 0, ...result, database: { categories, channels, sources, programs } }, { status: result.errors.length ? 207 : 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Table import failed' }, { status: 400 });
  }
}
