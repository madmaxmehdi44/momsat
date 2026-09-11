import type { ReactNode } from 'react';
import ControlCenterNav from './ControlCenterNav';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="momsat-admin-zone">
      <ControlCenterNav />
      {children}
    </div>
  );
}
