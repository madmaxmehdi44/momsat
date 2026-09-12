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
  const groups = Array.from(new Map(programs.filter((p) => p.channel).map((p) => [p.channelId!, p.channel!])).entries());

  return <main className="momsat-guide-page" dir="rtl">
    <section className="momsat-page-heading">
      <div>
        <div className="momsat-eyebrow">LIVE GUIDE / EPG</div>
        <h1>راهنمای برنامه‌ها</h1>
        <p>برنامه‌های ۲۴ ساعت آینده بر اساس زمان محلی دستگاه نمایش داده می‌شوند.</p>
      </div>
      <Link className="momsat-primary-link" href="/">بازگشت به صفحه اصلی</Link>
    </section>

    {groups.length === 0 ? (
      <div className="momsat-notice">هنوز EPG برای شبکه‌های کاتالوگ match نشده است. ابتدا یک منبع XMLTV در <span className="momsat-mono">EPG_XMLTV_URLS</span> تنظیم و از پنل مدیریت گزینه Sync EPG را اجرا کن.</div>
    ) : (
      <div className="momsat-guide-grid">
        {groups.map(([channelId, channel]) => {
          const rows = programs.filter((p) => p.channelId === channelId);
          return <section className="momsat-guide-row" key={channelId}>
            <div className="momsat-guide-channel">
              {channel.image ? <img src={channel.image} alt="" loading="lazy" /> : <div className="momsat-guide-fallback">{channel.nameEn?.slice(0, 3).toUpperCase() || 'TV'}</div>}
              <strong>{channel.name}</strong>
              <span>{channel.nameEn}</span>
              <Link href={`/channel/${channel.id}`}>مشاهده شبکه</Link>
            </div>
            <div className="momsat-guide-programs">
              {rows.map((p) => <Link href={`/channel/${channel.id}`} className="momsat-program" key={p.id}>
                <div className="momsat-program-time">{time(p.start)} — {time(p.end)}</div>
                <strong>{p.title}</strong>
                {p.category ? <span>{p.category}</span> : null}
                <small>{duration(p.start, p.end)} دقیقه</small>
              </Link>)}
            </div>
          </section>;
        })}
      </div>
    )}
  </main>;
}
