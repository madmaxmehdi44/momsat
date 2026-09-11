'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import styles from './stream-validator.module.css';

type Probe = {
  channelId: number; channelName: string; url: string; protocol: 'HLS' | 'DASH' | 'DIRECT' | 'UNKNOWN';
  reachable: boolean; live: boolean | null; buffering: boolean; manifestLoaded: boolean; mediaLoaded: boolean;
  changedDuringProbe: boolean | null; latencyMs: number | null; mediaBytes: number | null;
  mediaSequenceBefore: string | null; mediaSequenceAfter: string | null; contentType: string | null;
  verdict: 'HEALTHY' | 'SUSPECT' | 'BROKEN'; score: number; reason: string; checkedAt: string;
};

type Channel = { id: number; name: string; nameEn: string; image: string | null; url: string; sources: { url: string }[] };
const TOKEN_KEY = 'momsat.admin.token';

const verdictText = { HEALTHY: 'سالم و زنده', SUSPECT: 'نیازمند بررسی', BROKEN: 'خراب' } as const;
const verdictClass = (value: Probe['verdict']) => value === 'HEALTHY' ? styles.healthy : value === 'SUSPECT' ? styles.suspect : styles.broken;

export default function StreamValidatorPage() {
  const [token, setToken] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [results, setResults] = useState<Probe[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | Probe['verdict']>('all');

  useEffect(() => {
    try { setToken(localStorage.getItem(TOKEN_KEY) || ''); } catch {}
  }, []);

  const headers = () => token.trim() ? { 'x-admin-token': token.trim() } : {};

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/admin/stream-validator', { cache: 'no-store', headers: headers() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'دریافت استریم‌ها ناموفق بود');
      setChannels(body.channels || []);
    } catch (err) { setError(err instanceof Error ? err.message : 'خطای نامشخص'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function validateAll() {
    setRunning(true); setError(''); setResults([]);
    try {
      const response = await fetch('/api/admin/stream-validator', {
        method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, body: JSON.stringify({}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'صحت‌سنجی ناموفق بود');
      setResults(body.results || []);
    } catch (err) { setError(err instanceof Error ? err.message : 'صحت‌سنجی ناموفق بود'); }
    finally { setRunning(false); }
  }

  async function activate(result: Probe) {
    setActivating(`${result.channelId}:${result.url}`); setError('');
    try {
      const response = await fetch('/api/admin/stream-validator', {
        method: 'PATCH', headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ channelId: result.channelId, url: result.url, verdict: result.verdict }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'فعال‌سازی ناموفق بود');
      await load();
      setResults((items) => items.map((item) => item.channelId === result.channelId && item.url === result.url ? { ...item, verdict: 'HEALTHY', reason: 'تأیید و فعال شد؛ در کاتالوگ پخش قرار گرفت.' } : item));
    } catch (err) { setError(err instanceof Error ? err.message : 'فعال‌سازی ناموفق بود'); }
    finally { setActivating(null); }
  }

  const counts = useMemo(() => ({
    total: results.length,
    healthy: results.filter((r) => r.verdict === 'HEALTHY').length,
    suspect: results.filter((r) => r.verdict === 'SUSPECT').length,
    broken: results.filter((r) => r.verdict === 'BROKEN').length,
  }), [results]);
  const visible = filter === 'all' ? results : results.filter((r) => r.verdict === filter);

  return <main dir="rtl" className={styles.page}>
    <div className={styles.inner}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>MOMSAT · STREAM VALIDATOR</div>
          <h1 className={styles.title}>صحت‌سنجی واقعی استریم‌ها</h1>
          <p className={styles.description}>لینک‌ها را از نظر دسترسی HTTP، مانيفست HLS/DASH، قطعه رسانه و الگوی تغییر جریان بررسی می‌کند؛ نتیجه فقط بعد از تأیید ادمین وارد چرخه پخش می‌شود.</p>
        </div>
        <Link href="/admin" className={styles.back}>بازگشت به مدیریت</Link>
      </header>

      <section className={styles.toolbar}>
        <input className={styles.token} value={token} onChange={(e) => { setToken(e.target.value); try { localStorage.setItem(TOKEN_KEY, e.target.value); } catch {} }} placeholder="ADMIN_TOKEN در صورت نیاز" type="password" />
        <button className={styles.primary} disabled={running || loading} onClick={() => void validateAll()}>{running ? 'در حال صحت‌سنجی…' : 'شروع صحت‌سنجی همه استریم‌ها'}</button>
        <button className={styles.secondary} disabled={loading || running} onClick={() => void load()}>بازخوانی لیست</button>
      </section>

      <section className={styles.stats}>
        <button className={`${styles.stat} ${filter === 'all' ? styles.selected : ''}`} onClick={() => setFilter('all')}><span>نتایج تست</span><strong>{counts.total}</strong></button>
        <button className={`${styles.stat} ${filter === 'HEALTHY' ? styles.selected : ''}`} onClick={() => setFilter('HEALTHY')}><span>سالم</span><strong>{counts.healthy}</strong></button>
        <button className={`${styles.stat} ${filter === 'SUSPECT' ? styles.selected : ''}`} onClick={() => setFilter('SUSPECT')}><span>مشکوک</span><strong>{counts.suspect}</strong></button>
        <button className={`${styles.stat} ${filter === 'BROKEN' ? styles.selected : ''}`} onClick={() => setFilter('BROKEN')}><span>خراب</span><strong>{counts.broken}</strong></button>
        <div className={styles.stat}><span>استریم‌های موجود</span><strong>{channels.length}</strong></div>
      </section>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.empty}>در حال دریافت لیست استریم‌های فعال…</div>}
      {!loading && !results.length && <div className={styles.empty}>برای شروع، «شروع صحت‌سنجی همه استریم‌ها» را بزن. هیچ تغییری در دیتابیس تا زمان تأیید شما انجام نمی‌شود.</div>}

      {visible.length > 0 && <div className={styles.list}>
        {visible.map((result) => {
          const key = `${result.channelId}:${result.url}`;
          const canActivate = result.verdict === 'HEALTHY';
          return <article key={key} className={styles.card}>
            <div className={styles.cardTop}>
              <div>
                <div className={styles.nameLine}><strong>{result.channelName}</strong><span className={verdictClass(result.verdict)}>{verdictText[result.verdict]}</span></div>
                <div className={styles.url}>{result.url}</div>
              </div>
              <div className={styles.score}><span>امتیاز</span><strong>{result.score}</strong>/100</div>
            </div>
            <div className={styles.grid}>
              <div><span>پروتکل</span><strong>{result.protocol}</strong></div>
              <div><span>قابل دسترسی</span><strong>{result.reachable ? 'بله' : 'خیر'}</strong></div>
              <div><span>Live</span><strong>{result.live === true ? 'تشخیص داده شد' : result.live === false ? 'تشخیص نشد' : 'نامشخص'}</strong></div>
              <div><span>Buffer / Media</span><strong>{result.buffering && result.mediaLoaded ? `${result.mediaBytes ?? 0} bytes` : 'ناموفق'}</strong></div>
              <div><span>Latency</span><strong>{result.latencyMs == null ? '—' : `${result.latencyMs} ms`}</strong></div>
              <div><span>تغییر جریان</span><strong>{result.changedDuringProbe === true ? 'بله' : result.changedDuringProbe === false ? 'خیر' : 'نامشخص'}</strong></div>
            </div>
            <div className={styles.reason}>{result.reason}</div>
            <div className={styles.actions}>
              {canActivate ? <button className={styles.activate} disabled={activating === key} onClick={() => void activate(result)}>{activating === key ? 'در حال ثبت…' : 'تأیید و ورود به لیست پخش'}</button> : <button className={styles.disabled} disabled>نیازمند تأیید دستی / لینک جایگزین</button>}
              <Link href={`/watch/${result.channelId}`} className={styles.watch}>باز کردن کانال</Link>
            </div>
          </article>;
        })}
      </div>}
    </div>
  </main>;
}
