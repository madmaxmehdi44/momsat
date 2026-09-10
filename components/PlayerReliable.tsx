'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Pause, PictureInPicture2, Play, RotateCcw, Settings, Volume2, VolumeX } from 'lucide-react';

type Source = { url: string; title?: string | null; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean };
type Channel = { name?: string; image?: string | null; url?: string | null; referer?: string | null; origin?: string | null; sources?: Source[] };
type HlsLike = { destroy: () => void; loadSource: (url: string) => void; attachMedia: (media: HTMLVideoElement) => void; startLoad: (startPosition?: number) => void; recoverMediaError: () => void; currentLevel: number; levels: Array<{ height?: number; bitrate?: number }>; on: (event: string, fn: (event: unknown, data: any) => void) => void };
type HlsCtor = { new (config?: Record<string, unknown>): HlsLike; isSupported: () => boolean; Events: Record<string, string> };
type Mode = 'proxy' | 'direct';

function usable(url: string) { return /^https?:\/\//i.test(url.trim()); }
function isHls(url: string) { return /\.m3u8(?:$|[?#])/i.test(url.trim()); }
function isNativeMedia(url: string) { return /\.(?:mp4|webm|m4v)(?:$|[?#])/i.test(url.trim()); }
function proxied(source: Source) {
  const qs = new URLSearchParams({ url: source.url.trim() });
  if (source.referer) qs.set('referer', source.referer);
  if (source.origin) qs.set('origin', source.origin);
  return `/api/stream?${qs.toString()}`;
}

export default function PlayerReliable({ channel }: { channel: Channel }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsLike | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const epochRef = useRef(0);
  const playingRef = useRef(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('proxy');
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(true);
  const [levels, setLevels] = useState<Array<{ index: number; label: string }>>([]);
  const [quality, setQuality] = useState(-1);
  const [showSources, setShowSources] = useState(false);
  const [showQuality, setShowQuality] = useState(false);

  useEffect(() => { playingRef.current = playing; }, [playing]);

  const sources = useMemo(() => {
    const raw: Source[] = [];
    if (channel.url && usable(channel.url)) raw.push({ url: channel.url.trim(), title: 'Primary', referer: channel.referer, origin: channel.origin });
    raw.push(...(channel.sources ?? []).filter((s) => usable(s.url)).map((s) => ({ ...s, url: s.url.trim() })));
    return Array.from(new Map(raw.map((s) => [s.url, s])).values());
  }, [channel.url, channel.referer, channel.origin, channel.sources]);

  const chooseSource = useCallback((index: number) => {
    if (!sources.length) return;
    setSourceIndex(Math.max(0, Math.min(index, sources.length - 1)));
    setMode('proxy');
    setLoading(true);
    setPlaying(false);
    setError('');
    setLevels([]);
    setQuality(-1);
  }, [sources.length]);

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
    let activeMode: Mode = isNativeMedia(sources[sourceIndex].url) ? 'direct' : 'proxy';
    const source = sources[Math.min(sourceIndex, sources.length - 1)];
    const directUrl = source.url;
    const proxy = proxied(source);

    if (retryRef.current) clearTimeout(retryRef.current);
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    hlsRef.current?.destroy();
    hlsRef.current = null;
    setMode(activeMode);
    setLoading(true);
    setPlaying(false);
    setError('');
    setLevels([]);
    setQuality(-1);

    const setReady = () => {
      if (cancelled || epoch !== epochRef.current) return;
      video.volume = volume;
      video.muted = muted;
      setLoading(false);
    };

    const fail = (message: string) => {
      if (cancelled || epoch !== epochRef.current) return;
      if (activeMode === 'proxy' && isHls(directUrl)) {
        activeMode = 'direct';
        setMode('direct');
        setLoading(true);
        setError(`${message} تلاش مستقیم…`);
        try { localHls?.destroy(); } catch {}
        localHls = null;
        hlsRef.current = null;
        startPlayback(directUrl);
        return;
      }
      if (sourceIndex + 1 < sources.length) {
        setError(`${message} مسیر بعدی امتحان می‌شود…`);
        retryRef.current = setTimeout(() => {
          if (!cancelled && epoch === epochRef.current) chooseSource(sourceIndex + 1);
        }, 800);
        return;
      }
      setLoading(false);
      setError(`${message} هیچ مسیر دیگری برای پخش باقی نمانده است.`);
    };

    const onPlaying = () => {
      if (!cancelled && epoch === epochRef.current) {
        playingRef.current = true;
        setPlaying(true);
        setLoading(false);
        setError('');
        if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
      }
    };
    const onPause = () => { if (!cancelled && epoch === epochRef.current) setPlaying(false); };
    const onWaiting = () => { if (!cancelled && epoch === epochRef.current && playingRef.current) setLoading(true); };
    const onError = () => fail(activeMode === 'proxy' ? 'پخش از پراکسی ناموفق بود.' : 'پخش مستقیم ناموفق بود.');

    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('error', onError);
    video.pause();
    video.removeAttribute('src');
    video.load();

    const startNative = (target: string) => {
      setReady();
      video.src = target;
      video.load();
    };

    function startPlayback(target: string) {
      if (cancelled || epoch !== epochRef.current) return;
      if (isNativeMedia(target) || (video.canPlayType('application/vnd.apple.mpegurl') && activeMode === 'direct')) {
        startNative(target);
        return;
      }
      void import('hls.js').then((mod) => {
        if (cancelled || epoch !== epochRef.current) return;
        const Hls = mod.default as unknown as HlsCtor;
        if (!Hls.isSupported()) {
          fail('مرورگر فعلی HLS را پشتیبانی نمی‌کند.');
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
          manifestLoadingMaxRetry: 2,
          levelLoadingMaxRetry: 3,
          fragLoadingMaxRetry: 3,
          manifestLoadingTimeOut: 12000,
          levelLoadingTimeOut: 12000,
          fragLoadingTimeOut: 15000,
          capLevelToPlayerSize: false,
        });
        localHls = hls;
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled || epoch !== epochRef.current || hlsRef.current !== hls) return;
          const mapped = hls.levels.map((level, index) => ({ index, label: level.height ? `${level.height}p` : level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : `Level ${index + 1}` }));
          setLevels(mapped.filter((x, i, all) => all.findIndex((v) => v.label === x.label) === i));
          setReady();
          video.volume = volume;
          video.muted = muted;
          void video.play().catch(() => undefined);
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (cancelled || epoch !== epochRef.current || hlsRef.current !== hls || !data?.fatal) return;
          if (data.type === 'mediaError') {
            hls.recoverMediaError();
            return;
          }
          fail(data.type === 'networkError' ? 'خطای شبکه هنگام دریافت استریم.' : 'خطای HLS هنگام پخش.');
        });
        hls.loadSource(target);
        hls.attachMedia(video);
      }).catch(() => fail('راه‌اندازی HLS ناموفق بود.'));
    }

    startPlayback(activeMode === 'proxy' ? proxy : directUrl);

    if (activeMode === 'proxy' && isHls(directUrl)) {
      watchdogRef.current = setTimeout(() => {
        if (!cancelled && epoch === epochRef.current && !playingRef.current && activeMode === 'proxy') {
          fail('پراکسی در زمان تعیین‌شده پاسخ پخش نداد.');
        }
      }, 12000);
    }

    return () => {
      cancelled = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      localHls?.destroy();
      if (hlsRef.current === localHls) hlsRef.current = null;
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('error', onError);
    };
  }, [chooseSource, sourceIndex, sources, volume, muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) { video.volume = volume; video.muted = muted; }
  }, [volume, muted]);

  const toggleFullscreen = async () => {
    if (!rootRef.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await rootRef.current.requestFullscreen();
    } catch {}
  };

  const current = sources[sourceIndex] ?? sources[0];
  if (!sources.length || !current) return <div className="pro-player-error"><div><div className="pro-player-error-title">منبع پخش موجود نیست</div></div></div>;

  return (
    <div ref={rootRef} className="pro-player controls-visible" tabIndex={0}>
      <video ref={videoRef} className="pro-player-video" poster={channel.image || undefined} playsInline preload="auto" muted={muted} onClick={() => { if (videoRef.current?.paused) void videoRef.current?.play(); else videoRef.current?.pause(); }} />
      {loading && !error && <div className="pro-player-loader"><span className="spinner" /><span>{mode === 'proxy' ? 'در حال اتصال از طریق پراکسی…' : 'در حال اتصال مستقیم به پخش زنده…'}</span></div>}
      {error && <div className="pro-player-error"><div><div className="pro-player-error-title">پخش متوقف شد</div><div className="muted">{error}</div><button className="pro-player-retry" onClick={() => chooseSource(sourceIndex)}><RotateCcw size={15} /> تلاش مجدد</button></div></div>}
      <div className="pro-player-top"><div className="pro-player-live"><span /> LIVE</div><div className="pro-player-channel">{channel.name || 'MOMSAT'}</div><div className="pro-player-source-status">{mode === 'proxy' ? 'PROXY' : 'DIRECT'}</div>{sources.length > 1 && <button className="icon-button" onClick={() => setShowSources((v) => !v)} title="مسیرهای پخش"><Settings size={18} /></button>}</div>
      {showSources && sources.length > 1 && <div className="pro-player-menu source-menu"><div className="menu-title">مسیر پخش</div>{sources.map((source, index) => <button key={`${source.url}-${index}`} className={index === sourceIndex ? 'selected' : ''} onClick={() => { chooseSource(index); setShowSources(false); }}><span>{source.title || `Source ${index + 1}`}</span>{source.country && <small>{source.country}</small>}</button>)}</div>}
      {showQuality && levels.length > 0 && <div className="pro-player-menu quality-menu"><button className={quality === -1 ? 'selected' : ''} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel = -1; setQuality(-1); setShowQuality(false); }}>Auto</button>{levels.map((level) => <button key={level.index} className={quality === level.index ? 'selected' : ''} onClick={() => { if (hlsRef.current) hlsRef.current.currentLevel = level.index; setQuality(level.index); setShowQuality(false); }}>{level.label}</button>)}</div>}
      <div className="pro-player-controls"><button className="icon-button large" onClick={() => { if (videoRef.current?.paused) void videoRef.current?.play(); else videoRef.current?.pause(); }} title={playing ? 'توقف' : 'پخش'}>{playing ? <Pause size={21} /> : <Play size={21} />}</button><button className="icon-button" onClick={() => setMuted((v) => !v)} title={muted ? 'فعال کردن صدا' : 'بی‌صدا'}>{muted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}</button><input className="volume-slider" type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={(e) => { const v = Number(e.target.value); setVolume(v); setMuted(v === 0); }} aria-label="Volume" /><div className="pro-player-spacer" />{levels.length > 0 && <button className="text-button" onClick={() => setShowQuality((v) => !v)}>HD</button>}<button className="text-button live-text">LIVE</button><button className="icon-button" onClick={async () => { const video = videoRef.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }; if (video.requestPictureInPicture) { try { await video.requestPictureInPicture(); } catch {} } }} title="Picture in Picture"><PictureInPicture2 size={18} /></button><button className="icon-button" onClick={() => void toggleFullscreen()} title="Fullscreen"><Maximize size={19} /></button></div>
    </div>
  );
}
