'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, Settings, Volume2, VolumeX } from 'lucide-react';

type PlayerSource = { url: string; title?: string | null; referer?: string | null; origin?: string | null };
type PlayerChannel = { name?: string; image?: string | null; url?: string | null; referer?: string | null; origin?: string | null; sources?: PlayerSource[] };
type HlsLike = { destroy: () => void; loadSource: (url: string) => void; attachMedia: (media: HTMLMediaElement) => void; startLoad: () => void; recoverMediaError: () => void; currentLevel: number; levels: Array<{ height?: number; bitrate?: number }>; on: (event: string, handler: (event: unknown, data: any) => void) => void };
type HlsModule = { default: { new (config?: Record<string, unknown>): HlsLike; isSupported: () => boolean; Events: Record<string, string> } };

function isUsableUrl(url: string) { return /^https?:\/\//i.test(url.trim()); }
function toProxyUrl(source: PlayerSource) { const params = new URLSearchParams({ url: source.url }); if (source.referer) params.set('referer', source.referer); if (source.origin) params.set('origin', source.origin); return `/api/stream?${params.toString()}`; }

export default function Player({ channel }: { channel: PlayerChannel }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsLike | null>(null);
  const failCountRef = useRef(0);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showSources, setShowSources] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const [quality, setQuality] = useState(-1);
  const [levels, setLevels] = useState<Array<{ index: number; label: string }>>([]);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);

  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const sources = useMemo<PlayerSource[]>(() => {
    const all: PlayerSource[] = [];
    if (channel.url && isUsableUrl(channel.url)) all.push({ url: channel.url, title: 'Primary', referer: channel.referer, origin: channel.origin });
    for (const source of channel.sources ?? []) if (isUsableUrl(source.url)) all.push(source);
    return Array.from(new Map(all.map((source) => [source.url, source])).values());
  }, [channel]);

  const currentSource = sources[sourceIndex] ?? sources[0];
  const proxySource = currentSource ? toProxyUrl(currentSource) : '';
  const destroyHls = useCallback(() => { hlsRef.current?.destroy(); hlsRef.current = null; }, []);
  const activateSource = useCallback((nextIndex: number) => { if (!sources.length) return; const normalized = ((nextIndex % sources.length) + sources.length) % sources.length; setSourceIndex(normalized); setError(''); setLoading(true); failCountRef.current = 0; }, [sources.length]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!proxySource) { setLoading(false); setError('برای این شبکه هیچ مسیر پخشی ثبت نشده است.'); return; }

    let cancelled = false;
    destroyHls();
    setLoading(true); setError(''); setLevels([]); setQuality(-1); setPlaying(false);
    video.pause(); video.removeAttribute('src'); video.load();

    const applyMediaState = () => { video.volume = volumeRef.current; video.muted = mutedRef.current; };
    const failover = () => { if (cancelled) return; if (sources.length > 1 && sourceIndex < sources.length - 1) { setError('مسیر فعلی قابل پخش نیست؛ مسیر بعدی انتخاب می‌شود.'); window.setTimeout(() => { if (!cancelled) activateSource(sourceIndex + 1); }, 500); } else { setLoading(false); setError('پخش این شبکه از مسیرهای موجود ممکن نشد.'); } };
    const onLoaded = () => { if (cancelled) return; applyMediaState(); setLoading(false); video.play().then(() => !cancelled && setPlaying(true)).catch(() => !cancelled && setPlaying(false)); };
    const onWaiting = () => !cancelled && setLoading(true);
    const onPlaying = () => { if (cancelled) return; setLoading(false); setPlaying(true); };
    const onPause = () => !cancelled && setPlaying(false);
    const onVideoError = () => { failCountRef.current += 1; if (failCountRef.current === 1) failover(); };

    video.addEventListener('loadedmetadata', onLoaded); video.addEventListener('canplay', onLoaded); video.addEventListener('waiting', onWaiting); video.addEventListener('playing', onPlaying); video.addEventListener('pause', onPause); video.addEventListener('error', onVideoError);

    const run = async () => {
      try {
        const Hls = (await import('hls.js')) as unknown as HlsModule;
        if (cancelled) return;
        if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = proxySource; video.load(); return; }
        if (!Hls.default.isSupported()) { setLoading(false); setError('مرورگر فعلی از پخش HLS پشتیبانی نمی‌کند.'); return; }

        const hls = new Hls.default({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30, maxBufferLength: 20, maxMaxBufferLength: 60, liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 5, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 3, fragLoadingMaxRetry: 3, capLevelToPlayerSize: true });
        hlsRef.current = hls;
        hls.on(Hls.default.Events.MANIFEST_PARSED, () => { if (cancelled) return; setLevels(hls.levels.map((level, index) => ({ index, label: level.height ? `${level.height}p` : `${Math.round((level.bitrate ?? 0) / 1000)} kbps` }))); applyMediaState(); setLoading(false); video.play().then(() => !cancelled && setPlaying(true)).catch(() => !cancelled && setPlaying(false)); });
        hls.on(Hls.default.Events.ERROR, (_event, data) => { if (cancelled || !data?.fatal) return; failCountRef.current += 1; if (data.type === 'mediaError' && failCountRef.current <= 1) { hls.recoverMediaError(); return; } if (data.type === 'networkError' && failCountRef.current <= 2) { hls.startLoad(); return; } failover(); });
        hls.loadSource(proxySource); hls.attachMedia(video);
      } catch { if (!cancelled) { setLoading(false); setError('راه‌اندازی پخش‌کننده ناموفق بود.'); } }
    };
    run();
    return () => { cancelled = true; video.removeEventListener('loadedmetadata', onLoaded); video.removeEventListener('canplay', onLoaded); video.removeEventListener('waiting', onWaiting); video.removeEventListener('playing', onPlaying); video.removeEventListener('pause', onPause); video.removeEventListener('error', onVideoError); destroyHls(); };
  }, [proxySource, destroyHls, sourceIndex, sources.length, activateSource]);

  useEffect(() => { const video = videoRef.current; if (video) { video.volume = volume; video.muted = muted; } }, [volume, muted]);
  useEffect(() => { const onFullscreenChange = () => setFullscreen(document.fullscreenElement === containerRef.current); document.addEventListener('fullscreenchange', onFullscreenChange); return () => document.removeEventListener('fullscreenchange', onFullscreenChange); }, []);
  useEffect(() => () => { if (controlsTimer.current) clearTimeout(controlsTimer.current); }, []);

  const revealControls = () => { setShowControls(true); if (controlsTimer.current) clearTimeout(controlsTimer.current); controlsTimer.current = setTimeout(() => setShowControls(false), 3000); };
  const togglePlay = () => { const video = videoRef.current; if (!video) return; if (video.paused) video.play().then(() => setPlaying(true)).catch(() => undefined); else video.pause(); };
  const toggleFullscreen = async () => { const container = containerRef.current; if (!container) return; try { if (document.fullscreenElement) await document.exitFullscreen(); else await container.requestFullscreen(); } catch { /* denied */ } };
  const togglePiP = async () => { const video = videoRef.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<PictureInPictureWindow> }; if (!video?.requestPictureInPicture) return; try { await video.requestPictureInPicture(); } catch { /* denied */ } };

  return <div ref={containerRef} className={`pro-player${showControls ? ' controls-visible' : ''}`} onMouseMove={revealControls} onMouseLeave={() => setShowControls(false)} onTouchStart={revealControls} tabIndex={0} onKeyDown={(event) => { if (event.key === ' ') { event.preventDefault(); togglePlay(); } if (event.key.toLowerCase() === 'f') void toggleFullscreen(); if (event.key.toLowerCase() === 'm') setMuted((value) => !value); }}>
    <video ref={videoRef} className="pro-player-video" poster={channel.image || undefined} playsInline preload="metadata" onDoubleClick={() => void toggleFullscreen()} />
    {loading && !error && <div className="pro-player-loader"><span className="spinner" /><span>در حال اتصال به پخش زنده…</span></div>}
    {error && <div className="pro-player-error"><div><div className="pro-player-error-title">پخش متوقف شد</div><div className="muted">{error}</div><button className="pro-player-retry" onClick={() => activateSource(sourceIndex)}><RotateCcw size={15} /> تلاش مجدد</button></div></div>}
    <div className="pro-player-top"><div className="pro-player-live"><span /> LIVE</div><div className="pro-player-channel">{channel.name || 'MOMSAT'}</div><div className="pro-player-top-actions">{sources.length > 1 && <button className="icon-button" title="مسیرهای پخش" onClick={() => setShowSources((value) => !value)}><Settings size={18} /></button>}</div></div>
    {showSources && sources.length > 1 && <div className="pro-player-menu source-menu"><div className="menu-title">مسیر پخش</div>{sources.map((source, index) => <button key={source.url} className={index === sourceIndex ? 'selected' : ''} onClick={() => { activateSource(index); setShowSources(false); }}><span>{source.title || `Source ${index + 1}`}</span>{index === sourceIndex && <span>●</span>}</button>)}</div>}
    {showQuality && levels.length > 0 && <div className="pro-player-menu quality-menu"><button className={quality === -1 ? 'selected' : ''} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel = -1; setQuality(-1); setShowQuality(false); }}>Auto</button>{levels.map((level) => <button key={level.index} className={quality === level.index ? 'selected' : ''} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel = level.index; setQuality(level.index); setShowQuality(false); }}>{level.label}</button>)}</div>}
    <div className="pro-player-controls"><button className="icon-button large" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={21} /> : <Play size={21} />}</button><button className="icon-button" onClick={() => setMuted((value) => !value)} title="Mute">{muted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}</button><input className="volume-slider" type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); setMuted(next === 0); }} aria-label="Volume" /><div className="pro-player-spacer" />{levels.length > 0 && <button className="text-button" onClick={() => { setShowSources(false); setShowQuality((value) => !value); }}>HD</button>}<button className="text-button live-text">LIVE</button><button className="icon-button" onClick={() => void togglePiP()} title="Picture in Picture"><PictureInPicture2 size={18} /></button><button className="icon-button" onClick={() => void toggleFullscreen()} title="Fullscreen">{fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}</button></div>
  </div>;
}
