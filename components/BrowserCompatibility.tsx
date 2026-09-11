'use client';

import { useEffect } from 'react';

declare global {
  interface Window {
    HTMLInput?: typeof HTMLInputElement;
  }
}

export default function BrowserCompatibility() {
  useEffect(() => {
    if (!window.HTMLInput) {
      Object.defineProperty(window, 'HTMLInput', {
        configurable: true,
        value: window.HTMLInputElement,
      });
    }
  }, []);

  return null;
}
