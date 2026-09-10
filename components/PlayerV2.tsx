'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, Settings, Volume2, VolumeX } from 'lucide-react';

type Source = { id?: number | null; url: string; title?: string | null; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean };
type Channel = { name?: string; image?: string | null; url?: string | null; referer?: string | null; origin?: string | null; sources?: Source[] };
type HlsInstance = { destroy: () => void; loadSource: (url: string) => void; attachMedia: (media: HTMLVideoElement) => void; startLoad: (startPosition?: number) => void; recoverMediaError: () => void; currentLevel: number; levels: Array<{ height?: number; bitrate?: number }>; on: (event: string, fn: (event: unknown, data: any) => void) => void };
type HlsCtor = { new (config?: Record<string, unknown>): HlsInstance; isSupported: () => boolean; Events: Record<string, string> };

function usable(url: string) { return /^https?:\/\//i.test(url.trim()); }
function proxied(source: Source) {
  const qs = new URLSearchParams({ url: source.url.trim() });
  if (source.referer) qs.set('referer', source.referer);
  if (source.origin) qs.set('origin', source.origin);
  return `/api/stream?${qs.toString()}`;
}
function score(source: Source, index: number) {
  const u = source.url.toLowerCase();
  let value = 0;
  if (/\.m3u8(?:$|[?#])/.test(u)) value += 100;
  if (u.includes('playlist') || u.includes('stream')) value += 10;
  if (!source.vip) value += 2;
  return value - index / 1000;
}

export default function PlayerV2({ channel }: { channel: Channel }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsInstance | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const networkRetryRef = useRef(0);
  const mediaRecoveryRef = useRef(false);
  const playingRef = useRef(false);
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
  const [controlsVisible, setControlsVisible] = useState(true);

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const sources = useMemo(() => {
    const raw: Source[] = [];
    if (channel.url && usable(channel.url)) raw.push({ url: channel.url, title: 'Primary', referer: channel.referer, origin: channel.origin });
    raw.push(...(channel.sources ?? []).filter((source) => usable(source.url)));
    const unique = Array.from(new Map(raw.map((source) => [source.url.trim(), source])).values());
    return unique.sort((a, b) => score(b, unique.indexOf(b)) - score(a, unique.indexOf(a)));
  }, [channel.url, channel.referer, channel.origin, channel.sources]);

  const sourceSignature = useMemo(
    () => sources.map((source) => `${source.url.trim()}|${source.referer ?? ''}|${source.origin ?? ''}`).join('\n'),
    [sources],
  );

  const clearTimers = useCallback(() => {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    if (hideControlsTimerRef.current) { clearTimeout(hideControlsTimerRef.current); hideControlsTimerRef.current = null; }
  }, []);

  const destroy = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  const revealControls = useCallback((autoHide = true) => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    if (autoHide && playingRef.current) hideControlsTimerRef.current = setTimeout(() => setControlsVisible(false), 3200);
  }, []);

  const selectSource = useCallback((index: number) => {
    if (!sources.length) return;
    const next = Math.max(0, Math.min(index, sources.length - 1));
    setSourceIndex(next);
    setError('');
    setLoading(true);
    setPlaying(false);
    setLevels([]);
    setQuality(-1);
    networkRetryRef.current = 0;
    mediaRecoveryRef.current = false;
    revealControls(false);
  }, [revealControls, sources.length]);

  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setPlaying(true);
      revealControls(true);
    } catch {
      setControlsVisible(true);
    }
  }, [revealControls]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sources.length) {
      setLoading(false);
      if (!sources.length) setError('برای این شبکه هیچ URL پخش معتبری ثبت نشده است.');
      return;
    }

    let cancelled = false;
    let localHls: HlsInstance | null = null;
    clearTimers();
    destroy();
    networkRetryRef.current = 0;
    mediaRecoveryRef.current = false;

    const source = sources[sourceIndex] ?? sources[0];
    const url = proxied(source);
    const applyState = () => {
      video.volume = volumeRef.current;
      video.muted = mutedRef.current;
    };

    const failover = (message: string) => {
      if (cancelled) return;
      if (sourceIndex + 1 < sources.length) {
        setError(`${message} مسیر بعدی امتحان می‌شود…`);
        retryTimerRef.current = setTimeout(() => { if (!cancelled) selectSource(sourceIndex + 1); }, 1200);
      } else {
        setLoading(false);
        setError(`${message} هیچ مسیر دیگری برای پخش باقی نمانده است.`);
        setControlsVisible(true);
      }
    };

    const onPlaying = () => {
      if (!cancelled) { setLoading(false); setPlaying(true); revealControls(true); }
    };
    const onPause = () => {
      if (!cancelled && !video.ended) { setPlaying(false); setControlsVisible(true); }
    };
    const onWaiting = () => {
      if (!cancelled && !video.paused) setLoading(true);
    };
    const onLoadedMetadata = () => {
      if (cancelled) return;
      applyState();
      setLoading(false);
      void play();
    };
    const onVideoError = () => failover('خطای ویدئو در منبع فعلی.');

    // Reset before attaching failure listeners so the initial empty-src load is never treated as a stream failure.
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('error', onVideoError);

    (async () => {
      try {
        const mod = await import('hls.js');
        if (cancelled) return;
        const Hls = mod.default as unknown as HlsCtor;

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          applyState();
          video.src = url;
          video.load();
          return;
        }

        if (!Hls.isSupported()) {
          setLoading(false);
          setError('مرورگر فعلی پخش HLS را پشتیبانی نمی‌کند.');
          return;
        }

        const hls = new Hls({
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
          manifestLoadingTimeOut: 20000,
          levelLoadingTimeOut: 20000,
          capLevelToPlayerSize: false,
          startLevel: -1,
          nudgeOffset: 0.2,
          nudgeMaxRetry: 5,
          maxBufferHole: 0.8,
        });
        localHls = hls;
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled || hlsRef.current !== hls) return;
          const nextLevels = hls.levels.map((level, index) => ({
            index,
            label: level.height ? `${level.height}p` : level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : `Level ${index + 1}`,
          }));
          setLevels(nextLevels.filter((level, index, all) => all.findIndex((item) => item.label === level.label) === index));
          applyState();
          setLoading(false);
          void play();
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (cancelled || hlsRef.current !== hls || !data?.fatal) return;
          if (data.type === 'mediaError' && !mediaRecoveryRef.current) {
            mediaRecoveryRef.current = true;
            hls.recoverMediaError();
            return;
          }
          if (data.type === 'networkError' && networkRetryRef.current < 4) {
            networkRetryRef.current += 1;
            setError(`اتصال ناپایدار است؛ تلاش مجدد ${networkRetryRef.current} از 4…`);
            hls.startLoad(-1);
            return;
          }
          failover(data.type === 'networkError' ? 'خطای شبکه در منبع فعلی.' : 'خطای HLS در منبع فعلی.');
        });

        applyState();
        hls.loadSource(url);
        hls.attachMedia(video);
      } catch {
        if (!cancelled) failover('راه‌اندازی HLS ناموفق بود.');
      }
    })();

    return () => {
      cancelled = true;
      clearTimers();
      localHls?.destroy();
      if (hlsRef.current === localHls) hlsRef.current = null;
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onVideoError);
    };
  }, [sourceSignature, sourceIndex, clearTimers, destroy, play, selectSource, sources]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) { video.volume = volume; video.muted = muted; }
  }, [volume, muted]);

  useEffect(() => {
    const fn = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', fn);
    return () => document.removeEventListener('fullscreenchange', fn);
  }, []);

  useEffect(() => {
    revealControls(true);
    return clearTimers;
  }, [clearTimers, playing, revealControls]);

  const toggleFullscreen = useCallback(async () => {
    if (!rootRef.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current.requestFullscreen();
    } catch {}
  }, []);

  const togglePip = useCallback(async () => {
    const video = videoRef.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> };
    if (!video.requestPictureInPicture) return;
    try { await video.requestPictureInPicture(); } catch {}
  }, []);

  const resetToCurrentSource = useCallback(() => selectSource(sourceIndex), [selectSource, sourceIndex]);
  const currentSource = sources[sourceIndex] ?? sources[0];

  return (
    <div
      ref={rootRef}
      className={`pro-player${controlsVisible ? ' controls-visible' : ''}`}
      tabIndex={0}
      onMouseMove={() => revealControls(true)}
      onMouseEnter={() => revealControls(false)}
      onTouchStart={() => revealControls(true)}
      onKeyDown={(event) => {
        if (event.key === ' ') { event.preventDefault(); togglePlay(); }
        if (event.key.toLowerCase() === 'f') void toggleFullscreen();
        if (event.key.toLowerCase() === 'm') setMuted((value) => !value);
      }}
    >
      <video
        ref={videoRef}
        className="pro-player-video"
        poster={channel.image || undefined}
        playsInline
        preload="auto"
        muted={muted}
        onClick={togglePlay}
        onDoubleClick={() => void toggleFullscreen()}
      />
      {loading && !error && <div className="pro-player-loader"><span className="spinner" /><span>در حال اتصال به پخش زنده…</span></div>}
      {error && <div className="pro-player-error"><div><div className="pro-player-error-title">پخش متوقف شد</div><div className="muted">{error}</div><button className="pro-player-retry" onClick={resetToCurrentSource}><RotateCcw size={15} /> تلاش مجدد</button></div></div>}

      <div className="pro-player-top">
        <div className="pro-player-live"><span /> LIVE</div>
        <div className="pro-player-channel">{channel.name || 'MOMSAT'}</div>
        {sources.length > 1 && <button className="icon-button" onClick={() => setShowSources((value) => !value)} title="مسیرهای پخش"><Settings size={18} /></button>}
      </div>

      {showSources && sources.length > 1 && <div className="pro-player-menu source-menu"><div className="menu-title">مسیر پخش</div>{sources.map((source, index) => <button key={`${source.url}-${index}`} className={index === sourceIndex ? 'selected' : ''} onClick={() => { selectSource(index); setShowSources(false); }}><span>{source.title || `Source ${index + 1}`}</span>{source.country && <small>{source.country}</small>}</button>)}</div>}
      {showQuality && levels.length > 0 && <div className="pro-player-menu quality-menu"><button className={quality === -1 ? 'selected' : ''} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel = -1; setQuality(-1); setShowQuality(false); }}>Auto</button>{levels.map((level) => <button key={level.index} className={quality === level.index ? 'selected' : ''} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel = level.index; setQuality(level.index); setShowQuality(false); }}>{level.label}</button>)}</div>}

      <div className="pro-player-controls">
        <button className="icon-button large" onClick={togglePlay} title={playing ? 'توقف' : 'پخش'}>{playing ? <Pause size={21} /> : <Play size={21} />}</button>
        <button className="icon-button" onClick={() => setMuted((value) => !value)} title={muted ? 'فعال کردن صدا' : 'بی‌صدا'}>{muted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
        <input className="volume-slider" type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); setMuted(next === 0); }} aria-label="Volume" />
        <div className="pro-player-spacer" />
        {levels.length > 0 && <button className="text-button" onClick={() => { setShowSources(false); setShowQuality((value) => !value); }}>HD</button>}
        <button className="text-button live-text">LIVE</button>
        <button className="icon-button" onClick={() => void togglePip()} title="Picture in Picture"><PictureInPicture2 size={18} /></button>
        <button className="icon-button" onClick={() => void toggleFullscreen()} title="Fullscreen">{fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}</button>
      </div>
    </div>
  );
}
