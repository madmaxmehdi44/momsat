'use client';

import styles from './MomsatLaunchLoader.module.css';

type Props = { visible?: boolean };

export default function MomsatLaunchLoader({ visible = true }: Props) {
  if (!visible) return null;

  return (
    <main className={styles.screen} aria-busy="true" aria-live="polite" aria-label="در حال بارگذاری MOMSAT">
      <div className={styles.glow} aria-hidden="true" />
      <section className={styles.card}>
        <div className={styles.mark} aria-hidden="true"><span>MOM</span><b>SAT</b></div>
        <div className={styles.signal} aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <p className={styles.title}>در حال آماده‌سازی MOMSAT</p>
        <p className={styles.subtitle}>در حال بارگذاری شبکه‌ها و سرویس پخش زنده</p>
        <div className={styles.track} aria-hidden="true"><span /></div>
      </section>
    </main>
  );
}
