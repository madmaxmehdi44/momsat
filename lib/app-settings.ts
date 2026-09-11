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
  theme: 'midnight',
  language: 'fa',
  defaultQuality: 'auto',
  autoplay: true,
  mutedStart: true,
  theaterMode: false,
  showTechnicalStats: false,
  lowLatency: false,
  autoFailover: true,
  playbackRate: 1,
};

export function loadAppSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_APP_SETTINGS;
  try {
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || '{}') as Partial<AppSettings>;
    return { ...DEFAULT_APP_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(settings: AppSettings) {
  try {
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent('momsat-settings-changed', { detail: settings }));
  } catch {}
}

export function applyAppTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.momsatTheme = theme;
}

export function applyAppLanguage(language: AppLanguage) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr';
}
