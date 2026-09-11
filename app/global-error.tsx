'use client';

import { useEffect } from 'react';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[momsat] Unhandled application error');
  }, []);

  return (
    <html lang="fa" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#090b10',
          color: '#f4f7fb',
          fontFamily: 'Tahoma, Arial, sans-serif',
          padding: '24px',
        }}
      >
        <main style={{ width: 'min(560px, 100%)', textAlign: 'center' }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: '#ff315b', fontWeight: 900, marginBottom: 12 }}>
            MOMSAT
          </div>
          <h1 style={{ margin: '0 0 12px', fontSize: 30 }}>یک خطای غیرمنتظره رخ داد</h1>
          <p style={{ margin: '0 0 24px', color: '#95a0b1', lineHeight: 1.9 }}>
            صفحه نتوانست کامل بارگذاری شود. می‌توانید دوباره تلاش کنید یا صفحه را تازه‌سازی کنید.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              border: 0,
              borderRadius: 10,
              padding: '11px 18px',
              background: '#ff315b',
              color: '#fff',
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
