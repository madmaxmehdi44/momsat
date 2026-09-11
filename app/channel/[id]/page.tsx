import Link from 'next/link';
import { ArrowRight, Clock3, Heart, Radio, Share2 } from 'lucide-react';
import { findChannel, getCatalog } from '../../../lib/catalog-db';
import SmartPlayer from '../../../components/SmartPlayer';
import styles from './YouTubeWatchPage.module.css';

export const dynamic = 'force-dynamic';

export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const [channel, catalog] = await Promise.all([findChannel(id), getCatalog()]);
  if (!channel) return <main><h1>Channel not found</h1></main>;

  const related = catalog
    .filter((item) => item.id !== channel.id)
    .sort((a, b) => {
      const aSame = a.category === channel.category ? 1 : 0;
      const bSame = b.category === channel.category ? 1 : 0;
      return bSame - aSame || b.popular - a.popular;
    })
    .slice(0, 8);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/browse" className={styles.back}><ArrowRight size={18} /> بازگشت به خانه</Link>
        <Link href="/browse" className={styles.logo}>MOM<span>SAT</span></Link>
        <div className={styles.headerSpacer} />
      </header>

      <section className={styles.watchLayout}>
        <div className={styles.primaryColumn}>
          <div className={styles.playerFrame}><SmartPlayer channel={channel} /></div>

          <div className={styles.titleRow}>
            <div className={styles.titleBlock}>
              <div className={styles.liveLine}><span /> پخش زنده</div>
              <h1>{channel.name}</h1>
              <p>{channel.nameEn || 'Live Television'} · {channel.category || 'TV'} · {channel.sources.length} منبع</p>
            </div>
            <div className={styles.actions}>
              <button type="button"><Heart size={17} /> علاقه‌مندی</button>
              <button type="button"><Share2 size={17} /> اشتراک</button>
            </div>
          </div>

          <div className={styles.channelInfo}>
            <div className={styles.channelAvatar}>{(channel.nameEn || channel.name).slice(0, 2).toUpperCase()}</div>
            <div className={styles.channelIdentity}>
              <strong>{channel.nameEn || channel.name}</strong>
              <span>{channel.country || 'Live TV'} · {channel.sources.length} مسیر پخش</span>
            </div>
            <Link href={`/browse?q=${encodeURIComponent(channel.name)}`} className={styles.subscribe}>مشاهده شبکه‌های مشابه</Link>
          </div>

          <div className={styles.description}>
            <strong>درباره این شبکه</strong>
            <p>{channel.category} · {channel.platform || 'INTERNET'}{channel.satellite ? ` · ${channel.satellite}` : ''}{channel.frequency ? ` · ${channel.frequency}` : ''}</p>
            <div className={styles.badges}>
              <span><Radio size={14} /> {channel.iran ? 'قابل دسترسی برای ایران' : 'بین‌المللی'}</span>
              {channel.vpn ? <span>VPN</span> : null}
              {channel.vip ? <span>VIP</span> : null}
              <span><Clock3 size={14} /> زنده</span>
            </div>
          </div>
        </div>

        <aside className={styles.sidebar}>
          <div className={styles.sideHeading}>شبکه‌های پیشنهادی</div>
          <div className={styles.relatedList}>
            {related.map((item) => (
              <Link href={`/channel/${item.id}`} className={styles.related} key={item.id}>
                <div className={styles.relatedThumb}>
                  {item.image ? <img src={item.image} alt="" loading="lazy" /> : <span>{(item.nameEn || item.name).slice(0, 3).toUpperCase()}</span>}
                  <b>LIVE</b>
                </div>
                <div className={styles.relatedMeta}>
                  <strong>{item.name}</strong>
                  <span>{item.category || 'TV'}</span>
                  <span>{item.sources.length} منبع · زنده</span>
                </div>
              </Link>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
