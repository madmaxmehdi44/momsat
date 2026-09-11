export const dynamic = 'force-dynamic';

import { getCatalog } from '../../../lib/catalog-db';
import YouTubeWatchPage from '../../../components/YouTubeWatchPage';

export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return <main><h1>Channel not found</h1></main>;

  // Load the already-cached catalog once and derive both the requested channel
  // and its recommendations from the same snapshot. This avoids the previous
  // duplicate DB path where findChannel() and getCatalog() could normalize the
  // catalog independently on every channel navigation.
  const catalog = await getCatalog();
  const channel = catalog.find((item) => item.id === id) ?? null;
  if (!channel) return <main><h1>Channel not found</h1></main>;

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
