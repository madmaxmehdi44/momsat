'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import styles from './stream-validator.module.css';

type Probe = {
  channelId: number; channelName: string; url: string; protocol: 'HLS' | 'DASH' | 'DIRECT' | 'UNKNOWN';
  reachable: boolean; live: boolean | null; buffering: boolean; manifestLoaded: boolean; mediaLoaded: boolean;
  changedDuringProbe: boolean | null; latencyMs: number | null; mediaBytes: number | null;
  mediaSequenceBefore: string | null; mediaSequenceAfter: string | null; contentType: string | null;
  verdict: 'HEALTHY' | 'SUSPECT' | 'BROKEN'; score: number; reason: string; checkedAt: string;
  referer?: string | null; origin?: string | null; screenshot?: string | null;
};

type Channel = { id: number; name: string; nameEn: string; image: string | null; url: string; sources: { url: string }[] };
const TOKEN_KEY = 'momsat.admin.token';
const PAGE_SIZE = 25;

const verdictText = { HEALTHY: 'سالم و زنده', SUSPECT: 'نیازمند بررسی', BROKEN: 'خراب' } as const;
const verdictClass = (value: Probe['verdict']) => value === 'HEALTHY' ? styles.healthy : value === 'SUSPECT' ? styles.suspect : styles.broken;

function proxyStreamUrl(result: Probe) {
  const params = new URLSearchParams({ url: result.url });
  if (result.referer) params.set('referer', result.referer);
  if (result.origin) params.set('origin', result.origin);
  return `/api/stream?${params.toString()}`;
}

async function captureStreamFrame(result: Probe): Promise<string | null> {
  if (!result.url || result.protocol === 'UNKNOWN') return null;
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.position = 'fixed';
  video.style.left = '-10000px';
  video.style.top = '0';
  video.style.width = '480px';
  video.style.height = '270px';
  video.style.opacity = '0';
  document.body.appendChild(video);

  type HlsInstance = InstanceType<typeof import('hls.js').default>;
  let hls: HlsInstance | undefined;
  try {
    const target = proxyStreamUrl(result);
    if (result.protocol === 'HLS') {
      const mod = await import('hls.js');
      const Hls = mod.default;
      if (!Hls.isSupported()) return null;
      const instance = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 20, backBufferLength: 10 });
      hls = instance;
      instance.attachMedia(video);
      instance.on(Hls.Events.MANIFEST_PARSED, () => { void video.play().catch(() => undefined); });
      instance.loadSource(target);
    } else {
      video.src = target;
      video.load();
      void video.play().catch(() => undefined);
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; resolve(); };
      video.addEventListener('loadeddata', finish, { once: true });
      video.addEventListener('canplay', finish, { once: true });
      window.setTimeout(finish, 6500);
    });

    if (video.readyState < 2 || video.videoWidth < 2 || video.videoHeight < 2) return null;
    const canvas = document.createElement('canvas');
    const width = 960;
    const height = Math.max(540, Math.round((video.videoHeight / video.videoWidth) * width));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.84);
  } catch {
    return null;
  } finally {
    hls?.destroy();
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}

async function captureHealthyScreenshots(items: Probe[], onCapture: (key: string, screenshot: string) => void) {
  const queue = items.filter((item) => item.verdict === 'HEALTHY');
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const index = cursor++;
      const item = queue[index];
      const screenshot = await captureStreamFrame(item);
      if (screenshot) onCapture(`${item.channelId}:${item.url}`, screenshot);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()));
}

export default function StreamValidatorPage() {
  const [token, setToken] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [results, setResults] = useState<Probe[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState({ streams: 0, channels: 0 });
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | Probe['verdict']>('all');
  const cancelRef = useRef(false);

  useEffect(() => { try { setToken(localStorage.getItem(TOKEN_KEY) || ''); } catch {} }, []);

  const headers = (): Record<string, string> => token.trim() ? { 'x-admin-token': token.trim() } : {};

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/admin/stream-validator', { cache: 'no-store', headers: headers() });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'دریافت استریم‌ها ناموفق بود');
      setChannels(Array.isArray(body.channels) ? body.channels : []);
    } catch (err) { setError(err instanceof Error ? err.message : 'خطای نامشخص'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function validateBatch(batch: Channel[]) {
    const ids = batch.map((channel) => channel.id);
    const response = await fetch('/api/admin/stream-validator', {
      method: 'POST', headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ channelIds: ids }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'صحت‌سنجی ناموفق بود');
    return Array.isArray(body.results) ? body.results as Probe[] : [];
  }

  async function finalizeHealthy(items: Probe[]) {
    const healthy = items.filter((item) => item.verdict === 'HEALTHY');
    if (!healthy.length) return;
    setPublishing(true);
    try {
      const response = await fetch('/api/admin/stream-validator', {
        method: 'POST',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'finalize', healthy }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'ذخیره خودکار استریم‌های سالم ناموفق بود');
      setPublished({ streams: Number(body.saved) || 0, channels: Number(body.activatedChannels) || 0 });
      setResults((current) => current.map((item) => item.verdict === 'HEALTHY' ? { ...item, reason: 'صحت‌سنجی شد و به‌صورت خودکار در دیتابیس/لیست پخش ثبت شد.' } : item));
    } catch (err) { setError(err instanceof Error ? err.message : 'ذخیره خودکار ناموفق بود'); }
    finally { setPublishing(false); }
  }

  async function validateAll() {
    if (running || publishing) return;
    cancelRef.current = false;
    setRunning(true); setError(''); setResults([]); setPublished({ streams: 0, channels: 0 }); setProgress({ completed: 0, total: channels.length });
    const allResults: Probe[] = [];
    try {
      for (let offset = 0; offset < channels.length; offset += PAGE_SIZE) {
        if (cancelRef.current) break;
        const batchResults = await validateBatch(channels.slice(offset, offset + PAGE_SIZE));
        allResults.push(...batchResults);
        setResults([...allResults]);
        setProgress({ completed: Math.min(offset + PAGE_SIZE, channels.length), total: channels.length });
        void captureHealthyScreenshots(batchResults, (key, screenshot) => {
          setResults((current) => current.map((item) => `${item.channelId}:${item.url}` === key ? { ...item, screenshot } : item));
        });
      }
      if (!cancelRef.current) await finalizeHealthy(allResults);
    } catch (err) { setError(err instanceof Error ? err.message : 'صحت‌سنجی ناموفق بود'); }
    finally { setRunning(false); }
  }

  function cancelValidation() { cancelRef.current = true; }

  const counts = useMemo(() => ({
    total: results.length,
    healthy: results.filter((r) => r.verdict === 'HEALTHY').length,
    suspect: results.filter((r) => r.verdict === 'SUSPECT').length,
    broken: results.filter((r) => r.verdict === 'BROKEN').length,
  }), [results]);
  const visible = filter === 'all' ? results : results.filter((r) => r.verdict === filter);
  const runningLabel = progress.total > 0 ? `در حال بررسی ${progress.completed.toLocaleString('fa-IR')} از ${progress.total.toLocaleString('fa-IR')}` : 'در حال شروع…';

  return <main dir="rtl" className={styles.page}>
    <div className={styles.inner}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>MOMSAT · STREAM VALIDATOR</div>
          <h1 className={styles.title}>صحت‌سنجی واقعی استریم‌ها</h1>
          <p className={styles.description}>لینک‌ها را از نظر دسترسی HTTP، مانيفست HLS/DASH، قطعه رسانه و الگوی تغییر جریان بررسی می‌کند؛ در پایان، استریم‌های سالم به‌صورت خودکار در دیتابیس و چرخه پخش ثبت می‌شوند.</p>
        </div>
        <Link href="/admin" className={styles.back}>بازگشت به مدیریت</Link>
      </header>

      <section className={styles.toolbar}>
        <input className={styles.token} value={token} onChange={(e) => { setToken(e.target.value); try { localStorage.setItem(TOKEN_KEY, e.target.value); } catch {} }} placeholder="ADMIN_TOKEN در صورت نیاز" type="password" />
        {!running ? <button className={styles.primary} disabled={loading || publishing || !channels.length} onClick={() => void validateAll()}>{publishing ? 'در حال ثبت نتایج سالم…' : 'شروع صحت‌سنجی همه استریم‌ها'}</button> : <button className={styles.secondary} onClick={cancelValidation}>توقف پس از batch جاری</button>}
        <button className={styles.secondary} disabled={loading || running || publishing} onClick={() => void load()}>بازخوانی لیست</button>
      </section>

      {running && <div className={styles.progress}><div className={styles.progressTop}><span>{runningLabel}</span><strong>{progress.total ? Math.round((progress.completed / progress.total) * 100) : 0}%</strong></div><div className={styles.progressTrack}><div className={styles.progressBar} style={{ width: `${progress.total ? Math.max(2, Math.round((progress.completed / progress.total) * 100)) : 2}%` }} /></div><p>نتایج هر batch بلافاصله نمایش داده می‌شوند؛ در پایان استریم‌های سالم خودکار ثبت می‌شوند.</p></div>}

      {published.streams > 0 && <div className={styles.success}>✅ {published.streams.toLocaleString('fa-IR')} لینک سالم در دیتابیس ثبت شد و {published.channels.toLocaleString('fa-IR')} شبکه با بهترین مسیر سالم وارد لیست پخش شدند.</div>}

      <section className={styles.stats}>
        <button className={`${styles.stat} ${filter === 'all' ? styles.selected : ''}`} onClick={() => setFilter('all')}><span>نتایج تست</span><strong>{counts.total}</strong></button>
        <button className={`${styles.stat} ${filter === 'HEALTHY' ? styles.selected : ''}`} onClick={() => setFilter('HEALTHY')}><span>سالم</span><strong>{counts.healthy}</strong></button>
        <button className={`${styles.stat} ${filter === 'SUSPECT' ? styles.selected : ''}`} onClick={() => setFilter('SUSPECT')}><span>مشکوک</span><strong>{counts.suspect}</strong></button>
        <button className={`${styles.stat} ${filter === 'BROKEN' ? styles.selected : ''}`} onClick={() => setFilter('BROKEN')}><span>خراب</span><strong>{counts.broken}</strong></button>
        <div className={styles.stat}><span>استریم‌های موجود</span><strong>{channels.length}</strong></div>
      </section>

      {error && <div className={styles.error}>{error}</div>}
      {loading && <div className={styles.empty}>در حال دریافت لیست استریم‌های فعال…</div>}
      {!loading && !results.length && <div className={styles.empty}>{running ? 'در حال دریافت اولین نتایج…' : 'برای شروع، «شروع صحت‌سنجی همه استریم‌ها» را بزن. نتایج به‌صورت تدریجی نمایش داده می‌شوند و پس از پایان، لینک‌های سالم خودکار در دیتابیس ثبت می‌شوند.'}</div>}

      {visible.length > 0 && <div className={styles.list}>
        {visible.map((result) => {
          const key = `${result.channelId}:${result.url}`;
          return <article key={key} className={styles.card}>
            <div className={styles.cardTop}>
              <div>
                <div className={styles.nameLine}><strong>{result.channelName}</strong><span className={verdictClass(result.verdict)}>{verdictText[result.verdict]}</span></div>
                <div className={styles.url}>{result.url}</div>
              </div>
              <div className={styles.score}><span>امتیاز</span><strong>{result.score}</strong>/100</div>
            </div>
            {result.screenshot ? <div className={styles.snapshotWrap}><img className={styles.snapshot} src={result.screenshot} alt={`تصویر زنده ${result.channelName}`} /><span className={styles.snapshotLabel}>LIVE SNAPSHOT</span></div> : null}
            <div className={styles.grid}>
              <div><span>پروتکل</span><strong>{result.protocol}</strong></div>
              <div><span>قابل دسترسی</span><strong>{result.reachable ? 'بله' : 'خیر'}</strong></div>
              <div><span>Live</span><strong>{result.live === true ? 'تشخیص داده شد' : result.live === false ? 'تشخیص نشد' : 'نامشخص'}</strong></div>
              <div><span>Buffer / Media</span><strong>{result.buffering && result.mediaLoaded ? `${result.mediaBytes ?? 0} bytes` : 'ناموفق'}</strong></div>
              <div><span>Latency</span><strong>{result.latencyMs == null ? '—' : `${result.latencyMs} ms`}</strong></div>
              <div><span>تغییر جریان</span><strong>{result.changedDuringProbe === true ? 'بله' : result.changedDuringProbe === false ? 'خیر' : 'نامشخص'}</strong></div>
            </div>
            <div className={styles.reason}>{result.reason}</div>
            <div className={styles.actions}><Link href={`/watch/${result.channelId}`} className={styles.watch}>باز کردن کانال</Link>{result.verdict === 'HEALTHY' ? <span className={styles.autoSaved}>ثبت خودکار در دیتابیس</span> : null}</div>
          </article>;
        })}
      </div>}
    </div>
  </main>;
}
