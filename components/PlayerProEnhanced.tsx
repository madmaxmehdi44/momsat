'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BarChart3, Check, Maximize2, MonitorPlay, PictureInPicture2, RefreshCw, Settings2, Volume2, VolumeX, X } from 'lucide-react';
import PlayerPro from './PlayerPro';
import styles from './PlayerProEnhanced.module.css';
import { DEFAULT_APP_SETTINGS, loadAppSettings, saveAppSettings, subscribeAppSettings, type AppSettings } from '../lib/app-settings';

export default function PlayerProEnhanced({ channel }: { channel: { id?: number; name?: string; image?: string | null; url?: string | null; referer?: string | null; origin?: string | null; sources?: Array<{ url: string; title?: string | null; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean }> } }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const qualityApplyStarted = useRef(false);
  const autoplayGestureUntil = useRef(0);
  const guardedVideoRef = useRef<{ video: HTMLVideoElement; play: HTMLVideoElement['play'] } | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stats, setStats] = useState({ resolution: '—', readyState: 0, buffered: 0, currentTime: 0 });

  useEffect(() => {
    const loaded = loadAppSettings();
    setSettings(loaded);
    setSettingsReady(true);
    return subscribeAppSettings((next) => {
      setSettings(next);
      qualityApplyStarted.current = false;
    });
  }, []);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      saveAppSettings(next);
      return next;
    });
  }, []);

  const getVideo = useCallback(() => shellRef.current?.querySelector('video') as HTMLVideoElement | null, []);

  useEffect(() => {
    const root = shellRef.current;
    if (!root) return;
    const markUserGesture = () => { autoplayGestureUntil.current = Date.now() + 1200; };
    root.addEventListener('pointerdown', markUserGesture, true);
    root.addEventListener('touchstart', markUserGesture, true);
    root.addEventListener('keydown', markUserGesture, true);
    return () => {
      root.removeEventListener('pointerdown', markUserGesture, true);
      root.removeEventListener('touchstart', markUserGesture, true);
      root.removeEventListener('keydown', markUserGesture, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!settingsReady) return;
    const video = getVideo();
    if (!video) return;

    const previous = guardedVideoRef.current;
    if (previous && previous.video !== video) {
      previous.video.play = previous.play;
      guardedVideoRef.current = null;
    }

    if (settings.autoplay) {
      const guarded = guardedVideoRef.current;
      if (guarded?.video === video) {
        video.play = guarded.play;
        guardedVideoRef.current = null;
      }
      return;
    }

    if (!guardedVideoRef.current || guardedVideoRef.current.video !== video) {
      const originalPlay = video.play.bind(video);
      guardedVideoRef.current = { video, play: originalPlay };
      video.play = () => {
        if (Date.now() <= autoplayGestureUntil.current) return originalPlay();
        return Promise.reject(new DOMException('Autoplay is disabled in MOMSAT settings.', 'NotAllowedError'));
      };
    }

    return () => {
      const guarded = guardedVideoRef.current;
      if (guarded?.video === video) {
        video.play = guarded.play;
        guardedVideoRef.current = null;
      }
    };
  }, [getVideo, settings.autoplay, settingsReady, channel.id]);

  useEffect(() => {
    if (!settingsReady) return;
    const video = getVideo();
    if (!video) return;
    video.style.objectFit = settings.fit;
    video.playbackRate = settings.playbackRate;
    video.muted = settings.mutedStart;
    video.volume = settings.volume;

    if (!settings.autoplay) {
      video.pause();
      return;
    }

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.paused) {
      void video.play().catch(() => undefined);
    }
  }, [getVideo, settings.autoplay, settings.fit, settings.mutedStart, settings.playbackRate, settings.volume, settingsReady, channel.id]);

  useEffect(() => {
    if (settings.defaultQuality === 'auto' || !shellRef.current || !settingsReady) return;
    qualityApplyStarted.current = false;
    let attempts = 0;
    const timer = window.setInterval(() => {
      const root = shellRef.current;
      if (!root) return;
      const buttons = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
      const menu = root.querySelector('.quality-menu-pro');
      if (!menu && !qualityApplyStarted.current) {
        const hdButton = buttons.find((button) => button.textContent?.trim() === 'HD');
        if (hdButton) { qualityApplyStarted.current = true; hdButton.click(); }
      }
      const options = Array.from(root.querySelectorAll('.quality-menu-pro button')) as HTMLButtonElement[];
      if (options.length) {
        const wanted = `${settings.defaultQuality}p`;
        const match = options.find((button) => button.textContent?.includes(wanted));
        if (match) { match.click(); window.clearInterval(timer); return; }
      }
      attempts += 1;
      if (attempts >= 10) window.clearInterval(timer);
    }, 300);
    return () => window.clearInterval(timer);
  }, [settings.defaultQuality, settingsReady, channel.id]);

  useEffect(() => {
    if (!settings.showTechnicalStats) return;
    const timer = window.setInterval(() => {
      const video = getVideo();
      if (!video) return;
      const buffered = video.buffered.length ? Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime) : 0;
      setStats({ resolution: video.videoWidth && video.videoHeight ? `${video.videoWidth}×${video.videoHeight}` : '—', readyState: video.readyState, buffered, currentTime: video.currentTime });
    }, 500);
    return () => window.clearInterval(timer);
  }, [getVideo, settings.showTechnicalStats]);

  const refresh = useCallback(() => {
    const video = getVideo();
    if (!video) return;
    video.pause();
    video.load();
    qualityApplyStarted.current = false;
    if (settings.autoplay) void video.play().catch(() => undefined);
  }, [getVideo, settings.autoplay]);

  const fullscreen = useCallback(() => {
    const element = shellRef.current?.querySelector('.pro-player') as HTMLElement | null;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen().catch(() => undefined);
  }, []);

  const pip = useCallback(async () => {
    const video = getVideo() as (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }) | null;
    if (!video?.requestPictureInPicture) return;
    try { await video.requestPictureInPicture(); } catch {}
  }, [getVideo]);

  const toggleMute = useCallback(() => {
    const nextMuted = !settings.mutedStart;
    update({ mutedStart: nextMuted, volume: !nextMuted && settings.volume === 0 ? 0.82 : settings.volume });
  }, [settings.mutedStart, settings.volume, update]);

  const setVolume = useCallback((next: number) => {
    update({ volume: next, mutedStart: next === 0 });
  }, [update]);

  return (
    <div ref={shellRef} className={`${styles.shell}${settings.theaterMode ? ` ${styles.theater}` : ''} player-pro-enhanced-shell`}>
      {settingsReady ? <PlayerPro channel={channel} /> : <div className="pro-player-loader pro-player-loader-pro"><span className="spinner" /><span>در حال آماده‌سازی تنظیمات پخش…</span></div>}
      {settings.showTechnicalStats && <div className={styles.stats} dir="ltr"><span>{stats.resolution}</span><span>buffer {stats.buffered.toFixed(1)}s</span><span>ready {stats.readyState}</span><span>t {stats.currentTime.toFixed(1)}s</span></div>}
      <div className={`${styles.toolbar} player-pro-enhanced-toolbar`} dir="rtl">
        <button onClick={() => setSettingsOpen((value) => !value)} title="تنظیمات پیشرفته"><Settings2 size={17} /> تنظیمات</button>
        <button onClick={refresh} title="اتصال مجدد"><RefreshCw size={17} /> اتصال مجدد</button>
        <button className="player-pro-enhanced-sound-button" onClick={toggleMute} title={settings.mutedStart ? 'فعال کردن صدا' : 'بی‌صدا'} aria-label={settings.mutedStart ? 'فعال کردن صدا' : 'بی‌صدا'}>{settings.mutedStart ? <VolumeX size={17} /> : <Volume2 size={17} />}{settings.mutedStart ? 'بی‌صدا' : 'صدا'}</button>
        <label className={styles.volume} title="بلندی صدا"><Volume2 size={15} /><input type="range" min="0" max="1" step="0.01" value={settings.mutedStart ? 0 : settings.volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="بلندی صدا" /></label>
        <button onClick={pip} title="Picture in Picture"><PictureInPicture2 size={17} /> PiP</button>
        <button onClick={fullscreen} title="تمام صفحه"><Maximize2 size={17} /> تمام صفحه</button>
      </div>
      {settingsOpen && <div className={styles.panel} dir="rtl">
        <div className={styles.panelHeader}><div><strong>تنظیمات Player Pro</strong><span>تنظیمات این مرورگر ذخیره می‌شوند</span></div><button onClick={() => setSettingsOpen(false)} aria-label="بستن"><X size={18} /></button></div>
        <section><h4><MonitorPlay size={16} /> پخش</h4><button className={settings.autoplay ? styles.active : ''} onClick={() => update({ autoplay: !settings.autoplay })}><span>پخش خودکار</span>{settings.autoplay ? <Check size={16} /> : null}</button><button className={settings.mutedStart ? styles.active : ''} onClick={toggleMute}><span>شروع بی‌صدا</span>{settings.mutedStart ? <Check size={16} /> : null}</button><div className={styles.row}><span>سرعت پخش</span><select value={settings.playbackRate} onChange={(event) => update({ playbackRate: Number(event.target.value) })}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></div><div className={styles.row}><span>بلندی صدا</span><strong>{Math.round(settings.volume * 100)}%</strong></div></section>
        <section><h4><Settings2 size={16} /> تنظیمات عمومی</h4><div className={styles.infoGrid}><span>کیفیت پیش‌فرض</span><strong>{settings.defaultQuality === 'auto' ? 'Auto' : `${settings.defaultQuality}p`}</strong><span>Low Latency</span><strong>{settings.lowLatency ? 'On' : 'Off'}</strong><span>Auto Failover</span><strong>{settings.autoFailover ? 'On' : 'Off'}</strong></div></section>
        <section><h4><BarChart3 size={16} /> تصویر</h4><div className={styles.choiceGrid}>{(['contain','cover','fill'] as const).map((fit) => { const label = fit === 'contain' ? 'اصلی' : fit === 'cover' ? 'پر کردن' : 'کشیده'; return <button key={fit} className={settings.fit === fit ? styles.selected : ''} onClick={() => update({ fit })}>{label}{settings.fit === fit ? <Check size={14} /> : null}</button>; })}</div><button className={settings.theaterMode ? styles.active : ''} onClick={() => update({ theaterMode: !settings.theaterMode })}><span>حالت سینمایی</span>{settings.theaterMode ? <Check size={16} /> : null}</button><button className={settings.showTechnicalStats ? styles.active : ''} onClick={() => update({ showTechnicalStats: !settings.showTechnicalStats })}><span>نمایش آمار فنی</span>{settings.showTechnicalStats ? <Check size={16} /> : null}</button></section>
      </div>}
    </div>
  );
}
