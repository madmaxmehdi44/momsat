'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, Check, Maximize2, MonitorPlay, PictureInPicture2, RefreshCw, Settings2, Volume2, VolumeX, X } from 'lucide-react';
import PlayerPro from './PlayerPro';
import styles from './PlayerProEnhanced.module.css';
import { loadAppSettings, subscribeAppSettings, type AppSettings } from '../lib/app-settings';

type Source = { url: string; title?: string | null; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean };
type Channel = { id?: number; name?: string; image?: string | null; url?: string | null; referer?: string | null; origin?: string | null; sources?: Source[] };
type Fit = 'contain' | 'cover' | 'fill';
type Preferences = { autoplay: boolean; mutedStart: boolean; playbackRate: number; fit: Fit; theater: boolean; showStats: boolean };
const STORAGE_KEY = 'momsat.player-pro.preferences.v1';
const DEFAULTS: Preferences = { autoplay: true, mutedStart: true, playbackRate: 1, fit: 'contain', theater: false, showStats: false };

function loadPreferences(): Preferences {
  if (typeof window === 'undefined') return DEFAULTS;
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<Preferences>) }; } catch { return DEFAULTS; }
}

export default function PlayerProEnhanced({ channel }: { channel: Channel }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const qualityApplyStarted = useRef(false);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [volume, setVolume] = useState(0.82);
  const [muted, setMuted] = useState(true);
  const [stats, setStats] = useState({ resolution: '—', readyState: 0, buffered: 0, currentTime: 0 });

  useEffect(() => {
    const loaded = loadAppSettings();
    setAppSettings(loaded);
    setPreferences((current) => ({
      ...current,
      autoplay: loaded.autoplay,
      mutedStart: loaded.mutedStart,
      theater: loaded.theaterMode,
      showStats: loaded.showTechnicalStats,
      playbackRate: loaded.playbackRate,
    }));
    setMuted(loaded.mutedStart);
    return subscribeAppSettings((next) => {
      setAppSettings(next);
      setPreferences((current) => ({
        ...current,
        autoplay: next.autoplay,
        mutedStart: next.mutedStart,
        theater: next.theaterMode,
        showStats: next.showTechnicalStats,
        playbackRate: next.playbackRate,
      }));
      setMuted(next.mutedStart);
      qualityApplyStarted.current = false;
    });
  }, []);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((previous) => {
      const next = { ...previous, ...patch };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const getVideo = useCallback(() => shellRef.current?.querySelector('video') as HTMLVideoElement | null, []);

  useEffect(() => {
    const video = getVideo();
    if (!video) return;
    video.style.objectFit = preferences.fit;
    video.playbackRate = preferences.playbackRate;
    video.muted = muted;
    video.volume = volume;
    if (preferences.autoplay) void video.play().catch(() => undefined);
  }, [getVideo, muted, preferences.autoplay, preferences.fit, preferences.playbackRate, volume]);

  useEffect(() => {
    if (!appSettings || appSettings.defaultQuality === 'auto' || !shellRef.current) return;
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
  }, [appSettings, channel.id]);

  useEffect(() => {
    if (!preferences.showStats) return;
    const timer = window.setInterval(() => {
      const video = getVideo();
      if (!video) return;
      const buffered = video.buffered.length ? Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime) : 0;
      setStats({ resolution: video.videoWidth && video.videoHeight ? `${video.videoWidth}×${video.videoHeight}` : '—', readyState: video.readyState, buffered, currentTime: video.currentTime });
    }, 500);
    return () => window.clearInterval(timer);
  }, [getVideo, preferences.showStats]);

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
    const next = !muted;
    setMuted(next);
    const video = getVideo();
    if (video) video.muted = next;
  }, [getVideo, muted]);

  return (
    <div ref={shellRef} className={`${styles.shell}${preferences.theater ? ` ${styles.theater}` : ''}`}>
      <PlayerPro channel={channel} />
      {preferences.showStats && <div className={styles.stats} dir="ltr"><span>{stats.resolution}</span><span>buffer {stats.buffered.toFixed(1)}s</span><span>ready {stats.readyState}</span><span>t {stats.currentTime.toFixed(1)}s</span></div>}
      <div className={styles.toolbar} dir="rtl">
        <button onClick={() => setSettingsOpen((value) => !value)} title="تنظیمات پیشرفته"><Settings2 size={17} /> تنظیمات</button>
        <button onClick={refresh} title="اتصال مجدد"><RefreshCw size={17} /> اتصال مجدد</button>
        <button onClick={toggleMute} title={muted ? 'فعال کردن صدا' : 'بی‌صدا'}>{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}{muted ? 'بی‌صدا' : 'صدا'}</button>
        <label className={styles.volume} title="بلندی صدا"><Volume2 size={15} /><input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); setMuted(next === 0); }} /></label>
        <button onClick={pip} title="Picture in Picture"><PictureInPicture2 size={17} /> PiP</button>
        <button onClick={fullscreen} title="تمام صفحه"><Maximize2 size={17} /> تمام صفحه</button>
      </div>
      {settingsOpen && <div className={styles.panel} dir="rtl">
        <div className={styles.panelHeader}><div><strong>تنظیمات Player Pro</strong><span>تنظیمات این مرورگر ذخیره می‌شوند</span></div><button onClick={() => setSettingsOpen(false)} aria-label="بستن"><X size={18} /></button></div>
        <section><h4><MonitorPlay size={16} /> پخش</h4><button className={preferences.autoplay ? styles.active : ''} onClick={() => update({ autoplay: !preferences.autoplay })}><span>پخش خودکار</span>{preferences.autoplay ? <Check size={16} /> : null}</button><button className={preferences.mutedStart ? styles.active : ''} onClick={() => { const next = !preferences.mutedStart; update({ mutedStart: next }); setMuted(next); }}><span>شروع بی‌صدا</span>{preferences.mutedStart ? <Check size={16} /> : null}</button><div className={styles.row}><span>سرعت پخش</span><select value={preferences.playbackRate} onChange={(event) => update({ playbackRate: Number(event.target.value) })}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></div></section>
        <section><h4><Settings2 size={16} /> تنظیمات عمومی</h4><div className={styles.infoGrid}><span>کیفیت پیش‌فرض</span><strong>{appSettings?.defaultQuality === 'auto' ? 'Auto' : `${appSettings?.defaultQuality}p`}</strong><span>Low Latency</span><strong>{appSettings?.lowLatency ? 'On' : 'Off'}</strong><span>Auto Failover</span><strong>{appSettings?.autoFailover ? 'On' : 'Off'}</strong></div></section>
        <section><h4><BarChart3 size={16} /> تصویر</h4><div className={styles.choiceGrid}>{([['contain','اصلی'],['cover','پر کردن'],['fill','کشیده']] as Array<[Fit,string]>).map(([fit,label]) => <button key={fit} className={preferences.fit === fit ? styles.selected : ''} onClick={() => update({ fit })}>{label}{preferences.fit === fit ? <Check size={14} /> : null}</button>)}</div><button className={preferences.theater ? styles.active : ''} onClick={() => update({ theater: !preferences.theater })}><span>حالت سینمایی</span>{preferences.theater ? <Check size={16} /> : null}</button><button className={preferences.showStats ? styles.active : ''} onClick={() => update({ showStats: !preferences.showStats })}><span>نمایش آمار فنی</span>{preferences.showStats ? <Check size={16} /> : null}</button></section>
        <section className={styles.shortcuts}><h4>کنترل سریع</h4><div><kbd>Space</kbd> پخش / توقف</div><div><kbd>M</kbd> صدا <kbd>F</kbd> تمام صفحه</div><div><kbd>Double Click</kbd> تمام صفحه</div></section>
      </div>}
    </div>
  );
}
