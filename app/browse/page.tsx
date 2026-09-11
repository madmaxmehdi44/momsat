export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getCatalog, getCategories } from '../../lib/catalog-db';

function thumbnailSrc(image: string | null, name: string) {
  if (!image) return null;
  return `/api/channel-thumbnail?url=${encodeURIComponent(image)}&name=${encodeURIComponent(name)}`;
}

export default async function Browse({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const sp = await searchParams;
  let channels = await getCatalog();
  if (sp.q) { const q = sp.q.toLowerCase(); channels = channels.filter(c => `${c.name} ${c.nameEn}`.toLowerCase().includes(q)); }
  if (sp.category) channels = channels.filter(c => String(c.catId) === sp.category);
  return <main><header className="top"><div className="brand">MOM<span>SAT</span></div><nav><Link href="/">خانه</Link><Link href="/guide">راهنما</Link><Link href="/settings">تنظیمات</Link><Link href="/admin">مدیریت</Link></nav></header><section className="browse-head"><div><div className="eyebrow">LIVE CATALOG</div><h1>شبکه‌ها</h1><p>{channels.length} شبکه در کاتالوگ</p></div><form><input name="q" defaultValue={sp.q} placeholder="جستجوی نام شبکه…"/><button className="btn primary">جستجو</button></form></section><div className="filter-row">{getCategories(channels).map(c => <Link className={String(c.id)===sp.category?'active':''} key={c.id} href={`/browse?category=${c.id}`}>{c.name}</Link>)}</div><div className="grid large">{channels.map(c => { const image = thumbnailSrc(c.image, c.name); return <Link className="card" key={c.id} href={`/channel/${c.id}`}><div className="thumb">{image ? <img src={image} alt={c.name} loading="lazy" decoding="async" style={{width:'100%',height:'100%',objectFit:'cover'}}/> : <div className="fallback">{c.nameEn?.slice(0,3).toUpperCase()||'TV'}</div>}<span className="live">LIVE</span></div><div className="card-body"><div className="title">{c.name}</div><div className="meta">{c.nameEn} · {c.sources.length} source</div></div></Link>; })}</div></main>;
}
