'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Gauge, Image, Palette, Play, RotateCcw, Settings2, Sparkles, Zap, ShieldCheck, Volume2 } from 'lucide-react';
import { applyAppLanguage, applyAppTheme, DEFAULT_APP_SETTINGS, loadAppSettings, saveAppSettings, type AppLanguage, type AppSettings, type AppTheme, type DefaultQuality } from '../../lib/app-settings';
import { finishAction, startAction } from '../../lib/action-feedback';
import styles from './settings.module.css';

const QUALITY_OPTIONS: Array<[DefaultQuality, string]> = [['auto', 'خودکار (پیشنهادی)'], ['2160', '2160p · 4K'], ['1440', '1440p · 2K'], ['1080', '1080p · Full HD'], ['720', '720p · HD'], ['480', '480p · SD'], ['360', '360p · Data Saver']];
const THEMES: Array<[AppTheme, string, string]> = [['midnight', 'Midnight', 'تیره و اصلی MOMSAT'], ['light', 'Light', 'روشن و مینیمال'], ['aurora', 'Aurora', 'تیره با حال‌وهوای آبی/بنفش']];

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

  const persist = (next: AppSettings) => {
    const actionId = 'settings:persist';
    startAction(actionId, 'در حال اعمال و ذخیره تنظیمات');
    setSettings(next);
    saveAppSettings(next);
    window.requestAnimationFrame(() => finishAction(actionId, 'تنظیمات ذخیره شد'));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  };

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...settings, [key]: value };
    persist(next);
    if (key === 'theme') applyAppTheme(value as AppTheme);
    if (key === 'language') applyAppLanguage(value as AppLanguage);
  };

  const reset = () => {
    persist(DEFAULT_APP_SETTINGS);
    applyAppTheme(DEFAULT_APP_SETTINGS.theme);
    applyAppLanguage(DEFAULT_APP_SETTINGS.language);
  };

  const qualityDescription = useMemo(() => QUALITY_OPTIONS.find(([value]) => value === settings.defaultQuality)?.[1] ?? 'خودکار', [settings.defaultQuality]);

  return (
    <main className={styles.page} dir="rtl">
      <header className={styles.header}>
        <div><div className={styles.eyebrow}>MOMSAT SETTINGS</div><h1>تنظیمات سیستم</h1><p>ظاهر برنامه، صفحه اصلی و رفتار Player Pro از همین صفحه کنترل می‌شود.</p></div>
        <div className={styles.actions}><button className={styles.reset} type="button" onClick={reset}><RotateCcw size={16} /> بازنشانی</button><div className={styles.save} aria-live="polite"><Check size={16} /> {saved ? 'اعمال شد' : 'ذخیره خودکار'}</div></div>
      </header>

      <div className={styles.layout}>
        <section className={`${styles.card} ${styles.featured}`}>
          <div className={styles.cardTitle}><Palette size={18} /><div><h2>قالب کلی MOMSAT</h2><span>تم سراسری رابط، صفحه اول و پنل‌ها</span></div></div>
          <div className={styles.settingBlock}><label>تم</label><div className={styles.themeGrid}>{THEMES.map(([value, title, description]) => <button key={value} type="button" onClick={() => update('theme', value)} className={`${styles.theme} ${settings.theme === value ? styles.selected : ''}`}><span className={`${styles.swatch} ${styles[`swatch_${value}`]}`} /><span><strong>{title}</strong><small>{description}</small></span>{settings.theme === value ? <Check size={16} /> : null}</button>)}</div></div>
          <div className={styles.settingRowGrid}>
            <div className={styles.settingBlock}><label htmlFor="language">زبان رابط</label><select id="language" value={settings.language} onChange={(event) => update('language', event.target.value as AppLanguage)}><option value="fa">فارسی</option><option value="en">English</option></select></div>
            <div className={styles.settingBlock}><label>حالت تصویر Player</label><div className={styles.choiceGrid}>{(['contain','cover','fill'] as const).map((fit) => <button key={fit} type="button" className={settings.fit === fit ? styles.choiceSelected : ''} onClick={() => update('fit', fit)}>{fit === 'contain' ? 'اصلی' : fit === 'cover' ? 'پر کردن' : 'کشیده'}</button>)}</div></div>
          </div>
          <small className={styles.note}>تغییر تم و زبان بدون refresh در همین مرورگر اعمال می‌شود.</small>
        </section>

        <section className={styles.card}>
          <div className={styles.cardTitle}><Play size={18} /><div><h2>Player Pro</h2><span>رفتار پخش پیش‌فرض</span></div></div>
          <div className={styles.rows}>
            <div className={styles.row}><div><strong>پخش خودکار</strong><small>بعد از آماده شدن استریم پخش آغاز شود.</small></div><Toggle value={settings.autoplay} onChange={() => update('autoplay', !settings.autoplay)} /></div>
            <div className={styles.row}><div><strong>شروع بی‌صدا</strong><small>شروع امن برای جلوگیری از پخش ناخواسته صدا.</small></div><Toggle value={settings.mutedStart} onChange={() => update('mutedStart', !settings.mutedStart)} /></div>
            <div className={styles.row}><div><strong>حالت سینمایی</strong><small>پلیر فضای بیشتری از صفحه را استفاده کند.</small></div><Toggle value={settings.theaterMode} onChange={() => update('theaterMode', !settings.theaterMode)} /></div>
            <div className={styles.row}><div><strong>آمار فنی</strong><small>رزولوشن، بافر و وضعیت فنی نمایش داده شود.</small></div><Toggle value={settings.showTechnicalStats} onChange={() => update('showTechnicalStats', !settings.showTechnicalStats)} /></div>
            <div className={styles.row}><div><strong>Low Latency</strong><small>اولویت حالت کم‌تاخیر برای پخش‌های سازگار.</small></div><Toggle value={settings.lowLatency} onChange={() => update('lowLatency', !settings.lowLatency)} /></div>
            <div className={styles.row}><div><strong>Auto Failover</strong><small>در خرابی منبع، مسیر بعدی خودکار انتخاب شود.</small></div><Toggle value={settings.autoFailover} onChange={() => update('autoFailover', !settings.autoFailover)} /></div>
            <div className={styles.selectRow}><div><strong>سرعت پخش</strong><small>سرعت پیش‌فرض برای محتوای قابل کنترل.</small></div><select value={settings.playbackRate} onChange={(event) => update('playbackRate', Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></div>
            <div className={styles.selectRow}><div><strong>بلندی صدا</strong><small>سطح صدای شروع Player Pro.</small></div><label className={styles.volumeControl}><Volume2 size={15} /><input type="range" min="0" max="1" step="0.01" value={settings.volume} onChange={(event) => update('volume', Number(event.target.value))} /></label></div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardTitle}><Sparkles size={18} /><div><h2>کیفیت پیش‌فرض</h2><span>سطح کیفیت در اولین بارگذاری HLS</span></div></div>
          <div className={styles.qualityGrid}>{QUALITY_OPTIONS.map(([value, label]) => <button key={value} type="button" className={settings.defaultQuality === value ? styles.qualitySelected : ''} onClick={() => update('defaultQuality', value)}><span>{label}</span>{settings.defaultQuality === value ? <Check size={16} /> : null}</button>)}</div>
          <div className={styles.currentQuality}><strong>انتخاب فعلی</strong><span>{qualityDescription}</span></div>
          <div className={styles.notice}>اگر کیفیت در manifest شبکه وجود نداشته باشد، نزدیک‌ترین سطح موجود انتخاب می‌شود.</div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardTitle}><Settings2 size={18} /><div><h2>پروفایل‌های آماده</h2><span>سناریوهای رایج برای پخش</span></div></div>
          <div className={styles.profiles}>
            <button type="button" onClick={() => persist({ ...settings, defaultQuality: '720', mutedStart: true, lowLatency: false })}><Gauge size={18} /><strong>اتصال ضعیف</strong><small>720p · بی‌صدا · پایدار</small></button>
            <button type="button" onClick={() => persist({ ...settings, defaultQuality: '1080', mutedStart: true, autoFailover: true })}><ShieldCheck size={18} /><strong>متعادل</strong><small>1080p · Failover فعال</small></button>
            <button type="button" onClick={() => persist({ ...settings, defaultQuality: '2160', mutedStart: false, lowLatency: true })}><Zap size={18} /><strong>بیشترین کیفیت</strong><small>4K · Low Latency</small></button>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardTitle}><Image size={18} /><div><h2>قرارداد ظاهری صفحه اول</h2><span>همان زبان بصری در Home، Discovery و Settings</span></div></div>
          <div className={styles.designContract}>
            <div><strong>Layout</strong><span>RTL · responsive · content-first</span></div>
            <div><strong>Cards</strong><span>16:9 · thumbnail · live state</span></div>
            <div><strong>Player</strong><span>persistent · same-page playback</span></div>
            <div><strong>Navigation</strong><span>shared global chrome</span></div>
          </div>
          <div className={styles.notice}>این صفحه تنظیمات را به ساختار مشترک کل محصول متصل نگه می‌دارد؛ تنظیمات Player Pro نیز مستقیماً از همین مقادیر استفاده می‌کنند.</div>
        </section>
      </div>

      <footer className={styles.footerNote}>تنظیمات در حافظه محلی همین مرورگر ذخیره می‌شوند و بین reload و اجرای مجدد برنامه باقی می‌مانند.</footer>
    </main>
  );
}
