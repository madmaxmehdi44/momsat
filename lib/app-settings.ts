export type AppTheme = 'midnight' | 'light' | 'aurora';
export type AppLanguage = 'fa' | 'en';
export type DefaultQuality = 'auto' | '2160' | '1440' | '1080' | '720' | '480' | '360';

export type AppSettings = {
  theme: AppTheme;
  language: AppLanguage;
  defaultQuality: DefaultQuality;
  autoplay: boolean;
  mutedStart: boolean;
  theaterMode: boolean;
  showTechnicalStats: boolean;
  lowLatency: boolean;
  autoFailover: boolean;
  playbackRate: number;
};

export const APP_SETTINGS_KEY = 'momsat.settings.v1';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'midnight', language: 'fa', defaultQuality: 'auto', autoplay: true, mutedStart: true,
  theaterMode: false, showTechnicalStats: false, lowLatency: false, autoFailover: true, playbackRate: 1,
};

export function loadAppSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_APP_SETTINGS;
  try {
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || '{}') as Partial<AppSettings>;
    return { ...DEFAULT_APP_SETTINGS, ...parsed };
  } catch { return DEFAULT_APP_SETTINGS; }
}

export function saveAppSettings(settings: AppSettings) {
  try {
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent('momsat-settings-changed', { detail: settings }));
  } catch {}
}

export function applyAppTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.momsatTheme = theme;
  const values = {
    midnight: { bg: '#090b10', panel: '#10141c', line: '#232b38', text: '#f4f7fb', muted: '#95a0b1', accent: '#37d0ff', accent2: '#6b7cff' },
    light: { bg: '#eef3f8', panel: '#ffffff', line: '#d5dee9', text: '#17202c', muted: '#657184', accent: '#078dba', accent2: '#5368e8' },
    aurora: { bg: '#080b15', panel: '#11152a', line: '#29314e', text: '#f4f5ff', muted: '#9ca8c5', accent: '#40d7ff', accent2: '#8b6cff' },
  }[theme];
  for (const [key, value] of Object.entries(values)) root.style.setProperty(`--${key}`, value);
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
