'use client';

import { useCallback, useEffect, useState } from 'react';

type Item = { id: number; name: string; nameEn: string; archiveStatus: 'MEMORY' | 'SHUTDOWN' | null; archiveNote: string | null; archiveSince: string | null };

export default function HistoricalAdmin() {
  const [items, setItems] = useState<Item[]>([]);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState('');

  const headers = useCallback(() => token.trim() ? { 'x-admin-token': token.trim() } : {}, [token]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const response = await fetch('/api/admin/historical', { headers: headers(), cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'خطا در دریافت آرشیو'); setItems(data.channels || []); }
    catch (e) { setError(e instanceof Error ? e.message : 'خطا'); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  async function save(item: Item) {
    setSaving(item.id); setError('');
    try { const response = await fetch('/api/admin/historical', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify({ channelId: item.id, status: item.archiveStatus, note: item.archiveNote, since: item.archiveSince || null }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'ذخیره ناموفق بود'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'خطا'); }
    finally { setSaving(null); }
  }

  function update(id: number, patch: Partial<Item>) { setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)); }

  return <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24, fontFamily: 'Tahoma, Arial, sans-serif', direction: 'rtl' }}>
    <h1 style={{ marginBottom: 6 }}>مدیریت آرشیو شبکه‌ها</h1>
    <p style={{ color: '#718096', fontSize: 13 }}>شبکه را به «خاطره‌انگیز» یا «خاموش‌شده» علامت بزن. خالی کردن وضعیت، شبکه را از آرشیو حذف می‌کند.</p>
    <div style={{ display: 'flex', gap: 8, margin: '18px 0', flexWrap: 'wrap' }}><input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Admin token" type="password" style={{ flex: 1, minWidth: 220, padding: 10, borderRadius: 8, border: '1px solid #d7dce4' }} /><button onClick={() => void load()} style={{ padding: '10px 16px', borderRadius: 8, border: 0, cursor: 'pointer' }}>بارگذاری</button></div>
    {error ? <div style={{ padding: 12, marginBottom: 12, borderRadius: 8, background: '#fff0f0', color: '#9b2c2c' }}>{error}</div> : null}
    {loading ? <p>در حال بارگذاری…</p> : items.length === 0 ? <div style={{ padding: 18, border: '1px dashed #cbd5e0', borderRadius: 10 }}>هنوز هیچ شبکه‌ای در آرشیو ثبت نشده است.</div> : <div style={{ display: 'grid', gap: 10 }}>{items.map((item) => <div key={item.id} style={{ padding: 14, border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }}><div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}><div><strong>{item.name}</strong><div style={{ color: '#718096', fontSize: 11, marginTop: 4 }}>{item.nameEn} · ID {item.id}</div></div><select value={item.archiveStatus || ''} onChange={(e) => update(item.id, { archiveStatus: (e.target.value || null) as Item['archiveStatus'] })} style={{ padding: 8, borderRadius: 7, border: '1px solid #d7dce4' }}><option value="">بدون آرشیو</option><option value="MEMORY">خاطره‌انگیز</option><option value="SHUTDOWN">خاموش‌شده</option></select></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 180px auto', gap: 8, marginTop: 10 }}><input value={item.archiveNote || ''} onChange={(e) => update(item.id, { archiveNote: e.target.value })} placeholder="یادداشت تاریخی" style={{ padding: 9, borderRadius: 7, border: '1px solid #d7dce4' }} /><input value={item.archiveSince ? item.archiveSince.slice(0, 10) : ''} onChange={(e) => update(item.id, { archiveSince: e.target.value ? new Date(`${e.target.value}T00:00:00.000Z`).toISOString() : null })} type="date" style={{ padding: 9, borderRadius: 7, border: '1px solid #d7dce4' }} /><button disabled={saving === item.id} onClick={() => void save(item)} style={{ padding: '9px 14px', borderRadius: 7, border: 0, cursor: 'pointer' }}>{saving === item.id ? 'ذخیره…' : 'ذخیره'}</button></div></div>)}</div>}
  </main>;
}
