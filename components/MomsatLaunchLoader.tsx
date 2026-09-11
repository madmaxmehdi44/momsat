'use client';

import { Film, Newspaper, Radio, Tv } from 'lucide-react';
import styles from './MomsatLaunchLoader.module.css';

type Props = { visible: boolean };

export default function MomsatLaunchLoader({ visible }: Props) {
  return (
    <div className={`${styles.loader}${visible ? ` ${styles.visible}` : ` ${styles.hidden}`}`} aria-hidden={!visible}>
      <div className={styles.space}>
        <div className={styles.stars} />
        <div className={`${styles.orbit} ${styles.orbitOne}`} />
        <div className={`${styles.orbit} ${styles.orbitTwo}`} />
        <div className={styles.core}>
          <div className={styles.coreGlow} />
          <div className={styles.screen}>
            <div className={styles.signal} />
            <Tv size={34} strokeWidth={1.6} />
          </div>
          <div className={styles.coreLabel}>MOM<span>SAT</span></div>
        </div>
        <div className={`${styles.satellite} ${styles.satelliteTop}`}><Radio size={17} /></div>
        <div className={`${styles.satellite} ${styles.satelliteRight}`}><Film size={17} /></div>
        <div className={`${styles.satellite} ${styles.satelliteLeft}`}><Newspaper size={17} /></div>
      </div>
      <div className={styles.copy} dir="rtl">
        <div className={styles.title}>در حال اتصال به دنیای پخش زنده</div>
        <div className={styles.subtitle}>شبکه‌ها · فیلم و سریال · اخبار · سرگرمی</div>
        <div className={styles.progress}><span /></div>
      </div>
    </div>
  );
}
