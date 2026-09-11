export const dynamic = 'force-dynamic';

import { getCatalog } from '../../lib/catalog-db';
import YouTubeBrowseShell from '../../components/YouTubeBrowseShell';

export default async function Browse({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const channels = await getCatalog();
  return <YouTubeBrowseShell channels={channels} initialQuery={sp.q || ''} />;
}
