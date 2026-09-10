import { NextRequest, NextResponse } from 'next/server';
import { importCatalogCsv } from '../../../../../lib/catalog-import';
import { prisma } from '../../../../../lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function validCsv(file: File) {
  return file.name.toLowerCase().endsWith('.csv') && file.size <= MAX_FILE_BYTES;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-admin-token');
  if (process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const channels = form.get('channels');
    const verified = form.get('verified');

    if (!(channels instanceof File) || !(verified instanceof File)) {
      return NextResponse.json({ ok: false, error: 'Both channels and verified CSV files are required.' }, { status: 400 });
    }
    if (!validCsv(channels) || !validCsv(verified)) {
      return NextResponse.json({ ok: false, error: 'Only CSV files up to 5 MB each are accepted.' }, { status: 413 });
    }

    const [channelsText, verifiedText] = await Promise.all([channels.text(), verified.text()]);
    const result = await importCatalogCsv(channelsText, verifiedText);
    const [channelsCount, sourcesCount, categoriesCount] = await Promise.all([
      prisma.channel.count(),
      prisma.source.count(),
      prisma.category.count(),
    ]);

    return NextResponse.json({
      ok: result.errors.length === 0,
      ...result,
      database: { channels: channelsCount, sources: sourcesCount, categories: categoriesCount },
    }, { status: result.errors.length ? 207 : 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Catalog import failed' }, { status: 500 });
  }
}
