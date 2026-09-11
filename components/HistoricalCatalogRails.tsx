'use client';

import Link from 'next/link';
import type { HistoricalChannel } from '../lib/historical-catalog';
import styles from './HistoricalCatalogRails.module.css';

type Props = { memory: HistoricalChannel[]; shutdown: HistoricalChannel[] };

function Rail({ title, subtitle, items, shutdown }: { title: string; subtitle: string; items: HistoricalChannel[]; shutdown?: boolean }) {
  if (!items.length) return null;
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.heading}><div><h2>{title}</h2><p>{subtitle}</p></div><span>{items.length} شبکه</span></div>
      <div className={styles.rail}>
        {items.map((item) => (
          <article className={styles.card} key={`${item.status}-${item.id}`}>
            <div className={styles.imageWrap}>
              {item.image ? <img src={item.image} alt={item.name} loading="lazy" decoding="async" /> : <div className={styles.fallback}>{(item.nameEn || item.name).slice(0, 3).toUpperCase()}</div>}
              <span className={shutdown ? styles.shutdown : styles.memory}>{shutdown ? 'خاموش‌شده' : 'خاطره‌انگیز'}</span>
            </div>
            <div className={styles.body}><h3>{item.name}</h3><p>{item.nameEn}</p>{item.note ? <small>{item.note}</small> : null}{shutdown ? null : <Link href={`/channel/${item.channelId}`}>مشاهده اطلاعات</Link>}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function HistoricalCatalogRails({ memory, shutdown }: Props) {
  return <div className={styles.root}><Rail title="شبکه‌های خاطره‌انگیز" subtitle="شبکه‌هایی که در آرشیو MOMSAT به‌عنوان بخشی از تاریخ تلویزیون ثبت شده‌اند" items={memory} /><Rail title="شبکه‌های خاموش‌شده" subtitle="شبکه‌هایی که پخش آن‌ها به‌صورت مستقل در کاتالوگ تاریخی ثبت شده است" items={shutdown} shutdown /></div>;
}
