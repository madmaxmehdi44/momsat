export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { getCatalog, findChannel } from '../../../lib/catalog-db';
import ChannelProfilePage from '../../../components/ChannelProfilePage';

export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const channel = await findChannel(id);
  if (!channel) notFound();

  const catalog = await getCatalog();
  const recommendations = catalog
    .filter((item) => item.id !== channel.id)
    .sort((a, b) => {
      const aSameCategory = a.catId === channel.catId ? 1 : 0;
      const bSameCategory = b.catId === channel.catId ? 1 : 0;
      return bSameCategory - aSameCategory || b.popular - a.popular || b.sources.length - a.sources.length;
    })
    .slice(0, 12);

  return <ChannelProfilePage channel={channel} recommendations={recommendations} />;
}
