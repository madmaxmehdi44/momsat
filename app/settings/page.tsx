import Link from 'next/link';
import SettingsClient from './SettingsClient';

export const metadata = {
  title: 'تنظیمات — MOMSAT',
  description: 'تنظیمات عمومی و Player Pro در MOMSAT',
};

export default function SettingsPage() {
  return (
    <>
      <header className="top settings-top"><div><div className="brand">MOM<span>SAT</span></div><div className="muted">Persian Live TV Discovery</div></div><nav><Link href="/">خانه</Link><Link href="/browse">شبکه‌ها</Link><Link href="/guide">راهنما</Link><Link href="/settings">تنظیمات</Link><Link href="/admin">مدیریت</Link></nav></header>
      <SettingsClient />
    </>
  );
}
