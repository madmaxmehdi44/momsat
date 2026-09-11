'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Clock3, Compass, Heart, Home, Menu, Radio, Search, Settings, Tv, UserCircle, Activity } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { subscribeActionFeedback, type ActionFeedbackPayload } from '../lib/action-feedback';
import styles from './MomsatAppChrome.module.css';

type Health = { ok?: boolean; database?: string; catalog?: { channels?: number; sources?: number }; adapters?: Array<{ enabled?: boolean; configured?: boolean }> };

type Props = { children: React.ReactNode };

function activePath(pathname: string | null, path: string) {
  if (path === '/browse') return pathname === '/browse' || pathname === '/';
  return Boolean(pathname?.startsWith(path));
}

export default function MomsatAppChrome({ children }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [running, setRunning] = useState(0);
  const [lastAction, setLastAction] = useState<ActionFeedbackPayload | null>(null);

  const browsePage = pathname === '/browse' || pathname === '/';

  useEffect(() => {
    try { setOpen(localStorage.getItem('momsat.chrome.sidebar') !== 'collapsed'); } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem('momsat.chrome.sidebar', open ? 'open' : 'collapsed'); } catch {}
  }, [open]);

  useEffect(() => {
    if (browsePage) return;

    let alive = true;
    let timer: number | undefined;
    let requestTimer: number | undefined;

    const load = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`health:${response.status}`);
        const body = await response.json() as Health;
        if (alive) setHealth(body);
      } catch {
        if (alive) setHealth((current) => current ?? { ok: false });
      } finally {
        window.clearTimeout(timeout);
      }
    };

    requestTimer = window.setTimeout(() => { void load(); }, 500);
    timer = window.setInterval(() => { void load(); }, 30_000);

    return () => {
      alive = false;
      if (requestTimer !== undefined) window.clearTimeout(requestTimer);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [browsePage]);

  useEffect(() => subscribeActionFeedback((payload) => {
    setLastAction(payload);
    setRunning((count) => payload.status === 'start' ? count + 1 : Math.max(0, count - 1));
  }), []);

  const navItems = useMemo(() => [
    ['/browse', 'خانه', Home],
    ['/browse?category=all', 'کشف شبکه‌ها', Compass],
    ['/guide', 'راهنمای پخش', Radio],
    ['/browse?favorites=1', 'علاقه‌مندی‌ها', Heart],
    ['/browse?recent=1', 'اخیراً تماشا شده', Clock3],
    ['/settings', 'تنظیمات', Settings],
    ['/admin', 'مدیریت MOMSAT', Tv],
  ] as const, []);

  if (browsePage) return <>{children}</>;

  const channels = health?.catalog?.channels ?? 0;
  const sources = health?.catalog?.sources ?? 0;
  const adapters = health?.adapters?.filter((item) => item.enabled && item.configured).length ?? 0;
  const systemOk = health?.ok !== false;

  return <div className={`${styles.shell}${open ? '' : ` ${styles.collapsed}`}`} dir="rtl">
    <header className={styles.header}>
      <div className={styles.headerSide}>
        <button className={styles.iconButton} onClick={() => setOpen((value) => !value)} aria-label="نمایش یا مخفی کردن منوی اصلی"><Menu size={21} /></button>
        <Link href="/browse" className={styles.logo}>MOM<span>SAT</span></Link>
      </div>
      <Link href="/browse" className={styles.searchBar} aria-label="جستجوی شبکه">
        <Search size={18} />
        <span>جستجوی شبکه، ورزش، اخبار، موسیقی...</span>
        <kbd>⌘ K</kbd>
      </Link>
      <div className={styles.headerActions}>
        <div className={styles.pipelineBadge} title={lastAction?.label || 'Global action pipeline'}>
          <Activity size={14} className={running ? styles.pulse : ''} />
          <span>{running ? `${running} عملیات` : systemOk ? 'سیستم آنلاین' : 'نیازمند بررسی'}</span>
          <i className={systemOk ? styles.online : styles.offline} />
        </div>
        <button className={styles.iconButton} aria-label="اعلان‌ها"><Bell size={19} /></button>
        <Link href="/settings" className={styles.avatar} aria-label="تنظیمات"><UserCircle size={28} /></Link>
      </div>
    </header>

    <div className={styles.body}>
      <aside className={styles.sidebar}>
        <nav className={styles.nav}>
          {navItems.map(([href, label, Icon], index) => <div key={`${href}-${index}`} className={styles.navWrap}>
            <Link className={`${styles.navItem}${activePath(pathname, href.split('?')[0]) ? ` ${styles.active}` : ''}`} href={href}><Icon size={19} /><span>{label}</span></Link>
            {index === 2 || index === 4 ? <div className={styles.divider} /> : null}
          </div>)}
        </nav>
        <div className={styles.systemCard}>
          <div className={styles.systemTitle}><span>PIPELINE / SYSTEM</span><i className={systemOk ? styles.online : styles.offline} /></div>
          <div className={styles.systemRow}><span>Catalog</span><strong>{channels.toLocaleString('fa-IR')}</strong></div>
          <div className={styles.systemRow}><span>Sources</span><strong>{sources.toLocaleString('fa-IR')}</strong></div>
          <div className={styles.systemRow}><span>Adapters</span><strong>{adapters.toLocaleString('fa-IR')}</strong></div>
        </div>
      </aside>

      <main className={styles.content}>
        <div className={styles.contentInner}>{children}</div>
      </main>
    </div>

    <nav className={styles.mobileNav} aria-label="ناوبری اصلی">
      {navItems.slice(0, 5).map(([href, label, Icon]) => <Link key={href} className={`${styles.mobileItem}${activePath(pathname, href.split('?')[0]) ? ` ${styles.mobileActive}` : ''}`} href={href}><Icon size={18} /><span>{label}</span></Link>)}
    </nav>
  </div>;
}
