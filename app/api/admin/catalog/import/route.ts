import { NextRequest, NextResponse } from 'next/server';
import { importCatalogCsv } from '../../../../../lib/catalog-import';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-admin-token');
  if (process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const form = await req.formData();
    const channels = form.get('channels');
    const verified = form.get('verified');
    if (!(channels instanceof File) || !(verified instanceof File)) return NextResponse.json({ ok: false, error: 'Both channels and verified CSV files are required.' }, { status: 400 });
    if (!channels.name.toLowerCase().endsWith('.csv') || !verified.name.toLowerCase().endsWith('.csv')) return NextResponse.json({ ok: false, error: 'Only CSV files are accepted.' }, { status: 400 });
    if (channels.size > MAX_FILE_BYTES || verified.size > MAX_FILE_BYTES) return NextResponse.json({ ok: false, error: 'Each CSV must be 5 MB or smaller.' }, { status: 413 });
    const result = await importCatalogCsv(await channels.text(), await verified.text());
    return NextResponse.json({ ok: result.errors.length === 0, ...result }, { status: result.errors.length ? 207 : 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Catalog import failed' }, { status: 500 });
  }
}
