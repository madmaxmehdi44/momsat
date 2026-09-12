'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ControlCenterNav from '../ControlCenterNav';

type Source = { id: number | null; title: string | null; url: string; referer: string | null; origin: string | null; country: string | null; vip: boolean };
type Channel = {
  id: number; catId: number; name: string; nameEn: string; image: string | null; url: string; referer: string | null; origin: string | null;
  vpn: boolean; iran: boolean; popular: number | string; vip: boolean; language: string | null; country: string | null;
  platform: string | null; satellite: string | null; frequency: string | null; polarization: string | null; symbolRate: string | null;
  serviceId: string | null; category: string; categoryEn: string; sources: Source[];
};
type DataResponse = { database: { channels: Channel[]; categories: Array<{ id: number; name: string; nameEn: string }> }; csv: { channels: Channel[] }; counts: Record<string, number> };
type ChannelForm = Partial<Channel> & { id: number; catId: number; name: string; nameEn: string; url: string; category: string; categoryEn: string };

const emptyForm: ChannelForm = { id: 0, catId: 0, name: '', nameEn: '', url: '', category: '', categoryEn: '', image: '', referer: '', origin: '', vpn: false, iran: false, popular: 0, vip: false, language: '', country: '', platform: '', satellite: '', frequency: '', polarization: '', symbolRate: '', serviceId: '', sources: [] };

function authHeaders(token: string) { return { 'content-type': 'application/json', 'x-admin-token': token }; }
function cleanChannel(channel: Channel): Channel { return { ...channel, popular: Number(channel.popular || 0), sources: (channel.sources || []).map((s) => ({ ...s })) }; }
function csvEscape(value: unknown) { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function exportCsv(channels: Channel[]) {
  const header = ['channel_id','category_id','channel_name','channel_name_en','channel_image','channel_url','channel_referer','channel_agent','channel_origin','need_vpn','for_iran','popular','isvip','category_name','category_name_en','channel_headers','sourses'];
  const body = channels.map((c) => [c.id,c.catId,c.name,c.nameEn,c.image,c.url,c.referer,'',c.origin,c.vpn?1:0,c.iran?1:0,c.popular,c.vip?1:0,c.category,c.categoryEn,'',JSON.stringify(c.sources.map((s) => ({ ID: s.id, title: s.title, channel_url: s.url, channel_referer: s.referer, channel_origin: s.origin, country: s.country, isvip: s.vip?1:0, channel_headers: null })) )].map(csvEscape).join(',')).join('\n');
  const blob = new Blob([`${header.join(',')}\n${body}\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'momsat-seed-data-edited.csv'; a.click(); URL.revokeObjectURL(url);
}

export default function DatabaseManagerPage() {
  const [token, setToken] = useState('');
  const [data, setData] = useState<DataResponse | null>(null);
  const [tab, setTab] = useState<'db'|'csv'|'diff'>('diff');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [form, setForm] = useState<ChannelForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const response = await fetch('/api/admin/table-manager', { headers: { 'x-admin-token': token }, cache: 'no-store' });
      const json = await response.json(); if (!response.ok) throw new Error(json.error || 'خطا در دریافت اطلاعات');
      setData(json); setMessage('داده‌ها به‌روز شد');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'خطا'); }
  };
  useEffect(() => { const saved = window.localStorage.getItem('momsat-admin-token') || ''; setToken(saved); }, []);
  useEffect(() => { if (token) void load(); }, [token]);

  const dbChannels = data?.database.channels || [];
  const csvChannels = data?.csv.channels || [];
  const dbMap = useMemo(() => new Map(dbChannels.map((c) => [c.id, c])), [dbChannels]);
  const csvMap = useMemo(() => new Map(csvChannels.map((c) => [c.id, c])), [csvChannels]);
  const differences = useMemo(() => csvChannels.filter((c) => { const db = dbMap.get(c.id); return !db || db.name !== c.name || db.nameEn !== c.nameEn || db.url !== c.url || db.catId !== c.catId || db.sources.length !== c.sources.length; }), [csvChannels, dbMap]);
  const visible = useMemo(() => { const source = tab === 'db' ? dbChannels : tab === 'csv' ? csvChannels : differences; const q = query.trim().toLowerCase(); return q ? source.filter((c) => `${c.id} ${c.name} ${c.nameEn} ${c.category}`.toLowerCase().includes(q)) : source; }, [tab, dbChannels, csvChannels, differences, query]);

  function choose(channel: Channel) { setSelected(channel.id); setForm({ ...cleanChannel(channel), id: channel.id, catId: channel.catId }); }
  function newChannel() { setSelected(null); setForm({ ...emptyForm, id: 0 }); }

  async function action(body: Record<string, unknown>) {
    setBusy(true); setMessage('در حال اجرا…');
    try { const response = await fetch('/api/admin/table-manager', { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) }); const json = await response.json(); if (!response.ok || json.ok === false) throw new Error(json.error || 'عملیات ناموفق بود'); setMessage('عملیات با موفقیت انجام شد'); await load(); return json; }
    catch (error) { setMessage(error instanceof Error ? error.message : 'خطا'); return null; }
    finally { setBusy(false); }
  }

  async function save() { const result = await action({ action: 'save-channel', channel: form }); if (result?.channel) choose(cleanChannel(result.channel)); }
  async function remove() { if (!selected || !window.confirm('این شبکه از دیتابیس حذف شود؟ منابع آن هم حذف می‌شوند.')) return; await action({ action: 'delete-channel', channel: { id: selected } }); setSelected(null); setForm({ ...emptyForm }); }
  async function syncCsvToDb() { if (!window.confirm(`تمام ${csvChannels.length.toLocaleString()} رکورد CSV روی DB upsert می‌شود. ادامه؟`)) return; await action({ action: 'sync-csv-to-db' }); }
  async function syncEditedCsvToDb() { if (!window.confirm('نسخه ویرایش‌شده CSV فعلی در مرورگر روی DB اعمال شود؟')) return; await action({ action: 'sync-edited-csv-to-db', channels: csvChannels }); }

  const field = (key: keyof ChannelForm, label: string, type: 'text'|'number' = 'text') => <label style={{ display: 'grid', gap: 5 }}><span style={{ fontSize: 11, opacity: .65 }}>{label}</span><input type={type} value={String(form[key] ?? '')} onChange={(e) => setForm((v) => ({ ...v, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))} /></label>;

  return <main style={{ minHeight: '100vh', padding: 20 }}><div style={{ maxWidth: 1600, margin: '0 auto' }}><ControlCenterNav /><header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', margin: '20px 0' }}><div><h1 style={{ margin: 0 }}>مدیریت جداول DB و seed-data</h1><p style={{ margin: '6px 0', opacity: .7 }}>دو منبع را کنار هم ببین، اختلاف‌ها را پیدا کن و رکوردها را ویرایش یا همگام کن.</p></div><Link href="/admin" style={{ color: 'var(--accent)' }}>بازگشت به Admin</Link></header>
    <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 420px', gap: 16, alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><button onClick={() => setTab('diff')} aria-pressed={tab==='diff'}>اختلاف‌ها · {differences.length}</button><button onClick={() => setTab('db')} aria-pressed={tab==='db'}>DB · {dbChannels.length}</button><button onClick={() => setTab('csv')} aria-pressed={tab==='csv'}>CSV · {csvChannels.length}</button><button onClick={newChannel}>＋ شبکه جدید</button><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جستجو…" style={{ marginInlineStart: 'auto', minWidth: 220 }} /></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button disabled={busy} onClick={syncCsvToDb}>Sync CSV → DB</button><button disabled={busy} onClick={syncEditedCsvToDb}>Sync ویرایش‌های CSV → DB</button><button onClick={() => exportCsv(csvChannels)}>خروجی CSV فعلی</button><button onClick={() => void load()}>↻ Refresh</button><span style={{ marginInlineStart: 'auto', fontSize: 12, opacity: .65 }}>{message}</span></div>
        <div style={{ overflow: 'auto', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--panel)' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}><thead><tr><th>ID</th><th>نام</th><th>English</th><th>دسته</th><th>URL</th><th>Sources</th><th>وضعیت</th></tr></thead><tbody>{visible.map((c) => { const db = dbMap.get(c.id); const mismatch = !db || db.name !== c.name || db.url !== c.url || db.sources.length !== c.sources.length; return <tr key={c.id} onClick={() => choose(c)} style={{ cursor: 'pointer', borderTop: '1px solid var(--line)', background: selected === c.id ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : undefined }}><td>{c.id}</td><td>{c.name}</td><td>{c.nameEn}</td><td>{c.category}</td><td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.url}</td><td>{c.sources.length}</td><td>{tab === 'diff' ? (mismatch ? 'تفاوت' : 'یکسان') : '—'}</td></tr>; })}</tbody></table>{visible.length === 0 && <div style={{ padding: 30, textAlign: 'center', opacity: .6 }}>رکوردی پیدا نشد.</div>}</div>
      </div>
      <aside style={{ border: '1px solid var(--line)', borderRadius: 14, background: 'var(--panel)', padding: 16, position: 'sticky', top: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>{selected ? `ویرایش شبکه #${selected}` : 'شبکه جدید'}</strong>{selected && <button onClick={remove} disabled={busy}>حذف</button>}</div>
        <div style={{ display: 'grid', gap: 9, marginTop: 12 }}>{field('name','نام فارسی')}{field('nameEn','نام انگلیسی')}{field('url','Stream URL')}{field('image','تصویر')}{field('category','دسته')}{field('categoryEn','دسته انگلیسی')}{field('catId','Category ID','number')}{field('popular','Popular','number')}<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><label><input type="checkbox" checked={Boolean(form.vpn)} onChange={(e) => setForm((v) => ({ ...v, vpn: e.target.checked }))} /> VPN</label><label><input type="checkbox" checked={Boolean(form.iran)} onChange={(e) => setForm((v) => ({ ...v, iran: e.target.checked }))} /> ایران</label><label><input type="checkbox" checked={Boolean(form.vip)} onChange={(e) => setForm((v) => ({ ...v, vip: e.target.checked }))} /> VIP</label></div>{field('referer','Referer')}{field('origin','Origin')}{field('country','Country')}{field('platform','Platform')}{field('satellite','Satellite')}{field('frequency','Frequency')}<button onClick={save} disabled={busy} style={{ marginTop: 5 }}>ذخیره تغییرات</button></div>
        {selected && <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 14 }}><strong>Sources</strong>{(form.sources || []).map((s, index) => <div key={`${s.id}-${index}`} style={{ marginTop: 8, padding: 10, border: '1px solid var(--line)', borderRadius: 10 }}><div style={{ fontSize: 11, opacity: .6 }}>#{s.id ?? 'new'}</div><input value={s.title || ''} onChange={(e) => setForm((v) => ({ ...v, sources: (v.sources || []).map((x, i) => i === index ? { ...x, title: e.target.value } : x) }))} placeholder="عنوان source" /><input value={s.url} onChange={(e) => setForm((v) => ({ ...v, sources: (v.sources || []).map((x, i) => i === index ? { ...x, url: e.target.value } : x) }))} placeholder="URL" style={{ marginTop: 5 }} /><button style={{ marginTop: 5 }} onClick={() => setForm((v) => ({ ...v, sources: (v.sources || []).filter((_, i) => i !== index) }))}>حذف source</button></div>)}<button style={{ marginTop: 8 }} onClick={() => setForm((v) => ({ ...v, sources: [...(v.sources || []), { id: null, title: '', url: '', referer: null, origin: null, country: null, vip: false }] }))}>＋ Source</button></div>}
        <div style={{ marginTop: 16, fontSize: 11, opacity: .6, lineHeight: 1.8 }}>Sync CSV → DB از فایل verified داخل repo می‌خواند. ویرایش‌های جدول CSV در این صفحه فعلاً در حافظه مرورگر هستند و با «Sync ویرایش‌های CSV → DB» روی دیتابیس اعمال می‌شوند؛ برای ذخیره فایل نهایی از «خروجی CSV فعلی» استفاده کن.</div>
      </aside>
    </section>
  </div></main>;
}
