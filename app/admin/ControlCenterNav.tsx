'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Database, History, Radio, UploadCloud, RefreshCw, ScanSearch } from 'lucide-react';
import { useEffect, useState } from 'react';
import { subscribeActionFeedback, type ActionFeedbackPayload } from '../../lib/action-feedback';
import styles from './control-center.module.css';

const items = [
  { href: '/admin', label: 'کاتالوگ و Import', icon: UploadCloud, exact: true },
  { href: '/admin/stream-validator', label: 'صحت‌سنجی استریم', icon: ScanSearch },
  { href: '/admin/stream-health', label: 'سلامت استریم', icon: Radio },
  { href: '/admin/historical', label: 'آرشیو تاریخی', icon: History },
];

export default function ControlCenterNav() {
  const pathname = usePathname();
  const [running, setRunning] = useState(0);
  const [lastAction, setLastAction] = useState<ActionFeedbackPayload | null>(null);

  useEffect(() => subscribeActionFeedback((payload) => {
    setLastAction(payload);
    setRunning((value) => payload.status === 'start' ? value + 1 : Math.max(0, value - 1));
  }), []);

  return (
    <section className={styles.wrapper} aria-label="مرکز کنترل مدیریت MOMSAT">
      <div className={styles.topline}>
        <div>
          <div className={styles.eyebrow}>MOMSAT · CONTROL CENTER</div>
          <div className={styles.heading}>مرکز کنترل سیستم</div>
        </div>
        <div className={styles.pipeline} title={lastAction?.label || 'Global action pipeline'}>
          <Activity size={15} className={running ? styles.pulse : ''} />
          <span>{running ? `${running} عملیات در حال اجرا` : 'Pipeline آماده'}</span>
          <i />
        </div>
      </div>

      <nav className={styles.nav} aria-label="بخش‌های مدیریت">
        {items.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : Boolean(pathname?.startsWith(href));
          return (
            <Link key={href} href={href} className={`${styles.item}${active ? ` ${styles.active}` : ''}`}>
              <Icon size={17} />
              <span>{label}</span>
            </Link>
          );
        })}
        <Link href="/browse" className={styles.exit}>بازگشت به محصول</Link>
      </nav>

      <div className={styles.statusRow}>
        <span><Database size={13} /> Catalog / Sources</span>
        <span><RefreshCw size={13} /> عملیات از طریق Action Pipeline</span>
      </div>
    </section>
  );
}
