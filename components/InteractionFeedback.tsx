'use client';

import { Check, LoaderCircle, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { subscribeActionFeedback, type ActionFeedbackPayload } from '../lib/action-feedback';
import styles from './InteractionFeedback.module.css';
import { usePathname } from 'next/navigation';

export default function InteractionFeedback() {
  const pathname = usePathname();
  const [actions, setActions] = useState<Record<string, ActionFeedbackPayload>>({});
  const [navId, setNavId] = useState<string | null>(null);
  const [navHref, setNavHref] = useState<string | null>(null);

  useEffect(() => subscribeActionFeedback((payload) => {
    setActions((current) => {
      if (payload.status === 'start') return { ...current, [payload.id]: payload };
      const next = { ...current };
      const previous = next[payload.id];
      if (!previous) return current;
      if (payload.status === 'error') next[payload.id] = { ...previous, ...payload };
      else delete next[payload.id];
      return next;
    });
  }), []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash === window.location.hash) return;

      const id = `navigation:${url.pathname}${url.search}${url.hash}`;
      if (navId === id) {
        event.preventDefault();
        return;
      }
      setNavId(id);
      setNavHref(`${url.pathname}${url.search}`);
      setActions((current) => ({ ...current, [id]: { id, label: 'در حال باز کردن صفحه', status: 'start' } }));
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [navId]);

  useEffect(() => {
    if (!navId) return;
    const expected = navHref?.split('?')[0] || '';
    if (pathname !== expected) return;
    setActions((current) => {
      const next = { ...current };
      delete next[navId];
      return next;
    });
    setNavId(null);
    setNavHref(null);
  }, [pathname, navId, navHref]);

  const active = useMemo(() => Object.values(actions).filter((item) => item.status === 'start'), [actions]);
  const errors = useMemo(() => Object.values(actions).filter((item) => item.status === 'error'), [actions]);

  useEffect(() => {
    if (!errors.length) return;
    const timer = window.setTimeout(() => setActions((current) => {
      const next = { ...current };
      for (const error of errors) delete next[error.id];
      return next;
    }), 2200);
    return () => window.clearTimeout(timer);
  }, [errors]);

  if (!active.length && !errors.length) return null;

  const primary = active[0];
  return <div className={styles.root} dir="rtl" aria-live="polite" aria-atomic="true">
    {active.length ? <div className={styles.progress}><span /></div> : null}
    <div className={`${styles.panel} ${errors.length ? styles.error : ''}`} role="status">
      {errors.length ? <X size={17} /> : <LoaderCircle size={17} className={styles.spin} />}
      <div className={styles.copy}>
        <strong>{errors.length ? errors[0].detail || 'عملیات ناموفق بود' : primary?.label}</strong>
        {active.length > 1 ? <small>{active.length} عملیات هم‌زمان در حال انجام است</small> : navHref ? <small>{navHref}</small> : null}
      </div>
      {!errors.length && active.length === 0 ? <Check size={17} /> : null}
    </div>
  </div>;
}
