'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Pause, PictureInPicture2, Play, RotateCcw, Settings, Volume2, VolumeX } from 'lucide-react';

type Source = { id?: number | null; url: string; title?: string | null; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean };
type Channel = { name?: string; image?: string | null; url?: string | null; referer?: string | null; origin?: string | null; sources?: Source[] };
type HlsLike = { destroy: () => void; loadSource: (url: string) => void; attachMedia: (media: HTMLVideoElement) => void; startLoad: (startPosition?: number) => void; recoverMediaError: () => void; currentLevel: number; levels: Array<{ height?: number; bitrate?: number }>; on: (event: string, fn: (event: unknown, data: any) => void) => void };
type HlsCtor = { new (config?: Record<string, unknown>): HlsLike; isSupported: () => boolean; Events: Record<string, string> };

function usable(url: string) { return /^https?:\/\//i.test(url.trim()); }
function proxied(source: Source) {
  const qs = new URLSearchParams({ url: source.url.trim() });
  if (source.referer) qs.set('referer', source.referer);
  if (source.origin) qs.set('origin', source.origin);
  return `/api/stream?${qs.toString()}`;
}
function rank(source: Source, index: number) {
  const u = source.url.toLowerCase();
  let score = 0;
  if (/\.m3u8(?:$|[?#])/.test(u)) score += 100;
  if (u.includes('playlist') || u.includes('stream')) score += 10;
  if (!source.vip) score += 2;
  return score - index / 10000;
}

export default function PlayerV3({ channel }: { channel: Channel }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsLike | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const networkRetryRef = useRef(0);
  const mediaRecoveryRef = useRef(0);
  const playingRef = useRef(false);
  const sourceEpochRef = useRef(0);
  const volumeRef = useRef(0.85);
  const mutedRef = useRef(true);

  const [sourceIndex, setSourceIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(true);
  const [levels, setLevels] = useState<Array<{ index: number; label: string }>>([]);
  const [quality, setQuality] = useState(-1);
  const [showSources, setShowSources] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const sources = useMemo(() => {
    const raw: Source[] = [];
    if (channel.url && usable(channel.url)) raw.push({ url: channel.url, title: 'Primary', referer: channel.referer, origin: channel.origin });
    raw.push(...(channel.sources ?? []).filter((s) => usable(s.url)));
    const unique = Array.from(new Map(raw.map((s) => [s.url.trim(), s])).values());
    return unique.sort((a, b) => rank(b, unique.indexOf(b)) - rank(a, unique.indexOf(a)));
  }, [channel.url, channel.referer, channel.origin, channel.sources]);

  const sourceSignature = useMemo(() => sources.map((s) => `${s.url}|${s.referer ?? ''}|${s.origin ?? ''}`).join('\n'), [sources]);

  const destroy = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  const chooseSource = useCallback((index: number) => {
    if (!sources.length) return;
    const next = Math.max(0, Math.min(index, sources.length - 1));
    setSourceIndex(next);
    setError('');
    setLoading(true);
    setPlaying(false);
    setLevels([]);
    setQuality(-1);
    networkRetryRef.current = 0;
    mediaRecoveryRef.current = 0;
  }, [sources.length]);

  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setPlaying(true);
    } catch {
      // Autoplay may be blocked; the controls remain available.
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sources.length) {
      setLoading(false);
      if (!sources.length) setError('برای این شبکه هیچ URL پخش معتبری ثبت نشده است.');
      return;
    }

    const epoch = ++sourceEpochRef.current;
    let cancelled = false;
    let localHls: HlsLike | null = null;
    const source = sources[Math.min(sourceIndex, sources.length - 1)];
    const url = proxied(source);

    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    destroy();
    networkRetryRef.current = 0;
    mediaRecoveryRef.current = 0;
    setLoading(true);
    setError('');
    setLevels([]);
    setQuality(-1);
    setPlaying(false);

    const applyState = () => {
      video.volume = volumeRef.current;
      video.muted = mutedRef.current;
    };

    const failover = (message: string) => {
      if (cancelled || epoch !== sourceEpochRef.current) return;
      if (sourceIndex + 1 < sources.length) {
        setError(`${message} مسیر بعدی امتحان می‌شود…`);
        retryTimerRef.current = setTimeout(() => {
          if (!cancelled && epoch === sourceEpochRef.current) chooseSource(sourceIndex + 1);
        }, 1200);
      } else {
        setLoading(false);
        setError(`${message} هیچ مسیر دیگری برای پخش باقی نمانده است.`);
      }
    };

    const onPlaying = () => {
      if (!cancelled && epoch === sourceEpochRef.current) {
        setLoading(false);
        setPlaying(true);
      }
    };
    const onPause = () => {
      if (!cancelled && epoch === sourceEpochRef.current) setPlaying(false);
    };
    const onWaiting = () => {
      if (!cancelled && epoch === sourceEpochRef.current && playingRef.current) setLoading(true);
    };
    const onVideoError = () => failover('خطای ویدئو در منبع فعلی.');

    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('error', onVideoError);
    video.pause();
    video.removeAttribute('src');
    video.load();

    (async () => {
      try {
        const mod = await import('hls.js');
        if (cancelled || epoch !== sourceEpochRef.current) return;
        const Hls = mod.default as unknown as HlsCtor;
        const applyAndPlay = () => { if (!cancelled && epoch === sourceEpochRef.current) { applyState(); void play(); } };

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url;
          video.load();
          return;
        }
        if (!Hls.isSupported()) {
          setLoading(false);
          setError('مرورگر فعلی پخش HLS را پشتیبانی نمی‌کند.');
          return;
        }

        localHls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30,
          maxBufferLength: 45,
          maxMaxBufferLength: 120,
          liveSyncDurationCount: 4,
          liveMaxLatencyDurationCount: 12,
          maxLiveSyncPlaybackRate: 1.2,
          manifestLoadingMaxRetry: 4,
          levelLoadingMaxRetry: 6,
          fragLoadingMaxRetry: 6,
          fragLoadingTimeOut: 20000,
          fragLoadingMaxRetryTimeout: 64000,
          manifestLoadingTimeOut: 20000,
          levelLoadingTimeOut: 20000,
          capLevelToPlayerSize: false,
          startLevel: -1,
          nudgeOffset: 0.2,
          nudgeMaxRetry: 5,
          maxBufferHole: 0.8,
        });
        hlsRef.current = localHls;

        localHls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled || epoch !== sourceEpochRef.current || !localHls) return;
          const mapped = localHls.levels.map((level, index) => ({
            index,
            label: level.height ? `${level.height}p` : level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : `Level ${index + 1}`,
          }));
          setLevels(mapped.filter((x, i, all) => all.findIndex((v) => v.label === x.label) === i));
          setLoading(false);
          applyAndPlay();
        });

        localHls.on(Hls.Events.ERROR, (_event, data) => {
          if (cancelled || epoch !== sourceEpochRef.current || !data?.fatal) return;
          if (data.type === 'mediaError' && mediaRecoveryRef.current < 2) {
            mediaRecoveryRef.current += 1;
            localHls?.recoverMediaError();
            return;
          }
          if (data.type === 'networkError' && networkRetryRef.current < 4) {
            networkRetryRef.current += 1;
            setError(`اتصال ناپایدار است؛ تلاش مجدد ${networkRetryRef.current} از 4…`);
            localHls?.startLoad(-1);
            return;
          }
          failover(data.type === 'networkError' ? 'خطای شبکه در منبع فعلی.' : 'خطای HLS در منبع فعلی.');
        });

        localHls.loadSource(url);
        localHls.attachMedia(video);
      } catch {
        failover('راه‌اندازی HLS ناموفق بود.');
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      localHls?.destroy();
      if (hlsRef.current === localHls) hlsRef.current = null;
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('error', onVideoError);
    };
  }, [sourceSignature, sourceIndex, chooseSource, destroy, play, sources, sources.length]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) { video.volume = volume; video.muted = muted; }
  }, [volume, muted]);

  useEffect(() => () => destroy(), [destroy]);

  const toggleFullscreen = async () => {
    if (!rootRef.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current.requestFullscreen();
    } catch {}
  };

  const image = channel.image || undefined;
  const current = sources[sourceIndex] ?? sources[0];

  return (
    <div ref={rootRef} className="pro-player controls-visible" tabIndex={0}>
      <video ref={videoRef} className="pro-player-video" poster={image} playsInline preload="auto" muted={muted} onClick={() => { if (videoRef.current?.paused) void play(); else videoRef.current?.pause(); }} />
      {loading && !error && <div className="pro-player-loader"><span className="spinner" /><span>در حال اتصال به پخش زنده…</span></div>}
      {error && <div className="pro-player-error"><div><div className="pro-player-error-title">پخش متوقف شد</div><div className="muted">{error}</div><button className="pro-player-retry" onClick={() => chooseSource(sourceIndex)}><RotateCcw size={15} /> تلاش مجدد</button></div></div>}
      <div className="pro-player-top">
        <div className="pro-player-live"><span /> LIVE</div>
        <div className="pro-player-channel">{channel.name || 'MOMSAT'}</div>
        {sources.length > 1 && <button className="icon-button" onClick={() => setShowSources((v) => !v)} title="مسیرهای پخش"><Settings size={18} /></button>}
      </div>
      {showSources && sources.length > 1 && <div className="pro-player-menu source-menu"><div className="menu-title">مسیر پخش</div>{sources.map((source, index) => <button key={`${source.url}-${index}`} className={index === sourceIndex ? 'selected' : ''} onClick={() => { chooseSource(index); setShowSources(false); }}><span>{source.title || `Source ${index + 1}`}</span>{source.country && <small>{source.country}</small>}</button>)}</div>}
      {showQuality && levels.length > 0 && <div className="pro-player-menu quality-menu"><button className={quality === -1 ? 'selected' : ''} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel = -1; setQuality(-1); setShowQuality(false); }}>Auto</button>{levels.map((level) => <button key={level.index} className={quality === level.index ? 'selected' : ''} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel = level.index; setQuality(level.index); setShowQuality(false); }}>{level.label}</button>)}</div>}
      <div className="pro-player-controls">
        <button className="icon-button large" onClick={() => { if (videoRef.current?.paused) void play(); else videoRef.current?.pause(); }} title={playing ? 'توقف' : 'پخش'}>{playing ? <Pause size={21} /> : <Play size={21} />}</button>
        <button className="icon-button" onClick={() => setMuted((v) => !v)} title={muted ? 'فعال کردن صدا' : 'بی‌صدا'}>{muted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
        <input className="volume-slider" type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={(e) => { const v = Number(e.target.value); setVolume(v); setMuted(v === 0); }} aria-label="Volume" />
        <div className="pro-player-spacer" />
        {levels.length > 0 && <button className="text-button" onClick={() => setShowQuality((v) => !v)}>HD</button>}
        <button className="text-button live-text">LIVE</button>
        <button className="icon-button" onClick={async () => { const video = videoRef.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }; if (video.requestPictureInPicture) { try { await video.requestPictureInPicture(); } catch {} } }} title="Picture in Picture"><PictureInPicture2 size={18} /></button>
        <button className="icon-button" onClick={() => void toggleFullscreen()} title="Fullscreen"><Maximize size={19} /></button>
      </div>
    </div>
  );
}
