'use client';

import { useEffect } from 'react';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[momsat] Unhandled application error');
    try {
      const raw = localStorage.getItem('momsat:app-settings:v1');
      const theme = raw ? JSON.parse(raw)?.theme : null;
      if (theme === 'light' || theme === 'midnight' || theme === 'aurora') {
        document.documentElement.dataset.momsatTheme = theme;
      }
    } catch {}
  }, []);

  return (
    <html lang="fa" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--bg, #090b10)',
          color: 'var(--text, #f4f7fb)',
          fontFamily: 'Tahoma, Arial, sans-serif',
          padding: '24px',
        }}
      >
        <main style={{ width: 'min(560px, 100%)', textAlign: 'center' }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: 'var(--accent, #ff315b)', fontWeight: 900, marginBottom: 12 }}>
            MOMSAT
          </div>
          <h1 style={{ margin: '0 0 12px', fontSize: 30 }}>یک خطای غیرمنتظره رخ داد</h1>
          <p style={{ margin: '0 0 24px', color: 'var(--muted, #95a0b1)', lineHeight: 1.9 }}>
            صفحه نتوانست کامل بارگذاری شود. می‌توانید دوباره تلاش کنید یا صفحه را تازه‌سازی کنید.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              border: 0,
              borderRadius: 10,
              padding: '11px 18px',
              background: 'var(--accent, #ff315b)',
              color: 'var(--bg, #fff)',
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            تلاش دوباره
          </button>
        </main>
      </body>
    </html>
  );
}
