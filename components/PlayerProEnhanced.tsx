'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, Check, Maximize2, MonitorPlay, PictureInPicture2, RefreshCw, Settings2, Volume2, VolumeX, X } from 'lucide-react';
import PlayerPro from './PlayerPro';
import styles from './PlayerProEnhanced.module.css';
import { DEFAULT_APP_SETTINGS, loadAppSettings, saveAppSettings, subscribeAppSettings, type AppSettings } from '../lib/app-settings';

export default function PlayerProEnhanced({ channel }: { channel: { id?: number; name?: string; image?: string | null; url?: string | null; referer?: string | null; origin?: string | null; sources?: Array<{ url: string; title?: string | null; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean }> } }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const qualityApplyStarted = useRef(false);
  const [preferences, setPreferences] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stats, setStats] = useState({ resolution: '—', readyState: 0, buffered: 0, currentTime: 0 });

  useEffect(() => {
    const loaded = loadAppSettings();
    setAppSettings(loaded);
    setPreferences(loaded);
    return subscribeAppSettings((next) => {
      setAppSettings(next);
      setPreferences(next);
      qualityApplyStarted.current = false;
    });
  }, []);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setPreferences((previous) => {
      const next = { ...previous, ...patch };
      setAppSettings(next);
      saveAppSettings(next);
      return next;
    });
  }, []);

  const getVideo = useCallback(() => shellRef.current?.querySelector('video') as HTMLVideoElement | null, []);

  useEffect(() => {
    const video = getVideo();
    if (!video) return;
    video.style.objectFit = preferences.fit;
    video.playbackRate = preferences.playbackRate;
    video.muted = preferences.mutedStart;
    video.volume = preferences.volume;
    if (preferences.autoplay) void video.play().catch(() => undefined);
  }, [getVideo, preferences.autoplay, preferences.fit, preferences.mutedStart, preferences.playbackRate, preferences.volume]);

  useEffect(() => {
    if (appSettings.defaultQuality === 'auto' || !shellRef.current) return;
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
        const wanted = `${appSettings.defaultQuality}p`;
        const match = options.find((button) => button.textContent?.includes(wanted));
        if (match) { match.click(); window.clearInterval(timer); return; }
      }
      attempts += 1;
      if (attempts >= 14) window.clearInterval(timer);
    }, 350);
    return () => window.clearInterval(timer);
  }, [appSettings.defaultQuality, channel.id]);

  useEffect(() => {
    if (!preferences.showTechnicalStats) return;
    const timer = window.setInterval(() => {
      const video = getVideo();
      if (!video) return;
      const buffered = video.buffered.length ? Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime) : 0;
      setStats({ resolution: video.videoWidth && video.videoHeight ? `${video.videoWidth}×${video.videoHeight}` : '—', readyState: video.readyState, buffered, currentTime: video.currentTime });
    }, 500);
    return () => window.clearInterval(timer);
  }, [getVideo, preferences.showTechnicalStats]);

  const refresh = useCallback(() => {
    const video = getVideo();
    if (!video) return;
    video.pause();
    video.load();
    qualityApplyStarted.current = false;
    if (preferences.autoplay) void video.play().catch(() => undefined);
  }, [getVideo, preferences.autoplay]);

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
    update({ mutedStart: !preferences.mutedStart });
  }, [preferences.mutedStart, update]);

  const setVolume = useCallback((next: number) => {
    update({ volume: next, mutedStart: next === 0 });
  }, [update]);

  return (
    <div ref={shellRef} className="player-pro-enhanced-shell">
      <PlayerPro channel={channel} />
      {preferences.showTechnicalStats && <div className={styles.stats} dir="ltr"><span>{stats.resolution}</span><span>buffer {stats.buffered.toFixed(1)}s</span><span>ready {stats.readyState}</span><span>t {stats.currentTime.toFixed(1)}s</span></div>}
      <div className={`${styles.toolbar} player-pro-enhanced-toolbar`} dir="rtl">
        <button onClick={() => setSettingsOpen((value) => !value)} title="تنظیمات پیشرفته"><Settings2 size={17} /> تنظیمات</button>
        <button onClick={refresh} title="اتصال مجدد"><RefreshCw size={17} /> اتصال مجدد</button>
        <button className="player-pro-enhanced-sound-button" onClick={toggleMute} title={preferences.mutedStart ? 'فعال کردن صدا' : 'بی‌صدا'} aria-label={preferences.mutedStart ? 'فعال کردن صدا' : 'بی‌صدا'}>{preferences.mutedStart ? <VolumeX size={17} /> : <Volume2 size={17} />}{preferences.mutedStart ? 'بی‌صدا' : 'صدا'}</button>
        <label className={styles.volume} title="بلندی صدا"><Volume2 size={15} /><input type="range" min="0" max="1" step="0.01" value={preferences.mutedStart ? 0 : preferences.volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="بلندی صدا" /></label>
        <button onClick={pip} title="Picture in Picture"><PictureInPicture2 size={17} /> PiP</button>
        <button onClick={fullscreen} title="تمام صفحه"><Maximize2 size={17} /> تمام صفحه</button>
      </div>
      {settingsOpen && <div className={styles.panel} dir="rtl">
        <div className={styles.panelHeader}><div><strong>تنظیمات Player Pro</strong><span>تنظیمات این مرورگر ذخیره می‌شوند</span></div><button onClick={() => setSettingsOpen(false)} aria-label="بستن"><X size={18} /></button></div>
        <section><h4><MonitorPlay size={16} /> پخش</h4><button className={preferences.autoplay ? styles.active : ''} onClick={() => update({ autoplay: !preferences.autoplay })}><span>پخش خودکار</span>{preferences.autoplay ? <Check size={16} /> : null}</button><button className={preferences.mutedStart ? styles.active : ''} onClick={toggleMute}><span>شروع بی‌صدا</span>{preferences.mutedStart ? <Check size={16} /> : null}</button><div className={styles.row}><span>سرعت پخش</span><select value={preferences.playbackRate} onChange={(event) => update({ playbackRate: Number(event.target.value) })}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></div><div className={styles.row}><span>بلندی صدا</span><strong>{Math.round(preferences.volume * 100)}%</strong></div></section>
        <section><h4><Settings2 size={16} /> تنظیمات عمومی</h4><div className={styles.infoGrid}><span>کیفیت پیش‌فرض</span><strong>{appSettings.defaultQuality === 'auto' ? 'Auto' : `${appSettings.defaultQuality}p`}</strong><span>Low Latency</span><strong>{appSettings.lowLatency ? 'On' : 'Off'}</strong><span>Auto Failover</span><strong>{appSettings.autoFailover ? 'On' : 'Off'}</strong></div></section>
        <section><h4><BarChart3 size={16} /> تصویر</h4><div className={styles.choiceGrid}>{(['contain','cover','fill'] as const).map((fit) => { const label = fit === 'contain' ? 'اصلی' : fit === 'cover' ? 'پر کردن' : 'کشیده'; return <button key={fit} className={preferences.fit === fit ? styles.selected : ''} onClick={() => update({ fit })}>{label}{preferences.fit === fit ? <Check size={14} /> : null}</button>; })}</div><button className={preferences.theaterMode ? styles.active : ''} onClick={() => update({ theaterMode: !preferences.theaterMode })}><span>حالت سینمایی</span>{preferences.theaterMode ? <Check size={16} /> : null}</button><button className={preferences.showTechnicalStats ? styles.active : ''} onClick={() => update({ showTechnicalStats: !preferences.showTechnicalStats })}><span>نمایش آمار فنی</span>{preferences.showTechnicalStats ? <Check size={16} /> : null}</button></section>
        <section className={styles.shortcuts}><h4>کنترل سریع</h4><div><kbd>Space</kbd> پخش / توقف</div><div><kbd>M</kbd> صدا <kbd>F</kbd> تمام صفحه</div><div><kbd>Double Click</kbd> تمام صفحه</div></section>
      </div>}
    </div>
  );
}
