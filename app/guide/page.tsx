import Link from 'next/link';
import { getEpg } from '../../lib/epg';

function time(value: Date) {
  return new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(value);
}

function duration(start: Date, end: Date) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
}

export const dynamic = 'force-dynamic';

export default async function Guide() {
  const from = new Date();
  const to = new Date(from.getTime() + 24 * 60 * 60_000);
  const programs = await getEpg({ from, to });
  const groups = Array.from(new Map(programs.filter(p => p.channel).map(p => [p.channelId!, p.channel!])).entries());

  return <main>
    <header className="top"><div><div className="brand">MOM<span>SAT</span></div><div className="muted">Live Program Guide</div></div><nav><Link href="/">خانه</Link><Link href="/browse">شبکه‌ها</Link><Link href="/admin">مدیریت</Link></nav></header>
    <section className="browse-head"><div><div className="eyebrow">LIVE GUIDE / EPG</div><h1>راهنمای برنامه‌ها</h1><p>برنامه‌های ۲۴ ساعت آینده بر اساس زمان محلی دستگاه نمایش داده می‌شوند.</p></div></section>
    {groups.length===0 ? <div className="notice">هنوز EPG برای شبکه‌های کاتالوگ match نشده است. ابتدا یک منبع XMLTV در <span className="mono">EPG_XMLTV_URLS</span> تنظیم و از پنل مدیریت گزینه Sync EPG را اجرا کن.</div> : <div className="guide">{groups.map(([channelId, channel]) => {const rows=programs.filter(p=>p.channelId===channelId);return <section className="guide-row" key={channelId}><div className="guide-channel"><div className="fallback">{channel.nameEn?.slice(0,3).toUpperCase()||'TV'}</div><strong>{channel.name}</strong><span className="muted">{channel.nameEn}</span><Link className="more" href={`/channel/${channel.id}`}>مشاهده شبکه</Link></div><div className="guide-programs">{rows.map(p=><Link href={`/channel/${channel.id}`} className="program" key={p.id}><div className="program-time">{time(p.start)} — {time(p.end)}</div><strong>{p.title}</strong>{p.category&&<span className="muted">{p.category}</span>}<div className="program-duration">{duration(p.start,p.end)} دقیقه</div></Link>)}</div></section>})}</div>}
  </main>;
}