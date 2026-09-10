'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Check, ChevronDown, Clock3, Gauge, HardDriveDownload, Maximize2, Pause,
  PictureInPicture2, Play, Radio, RotateCcw, Settings2, Volume2, VolumeX, Wifi,
} from 'lucide-react';
import { getLocalPlayerStats, getLocalPlayerUser, saveLocalPlayerSession, type LocalPlayerSession } from '../lib/local-player-db';

type Source = {
  id?: number | null;
  url: string;
  title?: string | null;
  referer?: string | null;
  origin?: string | null;
  country?: string | null;
  vip?: boolean;
};

type Channel = {
  id?: number | null;
  name?: string;
  image?: string | null;
  url?: string | null;
  referer?: string | null;
  origin?: string | null;
  sources?: Source[];
};

type HlsLike = {
  destroy: () => void;
  loadSource: (url: string) => void;
  attachMedia: (media: HTMLVideoElement) => void;
  startLoad: (startPosition?: number) => void;
  recoverMediaError: () => void;
  currentLevel: number;
  levels: Array<{ height?: number; bitrate?: number }>;
  on: (event: string, fn: (event: unknown, data: any) => void) => void;
};

type HlsCtor = {
  new (config?: Record<string, unknown>): HlsLike;
  isSupported: () => boolean;
  Events: Record<string, string>;
};

type Mode = 'proxy' | 'direct';

type Metrics = {
  durationSec: number;
  bytes: number;
  estimated: boolean;
  bitrateKbps: number;
  hourlyBytes: number;
  sessionTotalBytes: number;
};

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
function proxyUrl(source: Source) {
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
  if (url.includes('playlist') || url.includes('manifest') || url.includes('stream')) score += 10;
  if (!source.vip) score += 2;
  return score - index / 10000;
}

export default function PlayerPro({ channel }: { channel: Channel }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsLike | null>(null);
  const epochRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const directWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sampleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef<LocalPlayerSession | null>(null);
  const localUserIdRef = useRef<string>('');
  const baselinePerformanceRef = useRef<Map<string, number>>(new Map());
  const volumeRef = useRef(0.82);
  const mutedRef = useRef(true);
  const playingRef = useRef(false);
  const modeRef = useRef<Mode>('proxy');
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
  const [metrics, setMetrics] = useState<Metrics>({ durationSec: 0, bytes: 0, estimated: true, bitrateKbps: 0, hourlyBytes: 0, sessionTotalBytes: 0 });

  const sources = useMemo(() => {
    const raw: Source[] = [];
    if (channel.url && usable(channel.url)) raw.push({ url: channel.url, title: 'Primary', referer: channel.referer, origin: channel.origin });
    raw.push(...(channel.sources ?? []).filter((item) => usable(item.url)));
    const unique = Array.from(new Map(raw.map((item) => [item.url.trim(), item])).values());
    return unique.sort((a, b) => rank(b, unique.indexOf(b)) - rank(a, unique.indexOf(a)));
  }, [channel.url, channel.referer, channel.origin, channel.sources]);

  const destroy = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  const chooseSource = useCallback((index: number) => {
    if (!sources.length) return;
    setSourceIndex(Math.max(0, Math.min(index, sources.length - 1)));
    setError('');
    setLoading(true);
    setPlaying(false);
    setLevels([]);
    setQuality(-1);
  }, [sources.length]);

  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!rootRef.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current.requestFullscreen();
    } catch {}
  }, []);

  const sampleBytes = useCallback(() => {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const relevant = resources.filter((entry) => {
      const name = entry.name;
      return name.includes('/api/stream?') || name === sources[sourceIndex]?.url || name.startsWith(sources[sourceIndex]?.url.split('?')[0] || '__never__');
    });
    let total = 0;
    for (const entry of relevant) {
      const key = `${entry.name}|${entry.startTime}|${entry.responseEnd}`;
      if (baselinePerformanceRef.current.has(key)) continue;
      const bytes = Number(entry.transferSize || entry.encodedBodySize || 0);
      if (bytes > 0) {
        total += bytes;
        baselinePerformanceRef.current.set(key, bytes);
      }
    }
    return total;
  }, [sourceIndex, sources]);

  const persistSession = useCallback(async (completed: boolean) => {
    const session = sessionRef.current;
    const userId = localUserIdRef.current;
    if (!session || !userId) return;
    const next: LocalPlayerSession = {
      ...session,
      durationSec: Math.max(0, Math.round((Date.now() - session.startedAt) / 1000)),
      bytes: Math.max(0, metrics.bytes),
      estimatedBytes: metrics.estimated,
      bitrateKbps: metrics.bitrateKbps,
      completed,
      endedAt: completed ? Date.now() : session.endedAt,
      updatedAt: Date.now(),
    };
    sessionRef.current = next;
    try {
      await saveLocalPlayerSession(next);
      if (completed) {
        const stats = await getLocalPlayerStats(userId);
        setHistoryBytes(stats.totalBytes);
      }
    } catch {}
  }, [metrics]);

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  useEffect(() => {
    let cancelled = false;
    void getLocalPlayerUser().then((user) => {
      if (!cancelled) localUserIdRef.current = user.id;
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getLocalPlayerUser().then(async (user) => {
      if (cancelled) return;
      localUserIdRef.current = user.id;
      try {
        const stats = await getLocalPlayerStats(user.id);
        if (!cancelled) setHistoryBytes(stats.totalBytes);
      } catch {}
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sources.length) {
      setLoading(false);
      setError('برای این شبکه هیچ URL پخش معتبری ثبت نشده است.');
      return;
    }

    const epoch = ++epochRef.current;
    let cancelled = false;
    let localHls: HlsLike | null = null;
    let activeMode: Mode = 'proxy';
    const source = sources[Math.min(sourceIndex, sources.length - 1)];
    const direct = source.url.trim();
    const proxied = proxyUrl(source);

    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (directWatchdogRef.current) clearTimeout(directWatchdogRef.current);
    destroy();
    baselinePerformanceRef.current = new Map();
    setMode('proxy');
    modeRef.current = 'proxy';
    setLoading(true);
    setPlaying(false);
    setError('');
    setLevels([]);
    setQuality(-1);
    setMetrics({ durationSec: 0, bytes: 0, estimated: true, bitrateKbps: 0, hourlyBytes: 0, sessionTotalBytes: 0 });
    sessionRef.current = {
      id: crypto.randomUUID(),
      userId: localUserIdRef.current || `pending-${crypto.randomUUID()}`,
      channelId: channel.id,
      channelName: channel.name || 'MOMSAT',
      sourceUrl: direct,
      mode: 'proxy',
      startedAt: Date.now(),
      durationSec: 0,
      bytes: 0,
      estimatedBytes: true,
      completed: false,
      updatedAt: Date.now(),
    };

    const setStarted = (nextMode: Mode, startUrl: string) => {
      activeMode = nextMode;
      modeRef.current = nextMode;
      setMode(nextMode);
      destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
      const next = sessionRef.current;
      if (next) sessionRef.current = { ...next, userId: localUserIdRef.current || next.userId, sourceUrl: startUrl, mode: nextMode, updatedAt: Date.now() };
    };

    const failover = (message: string) => {
      if (cancelled || epoch !== epochRef.current) return;
      if (activeMode === 'proxy') {
        setStarted('direct', direct);
        setError(`${message} تلاش مستقیم…`);
        startHls(direct, 'direct');
        return;
      }
      if (sourceIndex + 1 < sources.length) {
        setError(`${message} مسیر بعدی…`);
        retryTimerRef.current = setTimeout(() => { if (!cancelled) chooseSource(sourceIndex + 1); }, 700);
        return;
      }
      setLoading(false);
      setError(`${message} هیچ مسیر دیگری برای پخش باقی نمانده است.`);
    };

    const onPlaying = () => {
      if (cancelled || epoch !== epochRef.current) return;
      setLoading(false);
      setPlaying(true);
      setError('');
      if (directWatchdogRef.current) { clearTimeout(directWatchdogRef.current); directWatchdogRef.current = null; }
    };
    const onPause = () => { if (!cancelled && epoch === epochRef.current) setPlaying(false); };
    const onWaiting = () => { if (!cancelled && epoch === epochRef.current && playingRef.current) setLoading(true); };
    const onVideoError = () => failover(activeMode === 'proxy' ? 'پراکسی استریم را تحویل نداد.' : 'مسیر مستقیم خطا داد.');

    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('error', onVideoError);
    video.pause();
    video.removeAttribute('src');
    video.load();

    const startNative = (target: string) => {
      video.volume = volumeRef.current;
      video.muted = mutedRef.current;
      video.src = target;
      video.load();
      void play();
    };

    const startHls = (target: string, targetMode: Mode) => {
      void (async () => {
        try {
          const mod = await import('hls.js');
          if (cancelled || epoch !== epochRef.current) return;
          const Hls = mod.default as unknown as HlsCtor;
          if (!Hls.isSupported()) {
            setLoading(false);
            setError('مرورگر فعلی HLS را پشتیبانی نمی‌کند.');
            return;
          }
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 30,
            maxBufferLength: 45,
            maxMaxBufferLength: 90,
            liveSyncDurationCount: 4,
            liveMaxLatencyDurationCount: 12,
            maxLiveSyncPlaybackRate: 1.15,
            manifestLoadingMaxRetry: 2,
            levelLoadingMaxRetry: 3,
            fragLoadingMaxRetry: 3,
            manifestLoadingTimeOut: 12000,
            levelLoadingTimeOut: 12000,
            fragLoadingTimeOut: 15000,
            capLevelToPlayerSize: true,
            startLevel: -1,
            maxBufferHole: 0.8,
          });
          localHls = hls;
          hlsRef.current = hls;
          activeMode = targetMode;
          modeRef.current = targetMode;
          setMode(targetMode);
          const activeSession = sessionRef.current;
          if (activeSession) sessionRef.current = { ...activeSession, userId: localUserIdRef.current || activeSession.userId, sourceUrl: source.url, mode: targetMode, updatedAt: Date.now() };
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled || epoch !== epochRef.current || hlsRef.current !== hls) return;
            const mapped = hls.levels.map((level, index) => ({
              index,
              label: level.height ? `${level.height}p` : level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : `Level ${index + 1}`,
            }));
            setLevels(mapped.filter((item, index, all) => all.findIndex((v) => v.label === item.label) === index));
            const bitrate = hls.levels[hls.currentLevel]?.bitrate || hls.levels[0]?.bitrate || 0;
            setMetrics((prev) => ({ ...prev, bitrateKbps: Math.round(bitrate / 1000) }));
            setLoading(false);
            video.volume = volumeRef.current;
            video.muted = mutedRef.current;
            void play();
          });
          hls.on(Hls.Events.LEVEL_SWITCHED, () => {
            const bitrate = hls.levels[hls.currentLevel]?.bitrate || hls.levels[0]?.bitrate || 0;
            if (bitrate > 0) setMetrics((prev) => ({ ...prev, bitrateKbps: Math.round(bitrate / 1000) }));
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (cancelled || epoch !== epochRef.current || hlsRef.current !== hls || !data?.fatal) return;
            if (targetMode === 'proxy' && data.type === 'mediaError') {
              try { hls.recoverMediaError(); return; } catch {}
            }
            if (targetMode === 'proxy' && data.type === 'networkError') {
              failover('خطای شبکه در پراکسی.');
              return;
            }
            if (targetMode === 'direct' && data.type === 'mediaError') {
              try { hls.recoverMediaError(); return; } catch {}
            }
            failover(targetMode === 'direct' ? 'خطای HLS مستقیم.' : 'خطای HLS پراکسی.');
          });
          hls.loadSource(target);
          hls.attachMedia(video);
        } catch {
          failover(targetMode === 'proxy' ? 'راه‌اندازی پراکسی ناموفق بود.' : 'راه‌اندازی مستقیم ناموفق بود.');
        }
      })();
    };

    if (isNative(direct)) {
      setMode('direct');
      modeRef.current = 'direct';
      startNative(direct);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      setMode('direct');
      modeRef.current = 'direct';
      startNative(direct);
    } else {
      startHls(proxied, 'proxy');
      directWatchdogRef.current = setTimeout(() => {
        if (!cancelled && epoch === epochRef.current && activeMode === 'proxy' && !playingRef.current) failover('پراکسی در زمان مناسب پاسخ نداد.');
      }, 9000);
    }

    return () => {
      cancelled = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (directWatchdogRef.current) clearTimeout(directWatchdogRef.current);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('error', onVideoError);
      destroy();
      void persistSession(true);
    };
  }, [channel.id, channel.name, channel.origin, channel.referer, channel.url, chooseSource, destroy, persistSession, play, sourceIndex, sources]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) { video.volume = volume; video.muted = muted; }
  }, [volume, muted]);

  useEffect(() => {
    const startedAt = Date.now();
    sampleTimerRef.current = setInterval(() => {
      const durationSec = Math.max(0, (Date.now() - startedAt) / 1000);
      const observedBytes = sampleBytes();
      setMetrics((prev) => {
        const bitrateBytesPerSec = prev.bitrateKbps > 0 ? prev.bitrateKbps * 1000 / 8 : 0;
        const estimatedBytes = bitrateBytesPerSec * durationSec;
        const bytes = observedBytes > 0 ? Math.max(prev.bytes, observedBytes) : estimatedBytes;
        return {
          durationSec,
          bytes,
          estimated: observedBytes <= 0,
          bitrateKbps: prev.bitrateKbps,
          hourlyBytes: durationSec > 2 ? bytes / durationSec * 3600 : 0,
          sessionTotalBytes: bytes + historyBytes,
        };
      });
      void persistSession(false);
    }, 2000);
    return () => { if (sampleTimerRef.current) clearInterval(sampleTimerRef.current); };
  }, [historyBytes, persistSession, sampleBytes]);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInput || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === ' ') { event.preventDefault(); if (videoRef.current?.paused) void play(); else videoRef.current?.pause(); }
      if (event.key.toLowerCase() === 'm') setMuted((value) => !value);
      if (event.key.toLowerCase() === 'f') void toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play, toggleFullscreen]);

  const current = sources[sourceIndex] ?? sources[0];
  const dataRate = metrics.bitrateKbps > 0 ? `${metrics.bitrateKbps} kbps` : 'Auto';
  const liveUsage = metrics.estimated ? `≈ ${formatBytes(metrics.bytes)}` : formatBytes(metrics.bytes);
  const hourly = metrics.hourlyBytes > 0 ? formatBytes(metrics.hourlyBytes) : '—';
  const sourceLabel = current?.title || `منبع ${sourceIndex + 1}`;

  return (
    <div className="player-pro-shell">
      <div ref={rootRef} className={`pro-player pro-player-pro${fullscreen ? ' is-fullscreen' : ''}`} tabIndex={0}>
        <video
          ref={videoRef}
          className="pro-player-video"
          poster={channel.image || undefined}
          playsInline
          preload="auto"
          muted={muted}
          onClick={() => { if (videoRef.current?.paused) void play(); else videoRef.current?.pause(); }}
          onDoubleClick={() => void toggleFullscreen()}
        />

        <div className="player-pro-vignette" />
        {loading && !error && <div className="pro-player-loader pro-player-loader-pro"><span className="spinner" /><span>{mode === 'proxy' ? 'در حال اتصال به پخش…' : 'در حال اتصال مستقیم…'}</span></div>}
        {error && <div className="pro-player-error"><div><div className="pro-player-error-title">پخش متوقف شد</div><div className="muted">{error}</div><button className="pro-player-retry" onClick={() => chooseSource(sourceIndex)}><RotateCcw size={15} /> تلاش مجدد</button></div></div>}

        <div className="player-pro-topbar">
          <div className="player-pro-brand"><Radio size={15} /><span>LIVE</span></div>
          <div className="player-pro-name">{channel.name || 'MOMSAT'}</div>
          <div className="player-pro-status"><span className={`status-dot ${playing ? 'on' : ''}`} />{mode === 'proxy' ? 'PROXY' : 'DIRECT'}</div>
          {sources.length > 1 && <button className="player-pro-icon" onClick={() => setShowSources((value) => !value)} title="منابع"><Settings2 size={18} /></button>}
        </div>

        {showSources && sources.length > 1 && <div className="player-pro-menu source-menu-pro"><div className="player-pro-menu-title">منبع پخش</div>{sources.map((item, index) => <button key={`${item.url}-${index}`} className={index === sourceIndex ? 'selected' : ''} onClick={() => { chooseSource(index); setShowSources(false); }}><span>{item.title || `منبع ${index + 1}`}</span><small>{item.country || (index === 0 ? 'Primary' : '')}</small>{index === sourceIndex && <Check size={15} />}</button>)}</div>}
        {showQuality && levels.length > 0 && <div className="player-pro-menu quality-menu-pro"><div className="player-pro-menu-title">کیفیت</div><button className={quality === -1 ? 'selected' : ''} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel = -1; setQuality(-1); setShowQuality(false); }}>Auto</button>{levels.map((level) => <button key={level.index} className={quality === level.index ? 'selected' : ''} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel = level.index; setQuality(level.index); setShowQuality(false); }}>{level.label}{quality === level.index && <Check size={15} />}</button>)}</div>}

        <div className="player-pro-center-control">{loading ? <Activity size={28} className="pulse-icon" /> : !playing ? <button className="player-pro-bigplay" onClick={() => void play()}><Play size={30} fill="currentColor" /></button> : null}</div>

        <div className="player-pro-bottombar">
          <div className="player-pro-main-controls">
            <button className="player-pro-icon player-pro-icon-lg" onClick={() => { if (videoRef.current?.paused) void play(); else videoRef.current?.pause(); }} title={playing ? 'توقف' : 'پخش'}>{playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}</button>
            <button className="player-pro-icon" onClick={() => setMuted((value) => !value)} title={muted ? 'صدا' : 'بی‌صدا'}>{muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
            <input className="player-pro-volume" type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); setMuted(next === 0); }} aria-label="Volume" />
          </div>
          <div className="player-pro-live-readout"><span className="pulse-line" /> LIVE</div>
          <div className="player-pro-spacer" />
          <button className="player-pro-chip" onClick={() => setShowUsage((value) => !value)} title="مصرف اینترنت"><HardDriveDownload size={16} /><span>{liveUsage}</span></button>
          {levels.length > 0 && <button className="player-pro-chip" onClick={() => setShowQuality((value) => !value)}><Gauge size={16} /><span>{quality === -1 ? dataRate : levels.find((level) => level.index === quality)?.label || dataRate}</span><ChevronDown size={14} /></button>}
          <button className="player-pro-icon" onClick={async () => { const video = videoRef.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }; if (video.requestPictureInPicture) { try { await video.requestPictureInPicture(); } catch {} } }} title="Picture in Picture"><PictureInPicture2 size={18} /></button>
          <button className="player-pro-icon" onClick={() => void toggleFullscreen()} title={fullscreen ? 'خروج' : 'تمام صفحه'}><Maximize2 size={18} /></button>
        </div>

        {showUsage && <div className="player-pro-usage-popover">
          <div className="usage-head"><div><strong>مصرف اینترنت</strong><span>ذخیره‌شده برای کاربر محلی همین مرورگر</span></div><Wifi size={18} /></div>
          <div className="usage-grid">
            <div><span><Clock3 size={14} /> این جلسه</span><strong>{formatDuration(metrics.durationSec)}</strong></div>
            <div><span><HardDriveDownload size={14} /> این جلسه</span><strong>{liveUsage}</strong></div>
            <div><span><Gauge size={14} /> نرخ تقریبی</span><strong>{dataRate}</strong></div>
            <div><span><Activity size={14} /> برای ۱ ساعت</span><strong>{hourly}</strong></div>
          </div>
          <div className="usage-total"><span>مجموع ذخیره‌شده کاربر</span><strong>{formatBytes(metrics.sessionTotalBytes)}</strong></div>
          <div className="usage-note">مقدار واقعی از Resource Timing مرورگر خوانده می‌شود؛ برای مسیر مستقیم در صورت محدودیت مرورگر، مقدار تقریبی بر اساس bitrate نمایش داده می‌شود.</div>
        </div>}
      </div>

      <div className="player-pro-metricsbar">
        <div className="player-pro-metric"><HardDriveDownload size={15} /><span>مصرف این جلسه</span><strong>{liveUsage}{metrics.estimated ? ' تقریبی' : ''}</strong></div>
        <div className="player-pro-metric"><Clock3 size={15} /><span>مدت</span><strong>{formatDuration(metrics.durationSec)}</strong></div>
        <div className="player-pro-metric"><Gauge size={15} /><span>مصرف ساعتی</span><strong>{hourly}/h</strong></div>
        <div className="player-pro-metric"><Wifi size={15} /><span>اتصال</span><strong>{mode === 'proxy' ? 'Proxy' : 'Direct'}</strong></div>
        <div className="player-pro-metric player-pro-metric-source"><span>منبع</span><strong>{sourceLabel}</strong></div>
      </div>
    </div>
  );
}
