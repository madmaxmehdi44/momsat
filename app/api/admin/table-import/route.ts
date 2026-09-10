import { NextRequest, NextResponse } from 'next/server';
import { importTable, type CsvTable } from '../../../../lib/table-csv-import';
import { prisma } from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TABLES = new Set<CsvTable>(['category', 'channel', 'source', 'program']);

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

    const result = await importTable(table, await file.text());
    const [categories, channels, sources, programs] = await Promise.all([
      prisma.category.count(), prisma.channel.count(), prisma.source.count(), prisma.program.count(),
    ]);
    return NextResponse.json({ ok: result.errors.length === 0, ...result, database: { categories, channels, sources, programs } }, { status: result.errors.length ? 207 : 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Table import failed' }, { status: 500 });
  }
}
