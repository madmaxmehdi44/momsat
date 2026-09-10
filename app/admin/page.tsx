'use client';
import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type C={id:number;catId:number;name:string;nameEn:string;vpn:boolean;iran:boolean;category:string;sources:{id:number|null}[]};
type TableKey='category'|'channel'|'source'|'program';
type Upload={id:string;table:TableKey;file:File;status:'ready'|'sending'|'done'|'error';message?:string;result?:{rows?:number;created?:number;updated?:number;skipped?:number;errors?:string[]}};
const labels:Record<TableKey,string>={category:'Category',channel:'Channel',source:'Source',program:'Program'};
const descriptions:Record<TableKey,string>={
 category:'دسته‌بندی‌ها؛ id، name و nameEn',
 channel:'شبکه‌ها؛ نام، دسته، آدرس پخش و metadata',
 source:'منابع پخش؛ هر URL به یک Channel متصل می‌شود',
 program:'برنامه‌ها؛ title، start، end و ارتباط با Channel/EPG',
};

export default function Admin(){
 const[data,setData]=useState<C[]>([]),[q,setQ]=useState(''),[cat,setCat]=useState(''),[msg,setMsg]=useState('در حال دریافت کاتالوگ…'),[uploads,setUploads]=useState<Upload[]>([]),[sending,setSending]=useState(false);
 const load=()=>fetch('/api/catalog').then(r=>r.json()).then(j=>{setData(j.channels||[]);setMsg('آماده')}).catch(()=>setMsg('خطا در دریافت کاتالوگ'));
 useEffect(()=>{load()},[]);
 const cats=Array.from(new Map(data.map(c=>[c.catId,c.category])));
 const filtered=useMemo(()=>data.filter(c=>(!q||`${c.name} ${c.nameEn}`.toLowerCase().includes(q.toLowerCase()))&&(!cat||String(c.catId)===cat)),[data,q,cat]);
 const sources=data.reduce((n,c)=>n+c.sources.length,0);
 function addFile(table:TableKey,e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];e.target.value='';if(!file)return;setUploads(u=>[{id:`${table}-${Date.now()}`,table,file,status:'ready'},...u]);}
 function removeUpload(id:string){setUploads(u=>u.filter(x=>x.id!==id));}
 async function sendUpload(item:Upload){
   setSending(true);setUploads(u=>u.map(x=>x.id===item.id?{...x,status:'sending'}:x));setMsg(`در حال ارسال ${labels[item.table]} به دیتابیس…`);
   try{
     const form=new FormData();form.append('table',item.table);form.append('file',item.file);
     const r=await fetch('/api/admin/table-import',{method:'POST',headers:{'x-admin-token':prompt('ADMIN_TOKEN')||''},body:form});
     const j=await r.json();
     setUploads(u=>u.map(x=>x.id===item.id?{...x,status:r.ok||r.status===207?'done':'error',message:j.error||`تعداد ردیف: ${j.rows||0} | جدید: ${j.created||0} | بروزرسانی: ${j.updated||0} | تکراری: ${j.skipped||0}`,result:j}:x));
     setMsg(j.error||`${labels[item.table]} با موفقیت پردازش شد`);if(r.ok||r.status===207)await load();
   }catch{setUploads(u=>u.map(x=>x.id===item.id?{...x,status:'error',message:'خطای شبکه'}:x));setMsg('خطای شبکه در ارسال CSV')}finally{setSending(false)}
 }
 async function sync(){setMsg('در حال واکشی و sync کاتالوگ…');try{const r=await fetch('/api/admin/sync',{method:'POST',headers:{'x-admin-token':prompt('ADMIN_TOKEN')||''}});const j=await r.json();setMsg(j.message||j.error||'تمام شد');load()}catch{setMsg('خطای شبکه')}}
 async function syncEpg(){setMsg('در حال sync راهنمای برنامه‌ها…');try{const r=await fetch('/api/admin/epg',{method:'POST',headers:{'x-admin-token':prompt('ADMIN_TOKEN')||''}});const j=await r.json();setMsg(j.status==='unconfigured'?'EPG تنظیم نشده است':j.error||`EPG: ${j.programs||0} برنامه، ${j.matchedChannels||0} شبکه match شد`)}catch{setMsg('خطای شبکه در EPG')}}
 return <main>
  <header className="top"><div><div className="brand">MOM<span>SAT</span></div><div className="muted">Control Center</div></div><nav><Link href="/">نمایش</Link><Link href="/browse">کاتالوگ</Link><Link href="/guide">EPG / راهنما</Link></nav></header>
  <div className="eyebrow">ADMIN / INGESTION / DATABASE</div><h1>مدیریت کاتالوگ و دیتابیس</h1>
  <div className="notice">فایل‌ها ابتدا فقط در صف Upload قرار می‌گیرند. هیچ فایلی خودکار وارد دیتابیس نمی‌شود. برای هر فایل باید دکمه «ارسال به دیتابیس» را بزنید.</div>
  <div className="admin-kpis"><div className="kpi"><span className="muted">Channels</span><strong>{data.length}</strong></div><div className="kpi"><span className="muted">Sources</span><strong>{sources}</strong></div><div className="kpi"><span className="muted">Categories</span><strong>{cats.length}</strong></div><div className="kpi"><span className="muted">Uploads</span><strong>{uploads.length}</strong></div></div>

  <section style={{marginTop:22}}><div className="eyebrow">CSV INGESTION</div><h2 style={{margin:'6px 0 4px'}}>آپلود جداول</h2><p className="muted" style={{marginTop:0}}>برای هر جدول فایل جداگانه انتخاب کنید. پس از بررسی، همان فایل را مستقل به دیتابیس ارسال کنید.</p>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(250px,1fr))',gap:14,marginTop:16}}>{(['category','channel','source','program'] as TableKey[]).map(table=><div key={table} className="notice" style={{minHeight:145,display:'flex',flexDirection:'column',justifyContent:'space-between'}}><div><div style={{fontSize:16,fontWeight:700}}>{labels[table]}</div><div className="muted" style={{fontSize:13,marginTop:7}}>{descriptions[table]}</div></div><label className="btn primary" style={{textAlign:'center',marginTop:16}}>انتخاب CSV<input hidden type="file" accept=".csv,text/csv" onChange={e=>addFile(table,e)}/></label></div>)}</div>
  </section>

  <section style={{marginTop:24}}><div className="eyebrow">UPLOAD QUEUE</div><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}><h2 style={{margin:'6px 0'}}>فایل‌های آماده ارسال</h2><span className="status">{msg}</span></div>
   {uploads.length===0?<div className="notice" style={{marginTop:12,textAlign:'center',padding:30}}><strong>هنوز فایلی انتخاب نشده است</strong><div className="muted" style={{marginTop:6}}>هر چهار جدول می‌توانند مستقل و هم‌زمان در صف قرار بگیرند.</div></div>:<div style={{display:'grid',gap:10,marginTop:12}}>{uploads.map(u=><div key={u.id} className="notice" style={{display:'grid',gridTemplateColumns:'minmax(180px,1fr) auto',gap:14,alignItems:'center'}}><div><div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><strong>{labels[u.table]}</strong><span className="status">{u.file.name}</span><span className="muted">{(u.file.size/1024).toFixed(1)} KB</span></div>{u.message&&<div className="muted" style={{marginTop:7}}>{u.message}</div>}{u.result?.errors?.length?<div style={{marginTop:5}}>خطا: {u.result.errors[0]}</div>:null}</div><div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'flex-end'}}>{u.status==='ready'&&<button className="btn primary" disabled={sending} onClick={()=>sendUpload(u)}>ارسال به دیتابیس</button>}{u.status==='sending'&&<button className="btn" disabled>در حال ارسال…</button>}{(u.status==='done'||u.status==='error')&&<button className="btn" disabled={sending}>ارسال مجدد</button>}<button className="btn" disabled={u.status==='sending'} onClick={()=>removeUpload(u.id)}>حذف</button></div></div>)}</div>}
  </section>

  <div className="admin-tools" style={{marginTop:24}}><input className="status" style={{minWidth:250}} value={q} onChange={e=>setQ(e.target.value)} placeholder="جستجو…"/><select className="status" value={cat} onChange={e=>setCat(e.target.value)}><option value="">همه دسته‌ها</option>{cats.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select><button className="btn primary" onClick={sync}>Fetch + Sync</button><button className="btn" onClick={syncEpg}>Sync EPG</button><span className="status">{msg}</span></div>
  <div style={{overflowX:'auto',marginTop:16}}><table className="admin-table"><thead><tr><th>ID</th><th>نام</th><th>دسته</th><th>VPN</th><th>Iran</th><th>Sources</th><th></th></tr></thead><tbody>{filtered.map(c=><tr key={c.id}><td>{c.id}</td><td>{c.name}<div className="muted">{c.nameEn}</div></td><td>{c.category}</td><td>{c.vpn?'YES':'NO'}</td><td>{c.iran?'YES':'NO'}</td><td>{c.sources.length}</td><td><Link href={`/channel/${c.id}`} className="more">View</Link></td></tr>)}</tbody></table></div>
 </main>
}
