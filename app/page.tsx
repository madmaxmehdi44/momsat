export const dynamic = 'force-dynamic';

import { getCatalog } from '../lib/catalog-db';
import YouTubeBrowseShellV2 from '../components/YouTubeBrowseShellV2';

export default async function RootPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; favorites?: string; recent?: string }> }) {
  const sp = await searchParams;
  const channels = await getCatalog();

  return (
    <YouTubeBrowseShellV2
      channels={channels}
      initialQuery={sp.q || ''}
      initialCategory={sp.category || 'all'}
      initialLibraryMode={sp.favorites === '1' ? 'favorites' : sp.recent === '1' ? 'recent' : 'all'}
    />
  );
}
