'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  ChevronDown,
  Clock3,
  Gauge,
  HardDriveDownload,
  Maximize2,
  Pause,
  PictureInPicture2,
  Play,
  Radio,
  RotateCcw,
  Settings2,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import {
  getLocalPlayerStats,
  getLocalPlayerUser,
  saveLocalPlayerSession,
  type LocalPlayerSession,
} from '../lib/local-player-db';

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
  totalBytes: number;
};

const EMPTY_METRICS: Metrics = {
  durationSec: 0,
  bytes: 0,
  estimated: true,
  bitrateKbps: 0,
  hourlyBytes: 0,
  totalBytes: 0,
};

function usable(url: string) {
  return /^https?:\/\//i.test(url.trim());
}

function isM3u8(url: string) {
  return /\.m3u8(?:$|[?#])/i.test(url.trim());
}

function isNative(url: string) {
  return /\.(?:mp4|webm|m4v)(?:$|[?#])/i.test(url.trim());
}

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
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function proxyUrl(source: Source) {
  const params = new URLSearchParams({ url: source.url.trim() });
  if (source.referer) params.set('referer', source.referer);
  if (source.origin) params.set('origin', source.origin);
  return `/api/stream?${params.toString()}`;
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
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metricTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef<LocalPlayerSession | null>(null);
  const userIdRef = useRef('');
  const historyBytesRef = useRef(0);
  const metricsRef = useRef<Metrics>(EMPTY_METRICS);
  const startedAtRef = useRef(0);
  const observedBytesRef = useRef(0);
  const seenResourcesRef = useRef<Set<string>>(new Set());
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
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);

  const sources = useMemo(() => {
    const raw: Source[] = [];
    if (channel.url && usable(channel.url)) {
      raw.push({
        url: channel.url,
        title: 'Primary',
        referer: channel.referer,
        origin: channel.origin,
      });
    }
    raw.push(...(channel.sources ?? []).filter((source) => usable(source.url)));
    const unique = Array.from(new Map(raw.map((source) => [source.url.trim(), source])).values());
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

  const getObservedBytes = useCallback(() => {
    const active = sources[sourceIndex]?.url.trim() || '';
    const activeOrigin = (() => {
      try { return new URL(active).origin; } catch { return ''; }
    })();

    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (const entry of resources) {
      const isProxyRequest = entry.name.includes('/api/stream?');
      const isDirectRequest = Boolean(activeOrigin) && entry.name.startsWith(activeOrigin);
      if (!isProxyRequest && !isDirectRequest) continue;

      const key = `${entry.name}|${entry.startTime}|${entry.responseEnd}`;
      if (seenResourcesRef.current.has(key)) continue;
      seenResourcesRef.current.add(key);

      const bytes = Number(entry.transferSize || entry.encodedBodySize || 0);
      if (bytes > 0) observedBytesRef.current += bytes;
    }

    return observedBytesRef.current;
  }, [sourceIndex, sources]);

  const persistSession = useCallback(async (completed: boolean) => {
    const session = sessionRef.current;
    if (!session) return;

    let userId = userIdRef.current;
    if (!userId) {
      try {
        userId = (await getLocalPlayerUser()).id;
        userIdRef.current = userId;
      } catch {
        return;
      }
    }

    const current = metricsRef.current;
    const next: LocalPlayerSession = {
      ...session,
      userId,
      durationSec: Math.max(0, Math.round((Date.now() - session.startedAt) / 1000)),
      bytes: Math.max(0, current.bytes),
      estimatedBytes: current.estimated,
      bitrateKbps: current.bitrateKbps,
      completed,
      endedAt: completed ? Date.now() : session.endedAt,
      updatedAt: Date.now(),
    };

    sessionRef.current = next;
    try {
      await saveLocalPlayerSession(next);
      if (completed) {
        const stats = await getLocalPlayerStats(userId);
        historyBytesRef.current = stats.totalBytes;
        setMetrics((previous) => {
          const updated = { ...previous, totalBytes: historyBytesRef.current + previous.bytes };
          metricsRef.current = updated;
          return updated;
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    let cancelled = false;
    void getLocalPlayerUser().then(async (user) => {
      if (cancelled) return;
      userIdRef.current = user.id;
      try {
        const stats = await getLocalPlayerStats(user.id);
        if (cancelled) return;
        historyBytesRef.current = stats.totalBytes;
        setMetrics((previous) => {
          const updated = { ...previous, totalBytes: stats.totalBytes + previous.bytes };
          metricsRef.current = updated;
          return updated;
        });
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
    const directUrl = source.url.trim();
    const proxy = proxyUrl(source);

    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    destroy();

    observedBytesRef.current = 0;
    seenResourcesRef.current = new Set();
    startedAtRef.current = Date.now();
    const initialMetrics = { ...EMPTY_METRICS, totalBytes: historyBytesRef.current };
    metricsRef.current = initialMetrics;
    setMetrics(initialMetrics);
    setMode('proxy');
    setLoading(true);
    setPlaying(false);
    setError('');
    setLevels([]);
    setQuality(-1);

    sessionRef.current = {
      id: crypto.randomUUID(),
      userId: userIdRef.current || 'pending',
      channelId: channel.id,
      channelName: channel.name || 'MOMSAT',
      sourceUrl: directUrl,
      mode: 'proxy',
      startedAt: startedAtRef.current,
      durationSec: 0,
      bytes: 0,
      estimatedBytes: true,
      completed: false,
      updatedAt: Date.now(),
    };

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
          setMode(targetMode);
          if (sessionRef.current) {
            sessionRef.current = {
              ...sessionRef.current,
              userId: userIdRef.current || sessionRef.current.userId,
              sourceUrl: directUrl,
              mode: targetMode,
              updatedAt: Date.now(),
            };
          }

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled || epoch !== epochRef.current || hlsRef.current !== hls) return;
            const mapped = hls.levels.map((level, index) => ({
              index,
              label: level.height
                ? `${level.height}p`
                : level.bitrate
                  ? `${Math.round(level.bitrate / 1000)} kbps`
                  : `Level ${index + 1}`,
            }));
            setLevels(mapped.filter((item, index, all) => all.findIndex((value) => value.label === item.label) === index));
            const bitrate = hls.levels[hls.currentLevel]?.bitrate || hls.levels[0]?.bitrate || 0;
            setMetrics((previous) => {
              const updated = { ...previous, bitrateKbps: Math.round(bitrate / 1000) };
              metricsRef.current = updated;
              return updated;
            });
            setLoading(false);
            video.volume = volumeRef.current;
            video.muted = mutedRef.current;
            void play();
          });

          hls.on(Hls.Events.LEVEL_SWITCHED, () => {
            const bitrate = hls.levels[hls.currentLevel]?.bitrate || hls.levels[0]?.bitrate || 0;
            if (bitrate <= 0) return;
            setMetrics((previous) => {
              const updated = { ...previous, bitrateKbps: Math.round(bitrate / 1000) };
              metricsRef.current = updated;
              return updated;
            });
          });

          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (cancelled || epoch !== epochRef.current || hlsRef.current !== hls || !data?.fatal) return;
            if (data.type === 'mediaError') {
              try {
                hls.recoverMediaError();
                return;
              } catch {}
            }

            if (targetMode === 'proxy') {
              activeMode = 'direct';
              setMode('direct');
              setError('پراکسی پاسخ نداد؛ تلاش مستقیم…');
              destroy();
              video.pause();
              video.removeAttribute('src');
              video.load();
              startHls(directUrl, 'direct');
              return;
            }

            if (sourceIndex + 1 < sources.length) {
              setError('این مسیر در دسترس نیست؛ مسیر بعدی…');
              retryTimerRef.current = setTimeout(() => {
                if (!cancelled && epoch === epochRef.current) chooseSource(sourceIndex + 1);
              }, 700);
              return;
            }

            setLoading(false);
            setError('این استریم قابل پخش نیست و مسیر دیگری باقی نمانده است.');
          });

          hls.loadSource(target);
          hls.attachMedia(video);
        } catch {
          if (cancelled || epoch !== epochRef.current) return;
          if (targetMode === 'proxy') {
            activeMode = 'direct';
            setMode('direct');
            setError('راه‌اندازی پراکسی ناموفق بود؛ تلاش مستقیم…');
            startHls(directUrl, 'direct');
          } else {
            setLoading(false);
            setError('راه‌اندازی پخش مستقیم ناموفق بود.');
          }
        }
      })();
    };

    const onPlaying = () => {
      if (cancelled || epoch !== epochRef.current) return;
      setLoading(false);
      setPlaying(true);
      setError('');
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
    };
    const onPause = () => {
      if (!cancelled && epoch === epochRef.current) setPlaying(false);
    };
    const onWaiting = () => {
      if (!cancelled && epoch === epochRef.current && playingRef.current) setLoading(true);
    };
    const onVideoError = () => {
      if (cancelled || epoch !== epochRef.current) return;
      if (activeMode === 'proxy') {
        setMode('direct');
        setError('پراکسی استریم خطا داد؛ تلاش مستقیم…');
        destroy();
        startHls(directUrl, 'direct');
        return;
      }
      if (sourceIndex + 1 < sources.length) {
        retryTimerRef.current = setTimeout(() => {
          if (!cancelled && epoch === epochRef.current) chooseSource(sourceIndex + 1);
        }, 700);
      } else {
        setLoading(false);
        setError('پخش این مسیر با خطا متوقف شد.');
      }
    };

    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('error', onVideoError);
    video.pause();
    video.removeAttribute('src');
    video.load();

    if (isNative(directUrl)) {
      activeMode = 'direct';
      setMode('direct');
      startNative(directUrl);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      activeMode = 'direct';
      setMode('direct');
      startNative(directUrl);
    } else {
      startHls(proxy, 'proxy');
      watchdogRef.current = setTimeout(() => {
        if (!cancelled && epoch === epochRef.current && activeMode === 'proxy' && !playingRef.current) {
          setMode('direct');
          setError('پراکسی در زمان مناسب پاسخ نداد؛ تلاش مستقیم…');
          destroy();
          startHls(directUrl, 'direct');
        }
      }, 9000);
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void persistSession(false);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('error', onVideoError);
      void persistSession(true);
      destroy();
    };
  }, [channel.id, channel.name, chooseSource, destroy, persistSession, play, sourceIndex, sources]);

  useEffect(() => {
    if (metricTimerRef.current) clearInterval(metricTimerRef.current);
    metricTimerRef.current = setInterval(() => {
      const startedAt = startedAtRef.current;
      if (!startedAt) return;
      const durationSec = Math.max(0, (Date.now() - startedAt) / 1000);
      const observed = getObservedBytes();
      const previous = metricsRef.current;
      const estimatedBytes = previous.bitrateKbps > 0
        ? previous.bitrateKbps * 1000 / 8 * durationSec
        : 0;
      const bytes = observed > 0 ? Math.max(previous.bytes, observed) : estimatedBytes;
      const next: Metrics = {
        ...previous,
        durationSec,
        bytes,
        estimated: observed <= 0,
        hourlyBytes: durationSec > 2 ? bytes / durationSec * 3600 : 0,
        totalBytes: historyBytesRef.current + bytes,
      };
      metricsRef.current = next;
      setMetrics(next);
    }, 1000);
    return () => {
      if (metricTimerRef.current) clearInterval(metricTimerRef.current);
    };
  }, [getObservedBytes]);

  useEffect(() => {
    if (persistTimerRef.current) clearInterval(persistTimerRef.current);
    persistTimerRef.current = setInterval(() => { void persistSession(false); }, 10000);
    return () => {
      if (persistTimerRef.current) clearInterval(persistTimerRef.current);
    };
  }, [persistSession]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = muted;
    }
  }, [volume, muted]);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInput || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === ' ') {
        event.preventDefault();
        if (videoRef.current?.paused) void play();
        else videoRef.current?.pause();
      } else if (event.key.toLowerCase() === 'm') {
        setMuted((value) => !value);
      } else if (event.key.toLowerCase() === 'f') {
        void toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play, toggleFullscreen]);

  const current = sources[sourceIndex] ?? sources[0];
  const rate = metrics.bitrateKbps > 0 ? `${metrics.bitrateKbps} kbps` : 'Auto';
  const usage = formatBytes(metrics.bytes);
  const hourly = metrics.hourlyBytes > 0 ? formatBytes(metrics.hourlyBytes) : '—';
  const totalUsage = formatBytes(metrics.totalBytes);

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

        {loading && !error && (
          <div className="pro-player-loader pro-player-loader-pro">
            <span className="spinner" />
            <span>{mode === 'proxy' ? 'در حال اتصال به پخش…' : 'در حال اتصال مستقیم…'}</span>
          </div>
        )}

        {error && (
          <div className="pro-player-error">
            <div>
              <div className="pro-player-error-title">پخش متوقف شد</div>
              <div className="muted">{error}</div>
              <button className="pro-player-retry" onClick={() => chooseSource(sourceIndex)}>
                <RotateCcw size={15} /> تلاش مجدد
              </button>
            </div>
          </div>
        )}

        <div className="player-pro-topbar">
          <div className="player-pro-brand"><Radio size={15} /><span>LIVE</span></div>
          <div className="player-pro-name">{channel.name || 'MOMSAT'}</div>
          <div className="player-pro-status">
            <span className={`status-dot ${playing ? 'on' : ''}`} />
            {mode === 'proxy' ? 'PROXY' : 'DIRECT'}
          </div>
          {sources.length > 1 && (
            <button className="player-pro-icon" onClick={() => setShowSources((value) => !value)} title="منابع">
              <Settings2 size={18} />
            </button>
          )}
        </div>

        {showSources && sources.length > 1 && (
          <div className="player-pro-menu source-menu-pro">
            <div className="player-pro-menu-title">منبع پخش</div>
            {sources.map((item, index) => (
              <button
                key={`${item.url}-${index}`}
                className={index === sourceIndex ? 'selected' : ''}
                onClick={() => { chooseSource(index); setShowSources(false); }}
              >
                <span>{item.title || `منبع ${index + 1}`}</span>
                <small>{item.country || ''}</small>
                {index === sourceIndex && <Check size={15} />}
              </button>
            ))}
          </div>
        )}

        {showQuality && levels.length > 0 && (
          <div className="player-pro-menu quality-menu-pro">
            <div className="player-pro-menu-title">کیفیت</div>
            <button className={quality === -1 ? 'selected' : ''} onClick={() => {
              if (hlsRef.current) hlsRef.current.currentLevel = -1;
              setQuality(-1);
              setShowQuality(false);
            }}>Auto</button>
            {levels.map((level) => (
              <button key={level.index} className={quality === level.index ? 'selected' : ''} onClick={() => {
                if (hlsRef.current) hlsRef.current.currentLevel = level.index;
                setQuality(level.index);
                setShowQuality(false);
              }}>
                <span>{level.label}</span>
                {quality === level.index && <Check size={15} />}
              </button>
            ))}
          </div>
        )}

        {!playing && !loading && !error && (
          <div className="player-pro-center-control">
            <button className="player-pro-bigplay" onClick={() => void play()}>
              <Play size={30} fill="currentColor" />
            </button>
          </div>
        )}

        <div className="player-pro-bottombar">
          <div className="player-pro-main-controls">
            <button className="player-pro-icon player-pro-icon-lg" onClick={() => {
              if (videoRef.current?.paused) void play();
              else videoRef.current?.pause();
            }} title={playing ? 'توقف' : 'پخش'}>
              {playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
            </button>
            <button className="player-pro-icon" onClick={() => setMuted((value) => !value)} title={muted ? 'صدا' : 'بی‌صدا'}>
              {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              className="player-pro-volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={muted ? 0 : volume}
              onChange={(event) => {
                const next = Number(event.target.value);
                setVolume(next);
                setMuted(next === 0);
              }}
              aria-label="Volume"
            />
          </div>

          <div className="player-pro-live-readout"><span className="pulse-line" /> LIVE</div>
          <div className="player-pro-spacer" />

          <button className="player-pro-chip" onClick={() => setShowUsage((value) => !value)} title="مصرف اینترنت">
            <HardDriveDownload size={16} />
            <span>{usage}</span>
          </button>

          {levels.length > 0 && (
            <button className="player-pro-chip" onClick={() => setShowQuality((value) => !value)} title="کیفیت">
              <Gauge size={16} />
              <span>{quality === -1 ? rate : levels.find((level) => level.index === quality)?.label || rate}</span>
              <ChevronDown size={14} />
            </button>
          )}

          <button className="player-pro-icon" onClick={async () => {
            const video = videoRef.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> };
            if (!video.requestPictureInPicture) return;
            try { await video.requestPictureInPicture(); } catch {}
          }} title="Picture in Picture">
            <PictureInPicture2 size={18} />
          </button>

          <button className="player-pro-icon" onClick={() => void toggleFullscreen()} title={fullscreen ? 'خروج' : 'تمام صفحه'}>
            <Maximize2 size={18} />
          </button>
        </div>

        {showUsage && (
          <div className="player-pro-usage-popover">
            <div className="usage-head">
              <div>
                <strong>مصرف اینترنت</strong>
                <span>ذخیره‌شده فقط برای کاربر محلی همین مرورگر</span>
              </div>
              <Wifi size={18} />
            </div>
            <div className="usage-grid">
              <div><span><Clock3 size={14} /> این جلسه</span><strong>{formatDuration(metrics.durationSec)}</strong></div>
              <div><span><HardDriveDownload size={14} /> حجم این جلسه</span><strong>{usage}</strong></div>
              <div><span><Gauge size={14} /> نرخ استریم</span><strong>{rate}</strong></div>
              <div><span><Activity size={14} /> مصرف در ۱ ساعت</span><strong>{hourly}</strong></div>
            </div>
            <div className="usage-total"><span>مجموع مصرف ذخیره‌شده کاربر</span><strong>{totalUsage}</strong></div>
            <div className="usage-note">برای Proxy مقدار واقعی درخواست‌های ثبت‌شده در Resource Timing استفاده می‌شود. در صورت نبودن دادهٔ timing، حجم بر اساس bitrate برآورد می‌شود و با علامت تقریبی نمایش داده می‌شود.</div>
          </div>
        )}
      </div>

      <div className="player-pro-metricsbar">
        <div className="player-pro-metric">
          <HardDriveDownload size={15} />
          <span>مصرف این جلسه</span>
          <strong>{usage}{metrics.estimated ? ' تقریبی' : ''}</strong>
        </div>
        <div className="player-pro-metric">
          <Gauge size={15} />
          <span>نرخ استریم</span>
          <strong>{rate}</strong>
        </div>
        <div className="player-pro-metric">
          <Clock3 size={15} />
          <span>مدت پخش</span>
          <strong>{formatDuration(metrics.durationSec)}</strong>
        </div>
        <div className="player-pro-metric">
          <Wifi size={15} />
          <span>مصرف ساعتی</span>
          <strong>{hourly}/h</strong>
        </div>
        <div className="player-pro-metric player-pro-metric-source">
          <Radio size={15} />
          <span>مسیر</span>
          <strong>{mode === 'proxy' ? 'Proxy' : 'Direct'} · {current?.title || 'Primary'}</strong>
        </div>
      </div>
    </div>
  );
}
