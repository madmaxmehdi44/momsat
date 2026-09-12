'use client';

import { Satellite, Tv } from 'lucide-react';
import styles from './MomsatLaunchLoader.module.css';

type Props = { visible?: boolean };

export default function MomsatLaunchLoader({ visible = true }: Props) {
  if (!visible) return null;
  return (
    <main className={`${styles.loader} ${styles.visible}`} aria-busy="true" aria-live="polite" aria-label="در حال بارگذاری MOMSAT">
      <div className={styles.space} aria-hidden="true">
        <div className={`${styles.stars}`} />
        <div className={`${styles.orbit} ${styles.orbitOne}`} />
        <div className={`${styles.orbit} ${styles.orbitTwo}`} />
        <div className={styles.core}>
          <div className={styles.coreGlow} />
          <div className={styles.screen}>
            <div className={styles.signal} />
            <Tv size={30} strokeWidth={1.7} />
          </div>
          <div className={styles.coreLabel}>MOM<span>SAT</span></div>
        </div>
        <div className={`${styles.satellite} ${styles.satelliteTop}`}><Satellite size={18} /></div>
        <div className={`${styles.satellite} ${styles.satelliteRight}`}><Satellite size={16} /></div>
        <div className={`${styles.satellite} ${styles.satelliteLeft}`}><Satellite size={15} /></div>
      </div>
      <div className={styles.copy}>
        <div className={styles.title}>در حال آماده‌سازی MOMSAT</div>
        <div className={styles.subtitle}>در حال بارگذاری شبکه‌ها و سرویس پخش زنده</div>
        <div className={styles.progress} aria-hidden="true"><span /></div>
      </div>
    </main>
  );
}
