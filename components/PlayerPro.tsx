'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Check, ChevronDown, Clock3, Gauge, HardDriveDownload, Maximize2, Pause, PictureInPicture2, Play, Radio, RotateCcw, Settings2, Volume2, VolumeX, Wifi } from 'lucide-react';
import { getLocalPlayerStats, getLocalPlayerUser, saveLocalPlayerSession, type LocalPlayerSession } from '../lib/local-player-db';

type Source = { id?: number | null; url: string; title?: string | null; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean };
type Channel = { id?: number | null; name?: string; image?: string | null; url?: string | null; referer?: string | null; origin?: string | null; sources?: Source[] };
type HlsLike = { destroy: () => void; loadSource: (url: string) => void; attachMedia: (media: HTMLVideoElement) => void; startLoad: (startPosition?: number) => void; recoverMediaError: () => void; currentLevel: number; levels: Array<{ height?: number; bitrate?: number }>; on: (event: string, fn: (event: unknown, data: any) => void) => void };
type HlsCtor = { new (config?: Record<string, unknown>): HlsLike; isSupported: () => boolean; Events: Record<string, string> };
type Mode = 'proxy' | 'direct';
type Metrics = { durationSec: number; bytes: number; estimated: boolean; bitrateKbps: number; hourlyBytes: number; sessionTotalBytes: number };

function usable(url: string) { return /^https?:\/\//i.test(url.trim()); }
function isM3u8(url: string) { return /\.m3u8(?:$|[?#])/i.test(url.trim()); }
function isNative(url: string) { return /\.(?:mp4|webm|m4v)(?:$|[?#])/i.test(url.trim()); }
function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
function formatDuration(totalSec: number) {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function proxied(source: Source) {
  const qs = new URLSearchParams({ url: source.url.trim() });
  if (source.referer) qs.set('referer', source.referer);
  if (source.origin) qs.set('origin', source.origin);
  return `/api/stream?${qs.toString()}`;
}
function rank(source: Source, index: number) {
  const url = source.url.toLowerCase();
  let score = 0;
  if (isM3u8(url)) score += 100;
  if (isNative(url)) score += 80;
  if (url.includes('playlist') || url.includes('stream') || url.includes('manifest')) score += 10;
  if (!source.vip) score += 2;
  return score - index / 10000;
}

export default function PlayerPro({ channel }: { channel: Channel }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsLike | null>(null);
  const epochRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef<LocalPlayerSession | null>(null);
  const userIdRef = useRef('');
  const metricsRef = useRef<Metrics>({ durationSec: 0, bytes: 0, estimated: true, bitrateKbps: 0, hourlyBytes: 0, sessionTotalBytes: 0 });
  const startedAtRef = useRef(0);
  const observedBytesRef = useRef(0);
  const performanceSeenRef = useRef<Set<string>>(new Set());
  const volumeRef = useRef(0.82);
  const mutedRef = useRef(true);
  const playingRef = useRef(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('proxy');
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [volume, setVolume] = useState(0.82);
  const [muted, setMuted] = useState(true);
  const [quality, setQuality] = useState(-1);
  const [levels, setLevels] = useState<Array<{ index: number; label: string }>>([]);
  const [showSources, setShowSources] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [historyBytes, setHistoryBytes] = useState(0);
  const [metrics, setMetrics] = useState<Metrics>(metricsRef.current);

  const sources = useMemo(() => {
    const raw: Source[] = [];
    if (channel.url && usable(channel.url)) raw.push({ url: channel.url, title: 'Primary', referer: channel.referer, origin: channel.origin });
    raw.push(...(channel.sources ?? []).filter((item) => usable(item.url)));
    const unique = Array.from(new Map(raw.map((item) => [item.url.trim(), item])).values());
    return unique.sort((a, b) => rank(b, unique.indexOf(b)) - rank(a, unique.indexOf(a)));
  }, [channel.url, channel.referer, channel.origin, channel.sources]);

  const destroy = useCallback(() => { hlsRef.current?.destroy(); hlsRef.current = null; }, []);
  const chooseSource = useCallback((index: number) => {
    if (!sources.length) return;
    setSourceIndex(Math.max(0, Math.min(index, sources.length - 1)));
    setError(''); setLoading(true); setPlaying(false); setLevels([]); setQuality(-1);
  }, [sources.length]);
  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try { await video.play(); setPlaying(true); } catch { setPlaying(false); }
  }, []);
  const toggleFullscreen = useCallback(async () => {
    if (!rootRef.current) return;
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await rootRef.current.requestFullscreen(); } catch {}
  }, []);

  const getObservedBytes = useCallback(() => {
    const active = sources[sourceIndex]?.url.trim() || '';
    if (!active) return observedBytesRef.current;
    const activeOrigin = (() => { try { return new URL(active).origin; } catch { return ''; } })();
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (const entry of resources) {
      const name = entry.name;
      const proxy = name.includes('/api/stream?');
      const direct = activeOrigin && name.startsWith(activeOrigin);
      if (!proxy && !direct) continue;
      const key = `${name}|${entry.startTime}|${entry.responseEnd}`;
      if (performanceSeenRef.current.has(key)) continue;
      const bytes = Number(entry.transferSize || entry.encodedBodySize || 0);
      performanceSeenRef.current.add(key);
      if (bytes > 0) observedBytesRef.current += bytes;
    }
    return observedBytesRef.current;
  }, [sourceIndex, sources]);

  const persistSession = useCallback(async (completed: boolean) => {
    let session = sessionRef.current;
    if (!session) return;
    let userId = userIdRef.current;
    if (!userId) {
      try { userId = (await getLocalPlayerUser()).id; userIdRef.current = userId; } catch { return; }
    }
    const current = metricsRef.current;
    session = { ...session, userId, durationSec: Math.max(0, Math.round((Date.now() - session.startedAt) / 1000)), bytes: Math.max(0, current.bytes), estimatedBytes: current.estimated, bitrateKbps: current.bitrateKbps, completed, endedAt: completed ? Date.now() : session.endedAt, updatedAt: Date.now() };
    sessionRef.current = session;
    try {
      await saveLocalPlayerSession(session);
      if (completed) setHistoryBytes((await getLocalPlayerStats(userId)).totalBytes);
    } catch {}
  }, []);

  useEffect(() => {
    playingRef.current = playing; metricsRef.current = metrics;
  }, [playing, metrics]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  useEffect(() => {
    let cancelled = false;
    void getLocalPlayerUser().then(async (user) => {
      if (cancelled) return;
      userIdRef.current = user.id;
      if (sessionRef.current) sessionRef.current.userId = user.id;
      try { setHistoryBytes((await getLocalPlayerStats(user.id)).totalBytes); } catch {}
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!sessionRef.current) return;
    if (persistTimerRef.current) clearInterval(persistTimerRef.current);
    persistTimerRef.current = setInterval(() => { void persistSession(false); }, 10000);
    return () => { if (persistTimerRef.current) clearInterval(persistTimerRef.current); };
  }, [persistSession, sourceIndex]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sources.length) { setLoading(false); setError('برای این شبکه هیچ URL پخش معتبری ثبت نشده است.'); return; }
    const epoch = ++epochRef.current;
    let cancelled = false;
    let localHls: HlsLike | null = null;
    let activeMode: Mode = 'proxy';
    const source = sources[Math.min(sourceIndex, sources.length - 1)];
    const directUrl = source.url.trim();
    const proxy = proxied(source);

    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    destroy();
    observedBytesRef.current = 0;
    performanceSeenRef.current = new Set();
    startedAtRef.current = Date.now();
    setMetrics({ durationSec: 0, bytes: 0, estimated: true, bitrateKbps: 0, hourlyBytes: 0, sessionTotalBytes: historyBytes });
    setMode('proxy'); modeRef.current = 'proxy';
    setLoading(true); setPlaying(false); setError(''); setLevels([]); setQuality(-1);
    sessionRef.current = { id: crypto.randomUUID(), userId: userIdRef.current || 'pending', channelId: channel.id, channelName: channel.name || 'MOMSAT', sourceUrl: directUrl, mode: 'proxy', startedAt: startedAtRef.current, durationSec: 0, bytes: 0, estimatedBytes: true, completed: false, updatedAt: Date.now() };

    const startNative = (target: string) => { video.volume = volumeRef.current; video.muted = mutedRef.current; video.src = target; video.load(); void play(); };
    const setStarted = (nextMode: Mode) => {
      activeMode = nextMode; modeRef.current = nextMode; setMode(nextMode); destroy(); video.pause(); video.removeAttribute('src'); video.load();
      if (sessionRef.current) sessionRef.current = { ...sessionRef.current, userId: userIdRef.current || sessionRef.current.userId, sourceUrl: directUrl, mode: nextMode, updatedAt: Date.now() };
    };
    const failover = (message: string) => {
      if (cancelled || epoch !== epochRef.current) return;
      if (activeMode === 'proxy') { setStarted('direct'); setError(`${message} تلاش مستقیم…`); startHls(directUrl, 'direct'); return; }
      if (sourceIndex + 1 < sources.length) { setError(`${message} مسیر بعدی…`); retryTimerRef.current = setTimeout(() => { if (!cancelled) chooseSource(sourceIndex + 1); }, 700); return; }
      setLoading(false); setError(`${message} هیچ مسیر دیگری برای پخش باقی نمانده است.`);
    };
    const onPlaying = () => { if (!cancelled && epoch === epochRef.current) { setLoading(false); setPlaying(true); setError(''); if (watchdogRef.current) clearTimeout(watchdogRef.current); } };
    const onPause = () => { if (!cancelled && epoch === epochRef.current) setPlaying(false); };
    const onWaiting = () => { if (!cancelled && epoch === epochRef.current && playingRef.current) setLoading(true); };
    const onVideoError = () => failover(activeMode === 'proxy' ? 'پراکسی استریم را تحویل نداد.' : 'مسیر مستقیم خطا داد.');
    video.addEventListener('playing', onPlaying); video.addEventListener('pause', onPause); video.addEventListener('waiting', onWaiting); video.addEventListener('error', onVideoError);
    video.pause(); video.removeAttribute('src'); video.load();

    const startHls = (target: string, targetMode: Mode) => {
      void (async () => {
        try {
          const mod = await import('hls.js');
          if (cancelled || epoch !== epochRef.current) return;
          const Hls = mod.default as unknown as HlsCtor;
          if (!Hls.isSupported()) { setLoading(false); setError('مرورگر فعلی HLS را پشتیبانی نمی‌کند.'); return; }
          const hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 30, maxBufferLength: 45, maxMaxBufferLength: 90, liveSyncDurationCount: 4, liveMaxLatencyDurationCount: 12, maxLiveSyncPlaybackRate: 1.15, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 3, fragLoadingMaxRetry: 3, manifestLoadingTimeOut: 12000, levelLoadingTimeOut: 12000, fragLoadingTimeOut: 15000, capLevelToPlayerSize: true, startLevel: -1, maxBufferHole: 0.8 });
          localHls = hls; hlsRef.current = hls; activeMode = targetMode; modeRef.current = targetMode; setMode(targetMode);
          if (sessionRef.current) sessionRef.current = { ...sessionRef.current, userId: userIdRef.current || sessionRef.current.userId, sourceUrl: directUrl, mode: targetMode, updatedAt: Date.now() };
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled || epoch !== epochRef.current || hlsRef.current !== hls) return;
            const mapped = hls.levels.map((level, index) => ({ index, label: level.height ? `${level.height}p` : level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : `Level ${index + 1}` }));
            setLevels(mapped.filter((item, index, all) => all.findIndex((v) => v.label === item.label) === index));
            const bitrate = hls.levels[hls.currentLevel]?.bitrate || hls.levels[0]?.bitrate || 0;
            setMetrics((prev) => ({ ...prev, bitrateKbps: Math.round(bitrate / 1000) }));
            video.volume = volumeRef.current; video.muted = mutedRef.current; setLoading(false); void play();
          });
          hls.on(Hls.Events.LEVEL_SWITCHED, () => { const bitrate = hls.levels[hls.currentLevel]?.bitrate || hls.levels[0]?.bitrate || 0; if (bitrate > 0) setMetrics((prev) => ({ ...prev, bitrateKbps: Math.round(bitrate / 1000) })); });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (cancelled || epoch !== epochRef.current || hlsRef.current !== hls || !data?.fatal) return;
            if (data.type === 'mediaError') { try { hls.recoverMediaError(); return; } catch {} }
            failover(targetMode === 'proxy' ? 'خطای HLS پراکسی.' : 'خطای HLS مستقیم.');
          });
          hls.loadSource(target); hls.attachMedia(video);
        } catch { failover(targetMode === 'proxy' ? 'راه‌اندازی پراکسی ناموفق بود.' : 'راه‌اندازی مستقیم ناموفق بود.'); }
      })();
    };

    if (isNative(directUrl)) startNative(directUrl);
    else if (video.canPlayType('application/vnd.apple.mpegurl')) startNative(directUrl);
    else { startHls(proxy, 'proxy'); watchdogRef.current = setTimeout(() => { if (!cancelled && epoch === epochRef.current && activeMode === 'proxy' && !playingRef.current) failover('پراکسی در زمان مناسب پاسخ نداد.'); }, 9000); }

    const onVisibility = () => { if (document.visibilityState === 'hidden') void persistSession(false); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
      video.removeEventListener('playing', onPlaying); video.removeEventListener('pause', onPause); video.removeEventListener('waiting', onWaiting); video.removeEventListener('error', onVideoError);
      void persistSession(true);
      destroy();
    };
  }, [channel.id, channel.name, chooseSource, destroy, historyBytes, persistSession, play, sourceIndex, sources]);

  useEffect(() => {
    const timer = setInterval(() => {
      const durationSec = startedAtRef.current ? Math.max(0, (Date.now() - startedAtRef.current) / 1000) : 0;
      const observed = getObservedBytes();
      setMetrics((prev) => {
        const estimatedBytes = prev.bitrateKbps > 0 ? prev.bitrateKbps * 1000 / 8 * durationSec : 0;
        const bytes = observed > 0 ? Math.max(prev.bytes, observed) : estimatedBytes;
        const next = { ...prev, durationSec, bytes, estimated: observed <= 0, hourlyBytes: durationSec > 2 ? bytes / durationSec * 3600 : 0, sessionTotalBytes: historyBytes + bytes };
        metricsRef.current = next;
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [getObservedBytes, historyBytes]);

  useEffect(() => () => { if (persistTimerRef.current) clearInterval(persistTimerRef.current); }, []);
  useEffect(() => { const onFullscreen = () => setFullscreen(document.fullscreenElement === rootRef.current); document.addEventListener('fullscreenchange', onFullscreen); return () => document.removeEventListener('fullscreenchange', onFullscreen); }, []);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.target instanceof HTMLInput || event.target instanceof HTMLTextAreaElement) return; if (event.key === ' ') { event.preventDefault(); if (videoRef.current?.paused) void play(); else videoRef.current?.pause(); } if (event.key.toLowerCase() === 'm') setMuted((v) => !v); if (event.key.toLowerCase() === 'f') void toggleFullscreen(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [play, toggleFullscreen]);

  const current = sources[sourceIndex] ?? sources[0];
  const rate = metrics.bitrateKbps > 0 ? `${metrics.bitrateKbps} kbps` : 'Auto';
  const usage = metrics.bytes > 0 ? formatBytes(metrics.bytes) : '0 B';
  const hourly = metrics.hourlyBytes > 0 ? formatBytes(metrics.hourlyBytes) : '—';

  return <>
    <div className="player-pro-shell">
      <div ref={rootRef} className={`pro-player pro-player-pro${fullscreen ? ' is-fullscreen' : ''}`} tabIndex={0}>
        <video ref={videoRef} className="pro-player-video" poster={channel.image || undefined} playsInline preload="auto" muted={muted} onClick={() => { if (videoRef.current?.paused) void play(); else videoRef.current?.pause(); }} onDoubleClick={() => void toggleFullscreen()} />
        <div className="player-pro-vignette" />
        {loading && !error && <div className="pro-player-loader pro-player-loader-pro"><span className="spinner" /><span>{mode === 'proxy' ? 'در حال اتصال به پخش…' : 'در حال اتصال مستقیم…'}</span></div>}
        {error && <div className="pro-player-error"><div><div className="pro-player-error-title">پخش متوقف شد</div><div className="muted">{error}</div><button className="pro-player-retry" onClick={() => chooseSource(sourceIndex)}><RotateCcw size={15} /> تلاش مجدد</button></div></div>}
        <div className="player-pro-topbar"><div className="player-pro-brand"><Radio size={15} /><span>LIVE</span></div><div className="player-pro-name">{channel.name || 'MOMSAT'}</div><div className="player-pro-status"><span className={`status-dot ${playing ? 'on' : ''}`} />{mode === 'proxy' ? 'PROXY' : 'DIRECT'}</div>{sources.length > 1 && <button className="player-pro-icon" onClick={() => setShowSources((v) => !v)} title="منابع"><Settings2 size={18} /></button>}</div>
        {showSources && sources.length > 1 && <div className="player-pro-menu source-menu-pro"><div className="player-pro-menu-title">منبع پخش</div>{sources.map((item, index) => <button key={`${item.url}-${index}`} className={index === sourceIndex ? 'selected' : ''} onClick={() => { chooseSource(index); setShowSources(false); }}><span>{item.title || `منبع ${index + 1}`}</span><small>{item.country || ''}</small>{index === sourceIndex && <Check size={15} />}</button>)}</div>}
        {showQuality && levels.length > 0 && <div className="player-pro-menu quality-menu-pro"><div className="player-pro-menu-title">کیفیت</div><button className={quality === -1 ? 'selected' : ''} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel = -1; setQuality(-1); setShowQuality(false); }}>Auto</button>{levels.map((level) => <button key={level.index} className={quality === level.index ? 'selected' : ''} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel = level.index; setQuality(level.index); setShowQuality(false); }}>{level.label}{quality === level.index && <Check size={15} />}</button>)}</div>}
        {!playing && !loading && !error && <div className="player-pro-center-control"><button className="player-pro-bigplay" onClick={() => void play()}><Play size={30} fill="currentColor" /></button></div>}
        <div className="player-pro-bottombar"><div className="player-pro-main-controls"><button className="player-pro-icon player-pro-icon-lg" onClick={() => { if (videoRef.current?.paused) void play(); else videoRef.current?.pause(); }} title={playing ? 'توقف' : 'پخش'}>{playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}</button><button className="player-pro-icon" onClick={() => setMuted((v) => !v)} title={muted ? 'صدا' : 'بی‌صدا'}>{muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button><input className="player-pro-volume" type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); setMuted(next === 0); }} aria-label="Volume" /></div><div className="player-pro-live-readout"><span className="pulse-line" /> LIVE</div><div className="player-pro-spacer" /><button className="player-pro-chip" onClick={() => setShowUsage((v) => !v)}><HardDriveDownload size={16} /><span>{usage}</span></button>{levels.length > 0 && <button className="player-pro-chip" onClick={() => setShowQuality((v) => !v)}><Gauge size={16} /><span>{quality === -1 ? rate : levels.find((level) => level.index === quality)?.label || rate}</span><ChevronDown size={14} /></button>}<button className="player-pro-icon" onClick={async () => { const video = videoRef.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }; if (video.requestPictureInPicture) { try { await video.requestPictureInPicture(); } catch {} } }} title="Picture in Picture"><PictureInPicture2 size={18} /></button><button className="player-pro-icon" onClick={() => void toggleFullscreen()} title="تمام صفحه"><Maximize2 size={18} /></button></div>
        {showUsage && <div className="player-pro-usage-popover"><div className="usage-head"><div><strong>مصرف اینترنت</strong><span>اطلاعات ذخیره‌شده فقط در دیتابیس محلی این مرورگر</span></div><Wifi size={18} /></div><div className="usage-grid"><div><span><Clock3 size={14} /> این جلسه</span><strong>{formatDuration(metrics.durationSec)}</strong></div><div><span><HardDriveDownload size={14} /> این جلسه</span><strong>{usage}</strong></div><div><span><Gauge size={14} /> نرخ تقریبی</span><strong>{rate}</strong></div><div><span><Activity size={14} /> برای ۱ ساعت</span><strong>{hourly}</strong></div></div><div className="usage-total"><span>مجموع مصرف کاربر محلی</span><strong>{formatBytes(metrics.sessionTotalBytes)}</strong></div><div className="usage-note">برای Proxy مقدار واقعی درخواست‌های هم‌مبدأ از Resource Timing خوانده می‌شود؛ در مسیر مستقیم، در صورت نبودن timing مجاز، مقدار بر اساس bitrate تقریبی است.</div></div>}
      </div>
      <div className="player-pro-metricsbar"><div className="player-pro-metric"><HardDriveDownload size={15} /><span>مصرف این جلسه</span><strong>{usage}{metrics.estimated ? ' تقریبی' : ''}</strong></div><div className="player-pro-metric"><Clock3 size={15} /><span>مدت</span><strong>{formatDuration(metrics.durationSec)}</strong></div><div className="player-pro-metric"><Gauge size={15} /><span>مصرف ساعتی</span><strong>{hourly}/h</strong></div><div className="player-pro-metric"><Wifi size={15} /><span>اتصال</span><strong>{mode === 'proxy' ? 'Proxy' : 'Direct'}</strong></div><div className="player-pro-metric player-pro-metric-source"><span>منبع</span><strong>{current?.title || 'Primary'}</strong></div></div>
    </div>
    <style jsx global>{`\n      .player-pro-shell{width:100%;background:#05070b}\n      .pro-player-pro{border-radius:16px 16px 0 0;box-shadow:0 22px 70px rgba(0,0,0,.34)}\n      .pro-player-pro.is-fullscreen{border-radius:0}\n      .player-pro-vignette{position:absolute;inset:0;z-index:1;pointer-events:none;background:radial-gradient(circle at center,transparent 45%,rgba(0,0,0,.28) 100%)}\n      .player-pro-topbar{position:absolute;top:0;left:0;right:0;z-index:5;display:flex;align-items:center;gap:10px;padding:13px 14px;background:linear-gradient(180deg,rgba(3,6,10,.88),rgba(3,6,10,0))}\n      .player-pro-brand{display:inline-flex;align-items:center;gap:6px;padding:7px 9px;border-radius:8px;background:rgba(255,31,74,.92);font:900 10px/1 Tahoma,Arial,sans-serif;color:#fff;letter-spacing:.5px}\n      .player-pro-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800;font-size:13px;text-shadow:0 2px 8px #000}\n      .player-pro-status{display:flex;align-items:center;gap:6px;padding:6px 9px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(8,12,17,.58);color:#9da9b8;font:800 9px ui-monospace,SFMono-Regular,Menlo,monospace}\n      .status-dot{width:6px;height:6px;border-radius:50%;background:#7f8a96}.status-dot.on{background:#39e58c;box-shadow:0 0 0 4px rgba(57,229,140,.1)}\n      .player-pro-icon{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(7,11,16,.62);color:#eef5fb;cursor:pointer;backdrop-filter:blur(10px);transition:.15s}.player-pro-icon:hover,.player-pro-chip:hover{border-color:rgba(55,208,255,.45);background:rgba(16,39,52,.82);color:#37d0ff}\n      .player-pro-icon-lg{width:42px;height:42px}\n      .player-pro-bottombar{position:absolute;left:0;right:0;bottom:0;z-index:5;display:flex;align-items:center;gap:8px;padding:11px 12px;background:linear-gradient(0deg,rgba(2,5,9,.94),rgba(2,5,9,.74),transparent)}\n      .player-pro-main-controls{display:flex;align-items:center;gap:7px}.player-pro-volume{width:86px;accent-color:#37d0ff;cursor:pointer}.player-pro-live-readout{display:flex;align-items:center;gap:7px;color:#fff;font:900 9px Tahoma,Arial,sans-serif}.pulse-line{width:7px;height:7px;border-radius:50%;background:#ff315b;box-shadow:0 0 0 5px rgba(255,49,91,.1)}\n      .player-pro-spacer{flex:1}.player-pro-chip{height:34px;display:inline-flex;align-items:center;gap:7px;padding:0 10px;border:1px solid rgba(255,255,255,.1);border-radius:9px;background:rgba(7,11,16,.62);color:#eaf2fa;font:800 10px Tahoma,Arial,sans-serif;cursor:pointer;backdrop-filter:blur(10px)}\n      .player-pro-center-control{position:absolute;inset:0;z-index:4;display:grid;place-items:center;pointer-events:none}.player-pro-bigplay{pointer-events:auto;width:72px;height:72px;border:1px solid rgba(255,255,255,.18);border-radius:50%;background:rgba(5,10,15,.66);color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 14px 40px rgba(0,0,0,.4);backdrop-filter:blur(10px);transition:.18s}.player-pro-bigplay:hover{transform:scale(1.05);color:#37d0ff;border-color:rgba(55,208,255,.45)}\n      .player-pro-menu{position:absolute;z-index:9;min-width:220px;padding:7px;border:1px solid #2c3948;border-radius:13px;background:rgba(8,12,18,.96);box-shadow:0 18px 55px rgba(0,0,0,.48);backdrop-filter:blur(16px)}.source-menu-pro{top:58px;right:12px}.quality-menu-pro{right:12px;bottom:66px}.player-pro-menu-title{padding:8px 9px 10px;color:#8290a2;font-size:10px;font-weight:900}.player-pro-menu button{width:100%;display:flex;align-items:center;gap:9px;justify-content:space-between;padding:10px;border:0;border-radius:9px;background:transparent;color:#d8e2ed;cursor:pointer;font:12px Tahoma,Arial,sans-serif}.player-pro-menu button:hover,.player-pro-menu button.selected{background:#13232e;color:#37d0ff}.player-pro-menu button span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.player-pro-menu button small{margin-left:auto;color:#7e8b99;font-size:9px}\n      .player-pro-usage-popover{position:absolute;right:12px;bottom:66px;z-index:10;width:min(360px,calc(100% - 24px));padding:14px;border:1px solid #2b3948;border-radius:14px;background:rgba(7,11,17,.97);box-shadow:0 20px 60px rgba(0,0,0,.5);backdrop-filter:blur(18px)}.usage-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.usage-head strong,.usage-head span{display:block}.usage-head strong{font-size:13px}.usage-head span{margin-top:4px;color:#8390a0;font-size:9px}.usage-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.usage-grid>div{padding:10px;border:1px solid #1e2b38;border-radius:10px;background:#0b1118}.usage-grid span{display:flex;align-items:center;gap:5px;color:#8290a0;font-size:9px}.usage-grid strong{display:block;margin-top:6px;font-size:14px}.usage-total{display:flex;justify-content:space-between;gap:10px;margin-top:9px;padding:11px 12px;border-radius:10px;background:#0e1821;color:#b7c3d2;font-size:10px}.usage-total strong{color:#37d0ff}.usage-note{margin-top:9px;color:#6f7d8c;font-size:8px;line-height:1.7}\n      .player-pro-metricsbar{display:flex;align-items:stretch;min-height:62px;border:1px solid #202a35;border-top:0;border-radius:0 0 16px 16px;background:linear-gradient(180deg,#0c1219,#091017);overflow:hidden}.player-pro-metric{min-width:0;flex:1;display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:7px;padding:10px 12px;border-left:1px solid #1b2530}.player-pro-metric:first-child{border-left:0}.player-pro-metric>svg{grid-row:1/3;align-self:center;color:#37d0ff}.player-pro-metric span{color:#738194;font-size:8px}.player-pro-metric strong{margin-top:3px;color:#dbe4ed;font-size:10px}.player-pro-metric-source{max-width:220px}.player-pro-metric-source strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n      @media(max-width:720px){.player-pro-volume{display:none}.player-pro-status{display:none}.player-pro-chip span{display:none}.player-pro-metric{padding:9px 7px}.player-pro-metric:nth-child(4){display:none}.player-pro-metric-source{max-width:120px}.player-pro-metricsbar{min-height:56px}.source-menu-pro,.quality-menu-pro{right:8px}.player-pro-bottombar{padding:8px}.player-pro-topbar{padding:9px}.player-pro-icon{width:34px;height:34px}.player-pro-icon-lg{width:38px;height:38px}}\n    `}</style>
  </>;
}
