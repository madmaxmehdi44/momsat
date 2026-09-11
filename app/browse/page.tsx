export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getCatalog } from '../../lib/catalog-db';
import LiveChannelCatalog from '../../components/LiveChannelCatalog';

export default async function Browse({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const sp = await searchParams;
  const channels = await getCatalog();
  return <main>
    <header className="top"><div className="brand">MOM<span>SAT</span></div><nav><Link href="/">خانه</Link><Link href="/guide">راهنما</Link><Link href="/settings">تنظیمات</Link><Link href="/admin">مدیریت</Link></nav></header>
    <section className="browse-head"><div><div className="eyebrow">LIVE CATALOG / SMART SNAPSHOTS</div><h1>شبکه‌ها</h1><p>{channels.length} شبکه در کاتالوگ · تصویر زنده از خود استریم، کش محلی و بررسی هوشمند هنگام اسکرول</p></div></section>
    <LiveChannelCatalog channels={channels} initialQuery={sp.q || ''} initialCategory={sp.category || 'all'} />
  </main>;
}
