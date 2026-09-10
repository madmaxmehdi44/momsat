import { NextRequest, NextResponse } from 'next/server';
import { fetchCatalogSources } from '../../../../lib/source';
import { prisma } from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-admin-token');
  if (process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 400 });
    }

    const sourceResults = await fetchCatalogSources();
    const configuredFailures = sourceResults.filter((result) => result.status === 'failed');
    const channels = sourceResults.flatMap((result) => result.channels);

    let sources = 0;
    for (const channel of channels) {
      await prisma.category.upsert({
        where: { id: channel.catId },
        update: { name: channel.category, nameEn: channel.categoryEn },
        create: { id: channel.catId, name: channel.category, nameEn: channel.categoryEn },
      });

      const normalizedSources = channel.sources
        .filter((source) => source.id !== null)
        .map((source) => ({
          id: source.id!,
          title: source.title,
          url: source.url,
          referer: source.referer,
          origin: source.origin,
          country: source.country,
          vip: source.vip,
        }));

      await prisma.channel.upsert({
        where: { id: channel.id },
        update: {
          name: channel.name,
          nameEn: channel.nameEn,
          image: channel.image,
          url: channel.url,
          referer: channel.referer,
          origin: channel.origin,
          vpn: channel.vpn,
          iran: channel.iran,
          popular: channel.popular,
          vip: channel.vip,
          categoryId: channel.catId,
          categoryName: channel.category,
          categoryNameEn: channel.categoryEn,
          sources: { deleteMany: {}, create: normalizedSources },
        },
        create: {
          id: channel.id,
          name: channel.name,
          nameEn: channel.nameEn,
          image: channel.image,
          url: channel.url,
          referer: channel.referer,
          origin: channel.origin,
          vpn: channel.vpn,
          iran: channel.iran,
          popular: channel.popular,
          vip: channel.vip,
          categoryId: channel.catId,
          categoryName: channel.category,
          categoryNameEn: channel.categoryEn,
          sources: { create: normalizedSources },
        },
      });

      sources += normalizedSources.length;
    }

    const skipped = sourceResults
      .filter((result) => result.status === 'disabled' || result.status === 'unconfigured')
      .map((result) => ({ adapter: result.adapter, status: result.status, error: result.error }));

    const failures = configuredFailures.map((result) => ({
      adapter: result.adapter,
      status: result.status,
      error: result.error,
    }));

    return NextResponse.json({
      ok: configuredFailures.length === 0,
      message: `Fetched ${channels.length} channels and synced ${sources} sources`,
      providers: sourceResults.map((result) => ({
        adapter: result.adapter,
        status: result.status,
        channels: result.channels.length,
        error: result.error,
      })),
      skipped,
      failures,
    }, { status: configuredFailures.length > 0 && channels.length === 0 ? 502 : 200 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'sync failed',
    }, { status: 500 });
  }
}
