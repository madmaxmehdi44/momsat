import { NextRequest, NextResponse } from 'next/server';
import { detectAndImportUpload } from '../../../../lib/universal-import';
import { prisma } from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const requestStart = Date.now();
  const configuredToken = process.env.ADMIN_TOKEN?.trim();
  const suppliedToken = req.headers.get('x-admin-token')?.trim();
  if (!configuredToken) return NextResponse.json({ ok: false, error: 'ADMIN_TOKEN is not configured; admin import is disabled.' }, { status: 503 });
  if (!suppliedToken || suppliedToken !== configuredToken) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const formStart = Date.now();
    const form = await req.formData();
    const file = form.get('file');
    const formDataMs = Date.now() - formStart;
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'A data file is required.' }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ ok: false, error: 'Maximum file size is 10 MB.' }, { status: 413 });

    const readStart = Date.now();
    const text = await file.text();
    const serverReadMs = Date.now() - readStart;

    const importResult = await detectAndImportUpload(file.name, text);

    const dbCountStart = Date.now();
    const [categories, channels, sources, programs] = await Promise.all([
      prisma.category.count(),
      prisma.channel.count(),
      prisma.source.count(),
      prisma.program.count(),
    ]);
    const dbCountMs = Date.now() - dbCountStart;

    const timing = {
      request: Date.now() - requestStart,
      formData: formDataMs,
      readFile: serverReadMs,
      ...importResult.timings,
      databaseCounts: dbCountMs,
    };

    return NextResponse.json({
      ok: importResult.result.errors.length === 0,
      format: importResult.format,
      detectedTable: importResult.table,
      confidence: importResult.confidence,
      reason: importResult.reason,
      rows: importResult.result.rows,
      created: importResult.result.created,
      updated: importResult.result.updated,
      skipped: importResult.result.skipped,
      errors: importResult.result.errors,
      ingestion: 'channelsCreated' in importResult.result ? {
        channelsCreated: importResult.result.channelsCreated,
        channelsMatched: importResult.result.channelsMatched,
        sourcesCreated: importResult.result.sourcesCreated,
        sourcesSkipped: importResult.result.sourcesSkipped,
      } : undefined,
      database: { categories, channels, sources, programs },
      timing,
    }, { status: importResult.result.errors.length ? 207 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Automatic import failed';
    return NextResponse.json({ ok: false, error: message, timing: { request: Date.now() - requestStart } }, { status: 400 });
  }
}
