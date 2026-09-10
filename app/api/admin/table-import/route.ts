import { NextRequest, NextResponse } from 'next/server';
import { detectAndImportUpload } from '../../../../lib/universal-import';
import { prisma } from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const configuredToken = process.env.ADMIN_TOKEN?.trim();
  const suppliedToken = req.headers.get('x-admin-token')?.trim();
  if (!configuredToken) return NextResponse.json({ ok: false, error: 'ADMIN_TOKEN is not configured; admin import is disabled.' }, { status: 503 });
  if (!suppliedToken || suppliedToken !== configuredToken) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'A data file is required.' }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ ok: false, error: 'Maximum file size is 10 MB.' }, { status: 413 });

    const text = await file.text();
    const detected = await detectAndImportUpload(file.name, text);
    const [categories, channels, sources, programs] = await Promise.all([
      prisma.category.count(),
      prisma.channel.count(),
      prisma.source.count(),
      prisma.program.count(),
    ]);

    return NextResponse.json({
      ok: detected.result.errors.length === 0,
      format: detected.format,
      detectedTable: detected.table,
      confidence: detected.confidence,
      reason: detected.reason,
      rows: detected.result.rows,
      created: detected.result.created,
      updated: detected.result.updated,
      skipped: detected.result.skipped,
      errors: detected.result.errors,
      ingestion: 'channelsCreated' in detected.result ? {
        channelsCreated: detected.result.channelsCreated,
        channelsMatched: detected.result.channelsMatched,
        sourcesCreated: detected.result.sourcesCreated,
        sourcesSkipped: detected.result.sourcesSkipped,
      } : undefined,
      database: { categories, channels, sources, programs },
    }, { status: detected.result.errors.length ? 207 : 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Automatic import failed' }, { status: 400 });
  }
}
