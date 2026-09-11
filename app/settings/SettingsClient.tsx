'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Palette, Play, RotateCcw, Settings2, Sparkles, VolumeX, Wifi } from 'lucide-react';
import { applyAppLanguage, applyAppTheme, DEFAULT_APP_SETTINGS, loadAppSettings, saveAppSettings, type AppLanguage, type AppSettings, type AppTheme, type DefaultQuality } from '../../lib/app-settings';
import styles from './settings.module.css';

const QUALITY_OPTIONS: Array<[DefaultQuality, string]> = [['auto', 'خودکار (پیشنهادی)'], ['2160', '2160p · 4K'], ['1440', '1440p · 2K'], ['1080', '1080p · Full HD'], ['720', '720p · HD'], ['480', '480p · SD'], ['360', '360p · Data Saver']];
const THEMES: Array<[AppTheme, string, string]> = [['midnight', 'Midnight', 'تم تیره اصلی MOMSAT'], ['light', 'Light', 'روشن و کم‌کنتراست'], ['aurora', 'Aurora', 'تیره با تأکید آبی/بنفش']];

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return <button type="button" className={`${styles.toggle} ${value ? styles.toggleOn : ''}`} onClick={onChange} aria-pressed={value}><span /></button>;
}

export default function SettingsClient() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const loaded = loadAppSettings();
    setSettings(loaded);
    applyAppTheme(loaded.theme);
    applyAppLanguage(loaded.language);
  }, []);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const persist = () => {
    saveAppSettings(settings);
    applyAppTheme(settings.theme);
    applyAppLanguage(settings.language);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const reset = () => {
    setSettings(DEFAULT_APP_SETTINGS);
    saveAppSettings(DEFAULT_APP_SETTINGS);
    applyAppTheme(DEFAULT_APP_SETTINGS.theme);
    applyAppLanguage(DEFAULT_APP_SETTINGS.language);
  };

  const qualityDescription = useMemo(() => QUALITY_OPTIONS.find(([value]) => value === settings.defaultQuality)?.[1] ?? 'خودکار', [settings.defaultQuality]);

  return (
    <main className={styles.page} dir="rtl">
      <div className={styles.header}>
        <div><div className={styles.eyebrow}>MOMSAT SETTINGS</div><h1>تنظیمات</h1><p>ظاهر برنامه، زبان، کیفیت پیش‌فرض و رفتار Player Pro از یک محل کنترل می‌شود.</p></div>
        <div className={styles.actions}><button className={styles.reset} type="button" onClick={reset}><RotateCcw size={16} /> بازنشانی</button><button className={styles.save} type="button" onClick={persist}><Check size={16} /> {saved ? 'ذخیره شد' : 'ذخیره تنظیمات'}</button></div>
      </div>

      <div className={styles.layout}>
        <section className={styles.card}>
          <div className={styles.cardTitle}><Palette size={18} /><div><h2>قالب و زبان</h2><span>ظاهر و جهت رابط کاربری</span></div></div>
          <div className={styles.settingBlock}><label>قالب</label><div className={styles.themeGrid}>{THEMES.map(([value, title, description]) => <button key={value} type="button" onClick={() => update('theme', value)} className={`${styles.theme} ${settings.theme === value ? styles.selected : ''}`}><span className={`${styles.swatch} ${styles[`swatch_${value}`]}`} /><span><strong>{title}</strong><small>{description}</small></span>{settings.theme === value ? <Check size={16} /> : null}</button>)}</div></div>
          <div className={styles.settingBlock}><label htmlFor="language">زبان رابط کاربری</label><select id="language" value={settings.language} onChange={(event) => update('language', event.target.value as AppLanguage)}><option value="fa">فارسی</option><option value="en">English</option></select><small className={styles.note}>زبان و جهت صفحه در مرورگر ذخیره می‌شود.</small></div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardTitle}><Play size={18} /><div><h2>Player Pro</h2><span>رفتار پیش‌فرض پخش</span></div></div>
          <div className={styles.rows}>
            <div className={styles.row}><div><strong>پخش خودکار</strong><small>بعد از آماده شدن استریم، پخش آغاز شود.</small></div><Toggle value={settings.autoplay} onChange={() => update('autoplay', !settings.autoplay)} /></div>
            <div className={styles.row}><div><strong>شروع بی‌صدا</strong><small>شروع امن برای بارگذاری اولیه صفحه.</small></div><Toggle value={settings.mutedStart} onChange={() => update('mutedStart', !settings.mutedStart)} /></div>
            <div className={styles.row}><div><strong>حالت سینمایی</strong><small>پلیر فضای بیشتری از صفحه را استفاده کند.</small></div><Toggle value={settings.theaterMode} onChange={() => update('theaterMode', !settings.theaterMode)} /></div>
            <div className={styles.row}><div><strong>آمار فنی</strong><small>رزولوشن، بافر و وضعیت فنی نمایش داده شود.</small></div><Toggle value={settings.showTechnicalStats} onChange={() => update('showTechnicalStats', !settings.showTechnicalStats)} /></div>
            <div className={styles.row}><div><strong>Low Latency</strong><small>برای استریم‌های سازگار، تأخیر کمتر.</small></div><Toggle value={settings.lowLatency} onChange={() => update('lowLatency', !settings.lowLatency)} /></div>
            <div className={styles.row}><div><strong>Auto Failover</strong><small>در خرابی منبع، مسیر بعدی امتحان شود.</small></div><Toggle value={settings.autoFailover} onChange={() => update('autoFailover', !settings.autoFailover)} /></div>
            <div className={styles.selectRow}><div><strong>سرعت پخش</strong><small>سرعت پیش‌فرض برای محتوای قابل کنترل.</small></div><select value={settings.playbackRate} onChange={(event) => update('playbackRate', Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardTitle}><Sparkles size={18} /><div><h2>کیفیت پیش‌فرض</h2><span>برای HLS هنگام اولین بارگذاری</span></div></div>
          <div className={styles.qualityGrid}>{QUALITY_OPTIONS.map(([value, label]) => <button key={value} type="button" className={settings.defaultQuality === value ? styles.qualitySelected : ''} onClick={() => update('defaultQuality', value)}><span>{label}</span>{settings.defaultQuality === value ? <Check size={16} /> : null}</button>)}</div>
          <div className={styles.currentQuality}><strong>انتخاب فعلی</strong><span>{qualityDescription}</span></div>
          <div className={styles.notice}>اگر کیفیت انتخاب‌شده در manifest شبکه وجود نداشته باشد، نزدیک‌ترین سطح موجود استفاده می‌شود.</div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardTitle}><Settings2 size={18} /><div><h2>پروفایل‌های آماده</h2><span>تغییر چند تنظیم با یک انتخاب</span></div></div>
          <div className={styles.profiles}>
            <button type="button" onClick={() => setSettings((current) => ({ ...current, lowLatency: true, autoFailover: true, defaultQuality: '720', mutedStart: true }))}><Wifi size={18} /><strong>اتصال ضعیف</strong><small>720p · Low Latency · Failover</small></button>
            <button type="button" onClick={() => setSettings((current) => ({ ...current, lowLatency: false, autoFailover: true, defaultQuality: '1080' }))}><Play size={18} /><strong>متعادل</strong><small>1080p · پایدار</small></button>
            <button type="button" onClick={() => setSettings((current) => ({ ...current, lowLatency: false, autoFailover: true, defaultQuality: '2160' }))}><VolumeX size={18} /><strong>بیشترین کیفیت</strong><small>اولویت رزولوشن · Failover</small></button>
          </div>
        </section>
      </div>
      <div className={styles.footerNote}>تنظیمات در مرورگر جاری ذخیره می‌شوند.</div>
    </main>
  );
}
