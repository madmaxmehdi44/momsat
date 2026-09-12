'use client';

import { useEffect } from 'react';
import { applyAppLanguage, applyAppTheme, loadAppSettings, subscribeAppSettings } from '../lib/app-settings';

/** Keeps the persisted MOMSAT theme/language applied on every route, not only Settings. */
export default function ThemeSync() {
  useEffect(() => {
    const apply = (settings: ReturnType<typeof loadAppSettings>) => {
      applyAppTheme(settings.theme);
      applyAppLanguage(settings.language);
    };

    apply(loadAppSettings());
    return subscribeAppSettings(apply);
  }, []);

  return null;
}
