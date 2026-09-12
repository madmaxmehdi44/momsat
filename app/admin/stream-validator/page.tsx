'use client';

import { useState } from 'react';
import Link from 'next/link';
import styles from './stream-validator.module.css';

const TOKEN_KEY = 'momsat.admin.token';

type SyncResult = {
  threshold: number;
  discovered: number;
  candidates: number;
  checked: number;
  healthy95: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedBelow95: number;
  duplicateChannels: number;
  sourcesAdded: number;
  suspect: number;
  broken: number;
  sourceErrors: number;
  durationMs: number;
};

export default function StreamValidatorPage() {
  const [token, setToken] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState('');

  async function runAutoSync() {
    if (running) return;
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/admin/stream-validator', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token.trim() ? { 'x-admin-token': token.trim() } : {}),
        },
        body: JSON.stringify({ action: 'auto-sync' }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'همگام‌سازی استریم ناموفق بود');
      setResult(body as SyncResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطای نامشخص');
    } finally {
      setRunning(false);
    }
  }

  return (
    <main dir="rtl" className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>MOMSAT · AUTO STREAM SYNC</div>
            <h1 className={styles.title}>صحت‌سنجی و افزودن خودکار کانال‌ها</h1>
            <p className={styles.description}>
              منابع کانال‌ها در سمت سرور بررسی می‌شوند. فقط استریم‌های واقعی با امتیاز حداقل ۹۵ از ۱۰۰ وارد کاتالوگ می‌شوند؛ کانال تکراری ساخته نمی‌شود و برای کانال موجود، بهترین لینکِ اثبات‌شده انتخاب می‌شود.
            </p>
          </div>
          <Link href="/admin" className={styles.back}>بازگشت به مدیریت</Link>
        </header>

        <section className={styles.toolbar}>
          <input
            className={styles.token}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              try { localStorage.setItem(TOKEN_KEY, e.target.value); } catch {}
            }}
            placeholder="ADMIN_TOKEN در صورت نیاز"
            type="password"
          />
          <button className={styles.primary} disabled={running} onClick={() => void runAutoSync()}>
            {running ? 'در حال اسکن و همگام‌سازی…' : 'اجرای همگام‌سازی خودکار'}
          </button>
        </section>

        {running && (
          <div className={styles.progress}>
            <div className={styles.progressTop}>
              <span>در حال کشف، بررسی و مقایسه لینک‌های استریم…</span>
              <strong>95+</strong>
            </div>
            <div className={styles.progressTrack}><div className={styles.progressBar} style={{ width: '72%' }} /></div>
            <p>لیست کامل کانال‌ها به مرورگر منتقل نمی‌شود؛ نتیجه نهایی مستقیماً از موتور سمت سرور ثبت می‌شود.</p>
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}

        {result && (
          <>
            <div className={styles.success}>
              ✅ همگام‌سازی تمام شد: {result.created.toLocaleString('fa-IR')} کانال جدید اضافه شد، {result.updated.toLocaleString('fa-IR')} کانال با لینک بهتر به‌روزرسانی شد و {result.unchanged.toLocaleString('fa-IR')} کانال بدون تغییر ماند.
            </div>

            <section className={styles.stats}>
              <div className={styles.stat}><span>کشف‌شده</span><strong>{result.discovered.toLocaleString('fa-IR')}</strong></div>
              <div className={styles.stat}><span>تست‌شده</span><strong>{result.checked.toLocaleString('fa-IR')}</strong></div>
              <div className={styles.stat}><span>۹۵٪+</span><strong>{result.healthy95.toLocaleString('fa-IR')}</strong></div>
              <div className={styles.stat}><span>جدید</span><strong>{result.created.toLocaleString('fa-IR')}</strong></div>
              <div className={styles.stat}><span>لینک بهتر</span><strong>{result.updated.toLocaleString('fa-IR')}</strong></div>
              <div className={styles.stat}><span>زیر ۹۵٪</span><strong>{result.skippedBelow95.toLocaleString('fa-IR')}</strong></div>
            </section>

            <div className={styles.description} style={{ marginTop: 16 }}>
              {result.sourcesAdded.toLocaleString('fa-IR')} لینک جدید ذخیره شد · {result.duplicateChannels.toLocaleString('fa-IR')} مورد تکراری ادغام شد · {result.suspect.toLocaleString('fa-IR')} مشکوک · {result.broken.toLocaleString('fa-IR')} خراب · زمان اجرا {Math.round(result.durationMs / 1000).toLocaleString('fa-IR')} ثانیه
            </div>
          </>
        )}

        {!running && !result && !error && (
          <div className={styles.empty}>
            موتور اعتبارسنجی آماده است. با اجرای عملیات، منابع موجود کشف می‌شوند، کانال‌های تکراری با تطبیق نام/URL شناسایی می‌شوند و فقط گزینه‌های ۹۵٪ به بالا به‌صورت خودکار در دیتابیس ثبت یا به لینک بهتر ارتقا داده می‌شوند.
          </div>
        )}
      </div>
    </main>
  );
}
