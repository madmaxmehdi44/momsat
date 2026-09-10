import Link from 'next/link';
import { findChannel } from '../../../../lib/catalog-db';
import PlayerV2 from '../../../../components/PlayerV2';

export default async function DatabaseChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await findChannel(Number((await params).id));
  if (!c) return <main><header className="top"><div className="brand">MOM<span>SAT</span></div><nav><Link href="/">خانه</Link><Link href="/browse">شبکه‌ها</Link></nav></header><h1>Channel not found</h1></main>;
  return <main><header className="top"><div className="brand">MOM<span>SAT</span></div><nav><Link href="/">خانه</Link><Link href="/browse">شبکه‌ها</Link><Link href="/admin">مدیریت</Link></nav></header><section className="detail"><div className="detail-player"><PlayerV2 channel={c}/></div><div className="detail-copy"><div className="eyebrow">LIVE CHANNEL</div><h1>{c.name}</h1><h3>{c.nameEn}</h3><p>{c.category} · {c.sources.length} مسیر پخش</p><div className="badges"><span>{c.iran?'مناسب ایران':'خارج از ایران'}</span>{c.vpn&&<span>نیازمند VPN</span>}{c.vip&&<span>VIP</span>}</div></div></section><section className="detail-grid"><div><h2>جزئیات</h2><dl><dt>Channel ID</dt><dd>{c.id}</dd><dt>Category</dt><dd>{c.category} / {c.categoryEn}</dd><dt>Primary URL</dt><dd className="mono">{c.url}</dd><dt>Referer</dt><dd className="mono">{c.referer||'—'}</dd><dt>Origin</dt><dd className="mono">{c.origin||'—'}</dd></dl></div><div><h2>مسیرهای پخش</h2>{c.sources.map(s=><div className="source" key={s.id??s.url}><div><b>{s.title||'Source'}</b><div className="muted">{s.country||'unknown'}{s.vip?' · VIP':''}</div></div><div className="mono small">{s.url}</div></div>)}</div></section></main>;
}
