'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './historical.module.css';

type Item = { id: number; name: string; nameEn: string; archiveStatus: 'MEMORY' | 'SHUTDOWN' | null; archiveNote: string | null; archiveSince: string | null };
type RequestHeaders = Record<string, string>;

export default function HistoricalAdmin() {
  const [items, setItems] = useState<Item[]>([]);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState('');

  const headers = useCallback((): RequestHeaders => token.trim() ? { 'x-admin-token': token.trim() } : {}, [token]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/admin/historical', { headers: headers(), cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'خطا در دریافت آرشیو');
      setItems(data.channels || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  async function save(item: Item) {
    setSaving(item.id); setError('');
    try {
      const response = await fetch('/api/admin/historical', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ channelId: item.id, status: item.archiveStatus, note: item.archiveNote, since: item.archiveSince || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'ذخیره ناموفق بود');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا');
    } finally {
      setSaving(null);
    }
  }

  function update(id: number, patch: Partial<Item>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  return (
    <main dir="rtl" className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>MOMSAT · HISTORICAL ARCHIVE</div>
            <h1 className={styles.title}>مدیریت آرشیو شبکه‌ها</h1>
            <p className={styles.description}>شبکه را به «خاطره‌انگیز» یا «خاموش‌شده» علامت بزن. خالی کردن وضعیت، شبکه را از آرشیو حذف می‌کند.</p>
          </div>
        </header>

        <div className={styles.toolbar}>
          <input className={styles.input} value={token} onChange={(e) => setToken(e.target.value)} placeholder="Admin token" type="password" />
          <button className={styles.button} onClick={() => void load()}>بارگذاری</button>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}
        {loading ? <div className={styles.state}>در حال بارگذاری…</div> : items.length === 0 ? <div className={styles.state}>هنوز هیچ شبکه‌ای در آرشیو ثبت نشده است.</div> : (
          <div className={styles.list}>
            {items.map((item) => (
              <article key={item.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <div>
                    <strong className={styles.name}>{item.name}</strong>
                    <div className={styles.meta}>{item.nameEn} · ID {item.id}</div>
                  </div>
                  <select className={styles.select} value={item.archiveStatus || ''} onChange={(e) => update(item.id, { archiveStatus: (e.target.value || null) as Item['archiveStatus'] })}>
                    <option value="">بدون آرشیو</option>
                    <option value="MEMORY">خاطره‌انگیز</option>
                    <option value="SHUTDOWN">خاموش‌شده</option>
                  </select>
                </div>
                <div className={styles.fields}>
                  <input className={styles.field} value={item.archiveNote || ''} onChange={(e) => update(item.id, { archiveNote: e.target.value })} placeholder="یادداشت تاریخی" />
                  <input className={styles.field} value={item.archiveSince ? item.archiveSince.slice(0, 10) : ''} onChange={(e) => update(item.id, { archiveSince: e.target.value ? new Date(`${e.target.value}T00:00:00.000Z`).toISOString() : null })} type="date" />
                  <button className={styles.save} disabled={saving === item.id} onClick={() => void save(item)}>{saving === item.id ? 'ذخیره…' : 'ذخیره'}</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
