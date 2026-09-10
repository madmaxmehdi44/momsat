import { NextRequest, NextResponse } from 'next/server';
import { parseCsv } from '../../../../../lib/table-csv-import';
import { importTable } from '../../../../../lib/table-csv-import';
import { importSourceCsvFast } from '../../../../../lib/table-source-import-fast';
import { prisma } from '../../../../../lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_CHUNK_BYTES = 2 * 1024 * 1024;

type CsvTable = 'category' | 'channel' | 'source' | 'program';
type Candidate = [CsvTable, number, string];

function normalizedKeys(row: Record<string, unknown>) {
  return new Set(Object.keys(row).map((key) => key.trim().toLowerCase().replace(/[\s-]+/g, '_')));
}

function hasAny(keys: Set<string>, values: string[]) {
  return values.some((value) => keys.has(value));
}

function detectTable(rows: Array<Record<string, string>>): { table: CsvTable; confidence: number; reason: string } {
  if (!rows.length) throw new Error('The chunk contains no rows.');
  const keys = normalizedKeys(rows[0]);
  const channel = Number(hasAny(keys, ['channel_name', 'channelname', 'name', 'name_en']))
    + Number(hasAny(keys, ['channel_url', 'channelurl', 'url', 'stream_url']))
    + Number(hasAny(keys, ['category_id', 'categoryid', 'category', 'category_name']));
  const source = Number(hasAny(keys, ['source_url', 'url', 'channel_url']))
    + Number(hasAny(keys, ['channel_id', 'channelid', 'channel_name', 'channelname']))
    + Number(hasAny(keys, ['source_title', 'title']));
  const program = Number(hasAny(keys, ['program_title', 'title', 'start', 'start_time']))
    + Number(hasAny(keys, ['end', 'end_time']))
    + Number(hasAny(keys, ['epg_channel_id', 'epgchannelid', 'channel_id', 'channel_name']));
  const category = Number(hasAny(keys, ['category_id', 'categoryid', 'id']))
    + Number(hasAny(keys, ['category_name', 'categoryname', 'name', 'title']))
    - Number(hasAny(keys, ['url', 'channel_url', 'start', 'start_time']));

  const candidates: Candidate[] = [
    ['channel', channel, 'channel identity and stream URL fields detected'],
    ['source', source, 'source URL and channel association fields detected'],
    ['program', program, 'program title and time fields detected'],
    ['category', category, 'category identity/name fields detected'],
  ].sort((a, b) => b[1] - a[1]);
  const best = candidates[0];
  if (!best || best[1] < 2) throw new Error(`Could not identify the CSV schema. Fields: ${Object.keys(rows[0]).slice(0, 20).join(', ')}`);

  if (candidates[0][1] === candidates[1][1] && best[0] === 'channel' && rows.some((row) => Boolean(row.source_url || row.sourceUrl))) {
    return { table: 'source', confidence: 0.9, reason: 'source_url field disambiguated the chunk' };
  }
  return { table: best[0], confidence: Math.min(0.99, 0.55 + best[1] * 0.12), reason: best[2] };
}

export async function POST(req: NextRequest) {
  const configuredToken = process.env.ADMIN_TOKEN?.trim();
  const suppliedToken = req.headers.get('x-admin-token')?.trim();
  if (!configuredToken) return NextResponse.json({ ok: false, error: 'ADMIN_TOKEN is not configured; admin import is disabled.' }, { status: 503 });
  if (!suppliedToken || suppliedToken !== configuredToken) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'A CSV chunk is required.' }, { status: 400 });
    if (file.size > MAX_CHUNK_BYTES) return NextResponse.json({ ok: false, error: 'CSV chunk exceeds the 2 MB limit.' }, { status: 413 });

    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) return NextResponse.json({ ok: true, rows: 0, created: 0, updated: 0, skipped: 0, errors: [] });

    const detected = detectTable(rows);
    const result = detected.table === 'source'
      ? await importSourceCsvFast(text)
      : await importTable(detected.table, text);

    const [categories, channels, sources, programs] = await Promise.all([
      prisma.category.count(),
      prisma.channel.count(),
      prisma.source.count(),
      prisma.program.count(),
    ]);

    return NextResponse.json({
      ok: result.errors.length === 0,
      format: 'csv',
      detectedTable: detected.table,
      confidence: detected.confidence,
      reason: detected.reason,
      rows: result.rows,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
      ingestion: 'channelsCreated' in result ? {
        channelsCreated: result.channelsCreated,
        channelsMatched: result.channelsMatched,
        sourcesCreated: result.sourcesCreated,
        sourcesSkipped: result.sourcesSkipped,
      } : undefined,
      database: { categories, channels, sources, programs },
    }, { status: result.errors.length ? 207 : 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Chunk import failed' }, { status: 400 });
  }
}
