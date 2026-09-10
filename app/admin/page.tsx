'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type C = {
  id: number;
  catId: number;
  name: string;
  nameEn: string;
  vpn: boolean;
  iran: boolean;
  category: string;
  platform?: string | null;
  satellite?: string | null;
  frequency?: string | null;
  sources: { id: number | null }[];
};

type Upload = {
  id: string;
  file: File;
  status: 'sending' | 'done' | 'error';
  message?: string;
  result?: {
    detectedTable?: string;
    confidence?: number;
    format?: string;
    rows?: number;
    created?: number;
    updated?: number;
    skipped?: number;
    errors?: string[];
  };
};

const labels: Record<string, string> = { category: 'Category', channel: 'Channel', source: 'Source', program: 'Program' };

export default function Admin() {
  const [data, setData] = useState<C[]>([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [msg, setMsg] = useState('در حال دریافت کاتالوگ…');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [sending, setSending] = useState(false);
  const [token, setToken] = useState('');

  const load = () => fetch('/api/catalog').then(r => r.json()).then(j => { setData(j.channels || []); setMsg('آماده'); }).catch(() => setMsg('خطا در دریافت کاتالوگ'));

  useEffect(() => {
    setToken(window.localStorage.getItem('momsat-admin-token') || '');
    load();
  }, []);

  const cats = Array.from(new Map(data.map(c => [c.catId, c.category])));
  const filtered = useMemo(() => data.filter(c => (!q || `${c.name} ${c.nameEn}`.toLowerCase().includes(q.toLowerCase())) && (!cat || String(c.catId) === cat)), [data, q, cat]);
  const sources = data.reduce((n, c) => n + c.sources.length, 0);

  async function sendUpload(item: Upload) {
    setSending(true);
    setUploads(u => u.map(x => x.id === item.id ? { ...x, status: 'sending', message: undefined } : x));
    setMsg(`در حال تشخیص خودکار ${item.file.name} و ورود به دیتابیس…`);
    try {
      const form = new FormData();
      form.append('file', item.file);
      const r = await fetch('/api/admin/table-import', { method: 'POST', headers: token ? { 'x-admin-token': token } : undefined, body: form });
      const j = await r.json();
      const ok = r.ok || r.status === 207;
      setUploads(u => u.map(x => x.id === item.id ? {
        ...x,
        status: ok ? 'done' : 'error',
        message: j.error || `${labels[j.detectedTable] || j.detectedTable || 'Data'} | ${j.rows || 0} rows | +${j.created || 0} new | ${j.updated || 0} updated | ${j.skipped || 0} skipped`,
        result: j,
      } : x));
      setMsg(j.error || (ok ? `شناسايی ${labels[j.detectedTable] || j.detectedTable} انجام شد و دیتا وارد دیتابیس شد` : 'خطا در import'));
      if (ok) await load();
    } catch {
      setUploads(u => u.map(x => x.id === item.id ? { ...x, status: 'error', message: 'خطای شبکه' } : x));
      setMsg('خطای شبکه در ارسال فایل');
    } finally {
      setSending(false);
    }
  }

  function addFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || sending) return;
    const item: Upload = { id: `${Date.now()}-${file.name}`, file, status: 'sending' };
    setUploads(u => [item, ...u]);
    void sendUpload(item);
  }

  function removeUpload(id: string) { setUploads(u => u.filter(x => x.id !== id)); }

  async function sync() {
    setMsg('در حال واکشی و sync کاتالوگ…');
    try { const r = await fetch('/api/admin/sync', { method: 'POST', headers: token ? { 'x-admin-token': token } : undefined }); const j = await r.json(); setMsg(j.message || j.error || 'تمام شد'); await load(); }
    catch { setMsg('خطای شبکه'); }
  }

  async function syncEpg() {
    setMsg('در حال sync راهنمای برنامه‌ها…');
    try { const r = await fetch('/api/admin/epg', { method: 'POST', headers: token ? { 'x-admin-token': token } : undefined }); const j = await r.json(); setMsg(j.status === 'unconfigured' ? 'EPG تنظیم نشده است' : j.error || `EPG: ${j.programs || 0} برنامه، ${j.matchedChannels || 0} شبکه match شد`); }
    catch { setMsg('خطای شبکه در EPG'); }
  }

  function saveToken(value: string) { setToken(value); window.localStorage.setItem('momsat-admin-token', value); }

  return <main>
    <header className="top"><div><div className="brand">MOM<span>SAT</span></div><div className="muted">Control Center</div></div><nav><Link href="/">نمایش</Link><Link href="/browse">کاتالوگ</Link><Link href="/guide">EPG / راهنما</Link></nav></header>

    <div className="eyebrow">ADMIN / UNIVERSAL INGESTION</div>
    <h1>مدیریت کاتالوگ و دیتابیس</h1>
    <div className="notice">یک uploader برای همه دیتاها. فایل را انتخاب کن؛ سیستم schema را خودش تشخیص می‌دهد و مستقیم در جدول مناسب وارد یا بروزرسانی می‌کند.</div>

    <div className="admin-kpis">
      <div className="kpi"><span className="muted">Channels</span><strong>{data.length}</strong></div>
      <div className="kpi"><span className="muted">Sources</span><strong>{sources}</strong></div>
      <div className="kpi"><span className="muted">Categories</span><strong>{cats.length}</strong></div>
      <div className="kpi"><span className="muted">Uploads</span><strong>{uploads.length}</strong></div>
    </div>

    <section style={{ marginTop: 22 }}>
      <div className="eyebrow">UNIVERSAL DATA UPLOAD</div>
      <h2 style={{ margin: '6px 0 4px' }}>آپلود خودکار</h2>
      <p className="muted" style={{ marginTop: 0 }}>CSV و JSON ساختاریافته. بدون انتخاب Category / Channel / Source / Program.</p>
      <div className="notice" style={{ marginTop: 14, padding: 24, textAlign: 'center', borderStyle: 'dashed' }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>فایل داده را انتخاب کن</div>
        <div className="muted" style={{ marginTop: 7 }}>بعد از انتخاب، پردازش بدون مرحله اضافی شروع می‌شود.</div>
        <label className="btn primary" style={{ display: 'inline-block', marginTop: 18, cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.65 : 1 }}>
          انتخاب فایل
          <input hidden disabled={sending} type="file" accept=".csv,.json,text/csv,application/json" onChange={addFile} />
        </label>
      </div>
    </section>

    <section style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="eyebrow">ADMIN TOKEN</span>
        <input className="status" style={{ minWidth: 280 }} type="password" value={token} onChange={e => saveToken(e.target.value)} placeholder="ADMIN_TOKEN" />
      </div>
    </section>

    <section style={{ marginTop: 24 }}>
      <div className="eyebrow">IMPORT HISTORY</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><h2 style={{ margin: '6px 0' }}>نتیجه پردازش</h2><span className="status">{msg}</span></div>
      {uploads.length === 0 ? <div className="notice" style={{ marginTop: 12, textAlign: 'center', padding: 30 }}><strong>هنوز فایلی پردازش نشده است</strong></div> : <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {uploads.map(u => <div key={u.id} className="notice" style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) auto', gap: 14, alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong>{u.file.name}</strong><span className="muted">{(u.file.size / 1024).toFixed(1)} KB</span>{u.result?.detectedTable && <span className="status">{labels[u.result.detectedTable] || u.result.detectedTable} · {Math.round((u.result.confidence || 0) * 100)}%</span>}</div>
            {u.message && <div className="muted" style={{ marginTop: 7 }}>{u.message}</div>}
            {u.result?.errors?.length ? <div style={{ marginTop: 5 }}>خطا: {u.result.errors[0]}</div> : null}
          </div>
          <button className="btn" disabled={u.status === 'sending'} onClick={() => removeUpload(u.id)}>حذف</button>
        </div>)}
      </div>}
    </section>

    <div className="admin-tools" style={{ marginTop: 24 }}><input className="status" style={{ minWidth: 250 }} value={q} onChange={e => setQ(e.target.value)} placeholder="جستجو…" /><select className="status" value={cat} onChange={e => setCat(e.target.value)}><option value="">همه دسته‌ها</option>{cats.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><button className="btn primary" onClick={sync}>Fetch + Sync</button><button className="btn" onClick={syncEpg}>Sync EPG</button><span className="status">{msg}</span></div>

    <div style={{ overflowX: 'auto', marginTop: 16 }}><table className="admin-table"><thead><tr><th>ID</th><th>نام</th><th>دسته</th><th>Platform</th><th>Satellite</th><th>Sources</th><th></th></tr></thead><tbody>{filtered.map(c => <tr key={c.id}><td>{c.id}</td><td>{c.name}<div className="muted">{c.nameEn}</div></td><td>{c.category}</td><td>{c.platform || '—'}</td><td>{c.satellite || '—'}</td><td>{c.sources.length}</td><td><Link href={`/channel/${c.id}`} className="more">View</Link></td></tr>)}</tbody></table></div>
  </main>;
}
