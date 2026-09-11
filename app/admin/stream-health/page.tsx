'use client';

import { useCallback, useEffect, useState } from 'react';

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
    <main dir="rtl" style={{ minHeight: '100vh', padding: 24, background: '#090b10', color: '#f4f7fb', fontFamily: 'Tahoma, Arial, sans-serif' }}>
      <div style={{ maxWidth: 1500, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 20, marginBottom: 22 }}>
          <div>
            <div style={{ color: '#37d0ff', fontSize: 10, letterSpacing: 1.5, fontWeight: 900 }}>MOMSAT · STREAM HEALTH</div>
            <h1 style={{ margin: '7px 0', fontSize: 34 }}>استریم‌های خراب و قرنطینه‌شده</h1>
            <p style={{ margin: 0, color: '#8f9bac', lineHeight: 1.8 }}>لینک‌هایی که کاربران در پخش واقعی با خطا دیده‌اند اینجا جمع می‌شوند تا از چرخه اصلی خارج یا با لینک سالم جایگزین شوند.</p>
          </div>
          <a href="/admin" style={{ color: '#37d0ff', fontSize: 12 }}>بازگشت به مدیریت</a>
        </header>

        <section style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <input value={token} onChange={(e) => saveToken(e.target.value)} placeholder="ADMIN_TOKEN در صورت نیاز" type="password" style={{ minWidth: 280, flex: 1, padding: '11px 12px', borderRadius: 10, border: '1px solid #263241', background: '#0e141d', color: '#fff' }} />
          <button onClick={() => void load()} style={{ padding: '0 16px', minHeight: 42, borderRadius: 10, border: '1px solid #2c4657', background: '#10202b', color: '#37d0ff', cursor: 'pointer' }}>بازخوانی</button>
        </section>

        {error && <div style={{ marginBottom: 14, padding: 12, border: '1px solid #57313a', borderRadius: 10, background: '#1a1114', color: '#ff9daf' }}>{error}</div>}
        {loading && <div style={{ padding: 30, color: '#8f9bac' }}>در حال بارگذاری سلامت استریم‌ها…</div>}

        {!loading && !rows.length && <div style={{ padding: 30, border: '1px solid #202c38', borderRadius: 14, background: '#0d131a', color: '#8f9bac' }}>فعلاً استریم مشکوک یا خراب ثبت نشده است.</div>}

        {!loading && rows.length > 0 && (
          <div style={{ display: 'grid', gap: 12 }}>
            {rows.map((row) => {
              const key = `${row.channelId}:${row.url}`;
              const busy = saving === key;
              return <article key={`${row.id}-${row.url}`} style={{ border: '1px solid #202c38', borderRadius: 14, background: '#0d131a', padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong>{row.channel.name}</strong>
                      <span style={{ padding: '4px 7px', borderRadius: 6, background: row.status === 'BROKEN' ? '#3b1820' : '#2c2618', color: row.status === 'BROKEN' ? '#ff8ea4' : '#f0c56a', fontSize: 9, fontWeight: 900 }}>{label(row.status)}</span>
                    </div>
                    <div style={{ marginTop: 5, color: '#718094', fontSize: 10 }}>{row.channel.nameEn} · channel #{row.channelId}</div>
                    <div style={{ marginTop: 9, direction: 'ltr', overflowWrap: 'anywhere', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, color: '#bac5d4' }}>{row.url}</div>
                  </div>
                  <div style={{ textAlign: 'left', whiteSpace: 'nowrap', color: '#8f9bac', fontSize: 10 }}>
                    شکست متوالی: <strong style={{ color: '#fff' }}>{row.failureStreak}</strong><br />
                    خطا: {row.failureCount} · موفق: {row.successCount}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, marginTop: 12 }}>
                  <div style={{ padding: 9, background: '#111821', borderRadius: 9 }}><small>آخرین latency</small><strong style={{ display: 'block', marginTop: 4 }}>{row.lastLatencyMs == null ? '—' : `${row.lastLatencyMs} ms`}</strong></div>
                  <div style={{ padding: 9, background: '#111821', borderRadius: 9 }}><small>میانگین latency</small><strong style={{ display: 'block', marginTop: 4 }}>{row.averageLatencyMs == null ? '—' : `${row.averageLatencyMs} ms`}</strong></div>
                  <div style={{ padding: 9, background: '#111821', borderRadius: 9 }}><small>آخرین بررسی</small><strong style={{ display: 'block', marginTop: 4 }}>{row.lastCheckedAt ? new Date(row.lastCheckedAt).toLocaleString('fa-IR') : '—'}</strong></div>
                  <div style={{ padding: 9, background: '#111821', borderRadius: 9 }}><small>آخرین خطا</small><strong style={{ display: 'block', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.lastError || '—'}</strong></div>
                </div>

                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto auto', gap: 7 }}>
                  <input id={`url-${row.id}`} defaultValue="" placeholder="لینک سالم جایگزین (اختیاری)" dir="ltr" style={{ minWidth: 0, padding: '9px 10px', borderRadius: 8, border: '1px solid #293747', background: '#0b1017', color: '#fff', fontFamily: 'ui-monospace, monospace', fontSize: 10 }} />
                  <button disabled={busy} onClick={() => save(row, 'HEALTHY', (document.getElementById(`url-${row.id}`) as HTMLInputElement | null)?.value || '', 'تأیید دستی ادمین')} style={{ padding: '0 11px', borderRadius: 8, border: '1px solid #2a5846', background: '#102119', color: '#65e2a3', cursor: 'pointer' }}>فعال</button>
                  <button disabled={busy} onClick={() => save(row, 'BROKEN', '', 'تأیید خرابی توسط ادمین')} style={{ padding: '0 11px', borderRadius: 8, border: '1px solid #57313a', background: '#211216', color: '#ff93a6', cursor: 'pointer' }}>خراب</button>
                  <button disabled={busy} onClick={() => save(row, 'ARCHIVED', '', 'خارج از چرخه اصلی')} style={{ padding: '0 11px', borderRadius: 8, border: '1px solid #39414e', background: '#151a22', color: '#b8c2cf', cursor: 'pointer' }}>آرشیو</button>
                </div>
              </article>;
            })}
          </div>
        )}
      </div>
    </main>
  );
}
