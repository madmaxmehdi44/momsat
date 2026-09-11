'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './stream-health.module.css';

type StreamRow = {
  id: number;
  channelId: number;
  url: string;
  status: 'UNKNOWN' | 'HEALTHY' | 'SUSPECT' | 'BROKEN' | 'ARCHIVED';
  successCount: number;
  failureCount: number;
  failureStreak: number;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastLatencyMs: number | null;
  averageLatencyMs: number | null;
  lastError: string | null;
  disabledReason: string | null;
  channel: { id: number; name: string; nameEn: string; image: string | null };
};

const tokenStorageKey = 'momsat.admin.token';

function label(status: StreamRow['status']) {
  if (status === 'BROKEN') return 'خراب';
  if (status === 'SUSPECT') return 'مشکوک';
  if (status === 'ARCHIVED') return 'آرشیو';
  if (status === 'HEALTHY') return 'سالم';
  return 'نامشخص';
}

function badgeClass(status: StreamRow['status']) {
  if (status === 'HEALTHY') return `${styles.badge} ${styles.badgeHealthy}`;
  if (status === 'SUSPECT') return `${styles.badge} ${styles.badgeSuspect}`;
  if (status === 'BROKEN') return `${styles.badge} ${styles.badgeBroken}`;
  if (status === 'ARCHIVED') return `${styles.badge} ${styles.badgeArchived}`;
  return styles.badge;
}

export default function StreamHealthAdminPage() {
  const [token, setToken] = useState('');
  const [rows, setRows] = useState<StreamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const headers = useCallback((): Record<string, string> => token.trim() ? { 'x-admin-token': token.trim() } : {}, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/stream-health', { cache: 'no-store', headers: headers() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'دریافت وضعیت استریم‌ها ناموفق بود');
      setRows(Array.isArray(body.streams) ? body.streams : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطای نامشخص');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    try { setToken(localStorage.getItem(tokenStorageKey) || ''); } catch {}
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (row: StreamRow, status: StreamRow['status'], newUrl = '', reason = '') => {
    const key = `${row.channelId}:${row.url}`;
    setSaving(key);
    setError('');
    try {
      const response = await fetch('/api/admin/stream-health', {
        method: 'PATCH',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ channelId: row.channelId, url: row.url, status, newUrl: newUrl.trim() || null, reason: reason.trim() || null }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'ذخیره ناموفق بود');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطای نامشخص');
    } finally {
      setSaving(null);
    }
  };

  const saveToken = (value: string) => {
    setToken(value);
    try { localStorage.setItem(tokenStorageKey, value); } catch {}
  };

  return (
    <main dir="rtl" className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>MOMSAT · STREAM HEALTH</div>
            <h1 className={styles.title}>استریم‌های خراب و قرنطینه‌شده</h1>
            <p className={styles.description}>لینک‌هایی که کاربران در پخش واقعی با خطا دیده‌اند اینجا جمع می‌شوند تا از چرخه اصلی خارج یا با لینک سالم جایگزین شوند.</p>
          </div>
          <a href="/admin" className={styles.back}>بازگشت به مدیریت</a>
        </header>

        <section className={styles.toolbar}>
          <input className={styles.input} value={token} onChange={(e) => saveToken(e.target.value)} placeholder="ADMIN_TOKEN در صورت نیاز" type="password" />
          <button className={styles.button} onClick={() => void load()}>بازخوانی</button>
        </section>

        {error && <div className={styles.error}>{error}</div>}
        {loading && <div className={styles.loading}>در حال بارگذاری سلامت استریم‌ها…</div>}
        {!loading && !rows.length && <div className={styles.empty}>فعلاً استریم مشکوک یا خراب ثبت نشده است.</div>}

        {!loading && rows.length > 0 && (
          <div className={styles.list}>
            {rows.map((row) => {
              const key = `${row.channelId}:${row.url}`;
              const busy = saving === key;
              return (
                <article key={`${row.id}-${row.url}`} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div>
                      <div className={styles.nameRow}>
                        <strong className={styles.name}>{row.channel.name}</strong>
                        <span className={badgeClass(row.status)}>{label(row.status)}</span>
                      </div>
                      <div className={styles.meta}>{row.channel.nameEn} · channel #{row.channelId}</div>
                      <div className={styles.url}>{row.url}</div>
                    </div>
                    <div className={styles.counters}>
                      شکست متوالی: <strong>{row.failureStreak}</strong><br />
                      خطا: {row.failureCount} · موفق: {row.successCount}
                    </div>
                  </div>

                  <div className={styles.metrics}>
                    <div className={styles.metric}><span className={styles.metricLabel}>آخرین latency</span><strong className={styles.metricValue}>{row.lastLatencyMs == null ? '—' : `${row.lastLatencyMs} ms`}</strong></div>
                    <div className={styles.metric}><span className={styles.metricLabel}>میانگین latency</span><strong className={styles.metricValue}>{row.averageLatencyMs == null ? '—' : `${row.averageLatencyMs} ms`}</strong></div>
                    <div className={styles.metric}><span className={styles.metricLabel}>آخرین بررسی</span><strong className={styles.metricValue}>{row.lastCheckedAt ? new Date(row.lastCheckedAt).toLocaleString('fa-IR') : '—'}</strong></div>
                    <div className={styles.metric}><span className={styles.metricLabel}>آخرین خطا</span><strong className={styles.metricValue} title={row.lastError || undefined}>{row.lastError || '—'}</strong></div>
                  </div>

                  <div className={styles.actions}>
                    <input id={`url-${row.id}`} defaultValue="" placeholder="لینک سالم جایگزین (اختیاری)" dir="ltr" className={styles.urlInput} />
                    <button className={`${styles.action} ${styles.actionHealthy}`} disabled={busy} onClick={() => save(row, 'HEALTHY', (document.getElementById(`url-${row.id}`) as HTMLInputElement | null)?.value || '', 'تأیید دستی ادمین')}>فعال</button>
                    <button className={`${styles.action} ${styles.actionBroken}`} disabled={busy} onClick={() => save(row, 'BROKEN', '', 'تأیید خرابی توسط ادمین')}>خراب</button>
                    <button className={`${styles.action} ${styles.actionArchived}`} disabled={busy} onClick={() => save(row, 'ARCHIVED', '', 'خارج از چرخه اصلی')}>آرشیو</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
