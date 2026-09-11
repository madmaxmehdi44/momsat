export const dynamic = 'force-dynamic';

import { findChannel, getCatalog } from '../../../lib/catalog-db';
import YouTubeWatchPage from '../../../components/YouTubeWatchPage';

export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const [channel, catalog] = await Promise.all([findChannel(id), getCatalog()]);
  if (!channel) return <main><h1>Channel not found</h1></main>;

  const recommendations = [...catalog]
    .filter((item) => item.id !== channel.id)
    .sort((a, b) => {
      const aSameCategory = a.catId === channel.catId ? 1 : 0;
      const bSameCategory = b.catId === channel.catId ? 1 : 0;
      return bSameCategory - aSameCategory || b.popular - a.popular || b.sources.length - a.sources.length;
    })
    .slice(0, 12);

  return <YouTubeWatchPage channel={channel} recommendations={recommendations} />;
}
