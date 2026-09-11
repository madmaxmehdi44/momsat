export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { getCatalog } from '../../../lib/catalog-db';
import YouTubeWatchPage from '../../../components/YouTubeWatchPage';

export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  // Load the catalog once and derive both the requested channel and its
  // recommendations from the same snapshot.
  const catalog = await getCatalog();
  const channel = catalog.find((item) => item.id === id) ?? null;
  if (!channel) notFound();

  const recommendations = catalog
    .filter((item) => item.id !== channel.id)
    .sort((a, b) => {
      const aSameCategory = a.catId === channel.catId ? 1 : 0;
      const bSameCategory = b.catId === channel.catId ? 1 : 0;
      return bSameCategory - aSameCategory || b.popular - a.popular || b.sources.length - a.sources.length;
    })
    .slice(0, 12);

  return <YouTubeWatchPage channel={channel} recommendations={recommendations} />;
}
