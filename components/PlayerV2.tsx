'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, Settings, Volume2, VolumeX } from 'lucide-react';

type Source = { id?: number | null; url: string; title?: string | null; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean };
type Channel = { name?: string; image?: string | null; url?: string | null; referer?: string | null; origin?: string | null; sources?: Source[] };
type HlsInstance = { destroy: () => void; loadSource: (url: string) => void; attachMedia: (media: HTMLVideoElement) => void; startLoad: () => void; recoverMediaError: () => void; currentLevel: number; levels: Array<{ height?: number; bitrate?: number }>; on: (event: string, fn: (event: unknown, data: any) => void) => void };
type HlsCtor = { new (config?: Record<string, unknown>): HlsInstance; isSupported: () => boolean; Events: Record<string, string> };

auto:

function usable(url: string) { return /^https?:\/\//i.test(url.trim()); }
function proxied(source: Source) { const qs = new URLSearchParams({ url: source.url }); if (source.referer) qs.set('referer', source.referer); if (source.origin) qs.set('origin', source.origin); return `/api/stream?${qs}`; }
function score(source: Source, index: number) { const u = source.url.toLowerCase(); let s = 0; if (u.includes('.m3u8')) s += 100; if (u.includes('playlist') || u.includes('stream')) s += 10; if (source.country === 'worldwide') s += 3; if (!source.vip) s += 2; return s - index / 1000; }

export default function PlayerV2({ channel }: { channel: Channel }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsInstance | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeRef = useRef(0.85);
  const mutedRef = useRef(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [levels, setLevels] = useState<Array<{ index: number; label: string }>>([]);
  const [quality, setQuality] = useState(-1);
  const [showSources, setShowSources] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const sources = useMemo(() => {
    const raw: Source[] = [];
    if (channel.url && usable(channel.url)) raw.push({ url: channel.url, title: 'Primary', referer: channel.referer, origin: channel.origin });
    raw.push(...(channel.sources ?? []).filter((s) => usable(s.url)));
    return Array.from(new Map(raw.map((s) => [s.url.trim(), s])).values()).sort((a, b) => score(b, raw.indexOf(b)) - score(a, raw.indexOf(a)));
  }, [channel]);

  const destroy = useCallback(() => { hlsRef.current?.destroy(); hlsRef.current = null; }, []);
  const selectSource = useCallback((index: number) => {
    if (!sources.length) return;
    const next = Math.max(0, Math.min(index, sources.length - 1));
    setSourceIndex(next); setError(''); setLoading(true); setPlaying(false); setLevels([]); setQuality(-1);
  }, [sources.length]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sources.length) { setLoading(false); if (!sources.length) setError('برای این شبکه هیچ URL پخشی معتبر ثبت نشده است.'); return; }
    let cancelled = false;
    let localHls: HlsInstance | null = null;
    destroy();
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    const source = sources[sourceIndex] ?? sources[0];
    const url = proxied(source);
    const applyState = () => { video.volume = volumeRef.current; video.muted = mutedRef.current; };
    const failover = (message: string) => {
      if (cancelled) return;
      if (sourceIndex + 1 < sources.length) {
        setError(`${message} مسیر بعدی امتحان می‌شود…`);
        retryTimerRef.current = setTimeout(() => { if (!cancelled) selectSource(sourceIndex + 1); }, 650);
      } else {
        setLoading(false);
        setError(`${message} هیچ مسیر دیگری برای پخش باقی نمانده است.`);
      }
    };
    const onPlaying = () => { if (!cancelled) { setLoading(false); setPlaying(true); } };
    const onPause = () => { if (!cancelled) setPlaying(false); };
    const onWaiting = () => { if (!cancelled) setLoading(true); };
    const onLoaded = () => { if (!cancelled) { applyState(); setLoading(false); video.play().then(() => !cancelled && setPlaying(true)).catch(() => undefined); } };
    const onError = () => failover('منبع فعلی قابل پخش نیست.');
    video.addEventListener('playing', onPlaying); video.addEventListener('pause', onPause); video.addEventListener('waiting', onWaiting); video.addEventListener('loadedmetadata', onLoaded); video.addEventListener('canplay', onLoaded); video.addEventListener('error', onError);
    video.pause(); video.removeAttribute('src'); video.load();

    (async () => {
      try {
        const mod = await import('hls.js');
        if (cancelled) return;
        const Hls = mod.default as unknown as HlsCtor;
        if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = url; video.load(); return; }
        if (!Hls.isSupported()) { setLoading(false); setError('مرورگر فعلی پخش HLS را پشتیبانی نمی‌کند.'); return; }
        localHls = new Hls({ enableWorker: true, lowLatencyMode: true, liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 8, backBufferLength: 30, maxBufferLength: 30, maxMaxBufferLength: 90, manifestLoadingMaxRetry: 3, levelLoadingMaxRetry: 4, fragLoadingMaxRetry: 4, capLevelToPlayerSize: true });
        hlsRef.current = localHls;
        localHls.on(Hls.Events.MANIFEST_PARSED, () => { if (cancelled) return; setLevels(localHls!.levels.map((l, i) => ({ index: i, label: l.height ? `${l.height}p` : `${Math.round((l.bitrate ?? 0) / 1000)} kbps` }))); applyState(); setLoading(false); video.play().then(() => !cancelled && setPlaying(true)).catch(() => undefined); });
        localHls.on(Hls.Events.ERROR, (_event, data) => {
          if (cancelled || !data?.fatal) return;
          if (data.type === 'mediaError') { localHls!.recoverMediaError(); return; }
          if (data.type === 'networkError') { localHls!.startLoad(); failover('خطای شبکه در منبع فعلی.'); return; }
          failover('خطای HLS در منبع فعلی.');
        });
        localHls.loadSource(url); localHls.attachMedia(video);
      } catch { if (!cancelled) failover('راه‌اندازی HLS ناموفق بود.'); }
    })();

    return () => { cancelled = true; if (retryTimerRef.current) clearTimeout(retryTimerRef.current); localHls?.destroy(); if (hlsRef.current === localHls) hlsRef.current = null; video.removeEventListener('playing', onPlaying); video.removeEventListener('pause', onPause); video.removeEventListener('waiting', onWaiting); video.removeEventListener('loadedmetadata', onLoaded); video.removeEventListener('canplay', onLoaded); video.removeEventListener('error', onError); };
  }, [channel, destroy, selectSource, sourceIndex, sources]);

  useEffect(() => { const video = videoRef.current; if (video) { video.volume = volume; video.muted = muted; } }, [volume, muted]);
  useEffect(() => { const fn = () => setFullscreen(document.fullscreenElement === rootRef.current); document.addEventListener('fullscreenchange', fn); return () => document.removeEventListener('fullscreenchange', fn); }, []);

  const togglePlay = () => { const video = videoRef.current; if (!video) return; if (video.paused) video.play().then(() => setPlaying(true)).catch(() => undefined); else video.pause(); };
  const toggleFullscreen = async () => { if (!rootRef.current) return; try { if (document.fullscreenElement) await document.exitFullscreen(); else await rootRef.current.requestFullscreen(); } catch {} };
  const togglePip = async () => { const video = videoRef.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }; if (!video.requestPictureInPicture) return; try { await video.requestPictureInPicture(); } catch {} };

  return <div ref={rootRef} className="pro-player" tabIndex={0} onKeyDown={(e) => { if (e.key === ' ') { e.preventDefault(); togglePlay(); } if (e.key.toLowerCase() === 'f') void toggleFullscreen(); if (e.key.toLowerCase() === 'm') setMuted((v) => !v); }}>
    <video ref={videoRef} className="pro-player-video" poster={channel.image || undefined} playsInline preload="metadata" onDoubleClick={() => void toggleFullscreen()} />
    {loading && !error && <div className="pro-player-loader"><span className="spinner"/><span>در حال اتصال به پخش زنده…</span></div>}
    {error && <div className="pro-player-error"><div><div className="pro-player-error-title">پخش متوقف شد</div><div className="muted">{error}</div><button className="pro-player-retry" onClick={() => selectSource(sourceIndex)}><RotateCcw size={15}/> تلاش مجدد</button></div></div>}
    <div className="pro-player-top"><div className="pro-player-live"><span/> LIVE</div><div className="pro-player-channel">{channel.name || 'MOMSAT'}</div>{sources.length > 1 && <button className="icon-button" onClick={() => setShowSources((v) => !v)} title="مسیرها"><Settings size={18}/></button>}</div>
    {showSources && sources.length > 1 && <div className="pro-player-menu source-menu"><div className="menu-title">مسیر پخش</div>{sources.map((s, i) => <button key={`${s.url}-${i}`} className={i===sourceIndex?'selected':''} onClick={() => { selectSource(i); setShowSources(false); }}><span>{s.title || `Source ${i+1}`}</span>{s.country && <small>{s.country}</small>}</button>)}</div>}
    {showQuality && levels.length > 0 && <div className="pro-player-menu quality-menu"><button className={quality===-1?'selected':''} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel=-1; setQuality(-1); setShowQuality(false); }}>Auto</button>{levels.map((l)=><button key={l.index} className={quality===l.index?'selected':''} onClick={()=>{if(hlsRef.current)hlsRef.current.currentLevel=l.index;setQuality(l.index);setShowQuality(false);}}>{l.label}</button>)}</div>}
    <div className="pro-player-controls"><button className="icon-button large" onClick={togglePlay}>{playing?<Pause size={21}/>:<Play size={21}/>}</button><button className="icon-button" onClick={()=>setMuted(v=>!v)}>{muted||volume===0?<VolumeX size={19}/>:<Volume2 size={19}/>}</button><input className="volume-slider" type="range" min="0" max="1" step="0.01" value={muted?0:volume} onChange={(e)=>{const v=Number(e.target.value);setVolume(v);setMuted(v===0)}}/><div className="pro-player-spacer"/>{levels.length>0&&<button className="text-button" onClick={()=>setShowQuality(v=>!v)}>HD</button>}<button className="text-button live-text">LIVE</button><button className="icon-button" onClick={()=>void togglePip()} title="Picture in picture"><PictureInPicture2 size={18}/></button><button className="icon-button" onClick={()=>void toggleFullscreen()}>{fullscreen?<Minimize size={19}/>:<Maximize size={19}/>}</button></div>
  </div>;
}
