export type AppTheme = 'midnight' | 'light' | 'aurora';
export type AppLanguage = 'fa' | 'en';
export type DefaultQuality = 'auto' | '2160' | '1440' | '1080' | '720' | '480' | '360';
export type AppFit = 'contain' | 'cover' | 'fill';

export type AppSettings = {
  theme: AppTheme;
  language: AppLanguage;
  defaultQuality: DefaultQuality;
  autoplay: boolean;
  mutedStart: boolean;
  volume: number;
  theaterMode: boolean;
  fit: AppFit;
  showTechnicalStats: boolean;
  lowLatency: boolean;
  autoFailover: boolean;
  playbackRate: number;
};

export const APP_SETTINGS_KEY = 'momsat.settings.v2';
const LEGACY_APP_SETTINGS_KEY = 'momsat.settings.v1';
const SETTINGS_EVENT = 'momsat-settings-changed';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'midnight',
  language: 'fa',
  defaultQuality: 'auto',
  autoplay: true,
  mutedStart: true,
  volume: 0.82,
  theaterMode: false,
  fit: 'contain',
  showTechnicalStats: false,
  lowLatency: false,
  autoFailover: true,
  playbackRate: 1,
};

function isTheme(value: unknown): value is AppTheme {
  return value === 'midnight' || value === 'light' || value === 'aurora';
}

function isLanguage(value: unknown): value is AppLanguage {
  return value === 'fa' || value === 'en';
}

function isQuality(value: unknown): value is DefaultQuality {
  return value === 'auto' || value === '2160' || value === '1440' || value === '1080' || value === '720' || value === '480' || value === '360';
}

function isFit(value: unknown): value is AppFit {
  return value === 'contain' || value === 'cover' || value === 'fill';
}

function sanitizeSettings(input: Partial<AppSettings> | null | undefined): AppSettings {
  const source = input ?? {};
  const volume = Number(source.volume);
  return {
    theme: isTheme(source.theme) ? source.theme : DEFAULT_APP_SETTINGS.theme,
    language: isLanguage(source.language) ? source.language : DEFAULT_APP_SETTINGS.language,
    defaultQuality: isQuality(source.defaultQuality) ? source.defaultQuality : DEFAULT_APP_SETTINGS.defaultQuality,
    autoplay: typeof source.autoplay === 'boolean' ? source.autoplay : DEFAULT_APP_SETTINGS.autoplay,
    mutedStart: typeof source.mutedStart === 'boolean' ? source.mutedStart : DEFAULT_APP_SETTINGS.mutedStart,
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_APP_SETTINGS.volume,
    theaterMode: typeof source.theaterMode === 'boolean' ? source.theaterMode : DEFAULT_APP_SETTINGS.theaterMode,
    fit: isFit(source.fit) ? source.fit : DEFAULT_APP_SETTINGS.fit,
    showTechnicalStats: typeof source.showTechnicalStats === 'boolean' ? source.showTechnicalStats : DEFAULT_APP_SETTINGS.showTechnicalStats,
    lowLatency: typeof source.lowLatency === 'boolean' ? source.lowLatency : DEFAULT_APP_SETTINGS.lowLatency,
    autoFailover: typeof source.autoFailover === 'boolean' ? source.autoFailover : DEFAULT_APP_SETTINGS.autoFailover,
    playbackRate: [0.5, 0.75, 1, 1.25, 1.5, 2].includes(Number(source.playbackRate)) ? Number(source.playbackRate) : DEFAULT_APP_SETTINGS.playbackRate,
  };
}

function readStoredSettings(storageKey: string): AppSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return sanitizeSettings(JSON.parse(raw) as Partial<AppSettings>);
  } catch {
    return null;
  }
}

export function loadAppSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_APP_SETTINGS;
  const current = readStoredSettings(APP_SETTINGS_KEY);
  if (current) return current;
  const legacy = readStoredSettings(LEGACY_APP_SETTINGS_KEY);
  if (legacy) {
    try { localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(legacy)); } catch {}
    return legacy;
  }
  return DEFAULT_APP_SETTINGS;
}

export function saveAppSettings(settings: AppSettings) {
  if (typeof window === 'undefined') return;
  const next = sanitizeSettings(settings);
  try {
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
    localStorage.removeItem(LEGACY_APP_SETTINGS_KEY);
  } catch {}
  window.dispatchEvent(new CustomEvent<AppSettings>(SETTINGS_EVENT, { detail: next }));
}

export function subscribeAppSettings(listener: (settings: AppSettings) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onCustom = (event: Event) => listener(sanitizeSettings((event as CustomEvent<AppSettings>).detail));
  const onStorage = (event: StorageEvent) => {
    if (event.key !== APP_SETTINGS_KEY) return;
    listener(loadAppSettings());
  };
  window.addEventListener(SETTINGS_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(SETTINGS_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

export function applyAppTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.momsatTheme = theme;
  const values = {
    midnight: { bg: '#0f0f0f', panel: '#171717', line: '#292929', text: '#f1f1f1', muted: '#8f8f8f', accent: '#ff1744', accent2: '#ff315b', chromeBg: '#0f0f0f', chromePanel: '#171717' },
    light: { bg: '#eef2f6', panel: '#ffffff', line: '#d5dce5', text: '#17202c', muted: '#647184', accent: '#087ea4', accent2: '#3859d6', chromeBg: '#f5f7fa', chromePanel: '#ffffff' },
    aurora: { bg: '#0a0d18', panel: '#14192b', line: '#293453', text: '#f4f5ff', muted: '#9da9c5', accent: '#42d7ff', accent2: '#8d6dff', chromeBg: '#090c16', chromePanel: '#12172a' },
  }[theme];
  for (const [key, value] of Object.entries(values)) root.style.setProperty(`--${key}`, value);
  root.style.setProperty('--momsat-bg', values.chromeBg);
  root.style.setProperty('--momsat-panel', values.chromePanel);
  root.style.setProperty('--momsat-panel-2', values.chromePanel);
  root.style.setProperty('--momsat-line', values.line);
  root.style.setProperty('--momsat-text', values.text);
  root.style.setProperty('--momsat-muted', values.muted);
  root.style.setProperty('--momsat-red', values.accent);
  document.body.style.background = theme === 'light'
    ? 'radial-gradient(circle at 80% -10%,#dce9f7 0,transparent 35%),var(--bg)'
    : 'radial-gradient(circle at 80% -10%,#172130 0,transparent 35%),var(--bg)';
  document.body.style.color = 'var(--text)';
}

export function applyAppLanguage(language: AppLanguage) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
}
