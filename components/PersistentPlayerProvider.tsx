'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import PlayerProEnhanced from './PlayerProEnhanced';
import styles from './PersistentPlayerProvider.module.css';

type Source = { url: string; title?: string | null; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean };
export type PersistentChannel = { id?: number; name?: string; image?: string | null; url?: string | null; referer?: string | null; origin?: string | null; sources?: Source[] };

type PersistentPlayerContextValue = {
  activeChannel: PersistentChannel | null;
  setActiveChannel: (channel: PersistentChannel) => void;
  stopPlayer: () => void;
};

const PersistentPlayerContext = createContext<PersistentPlayerContextValue | null>(null);

export function usePersistentPlayer() {
  const value = useContext(PersistentPlayerContext);
  if (!value) throw new Error('usePersistentPlayer must be used inside PersistentPlayerProvider');
  return value;
}

export default function PersistentPlayerProvider({ children }: { children: React.ReactNode }) {
  const [activeChannel, setActiveChannelState] = useState<PersistentChannel | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const setActiveChannel = (channel: PersistentChannel) => {
    setCollapsed(false);
    setActiveChannelState(channel);
  };

  const stopPlayer = () => {
    setCollapsed(true);
  };

  useEffect(() => {
    if (!activeChannel) return;
    try {
      sessionStorage.setItem('momsat.persistent-player.v1', JSON.stringify(activeChannel));
    } catch {}
  }, [activeChannel]);

  const value = useMemo(() => ({ activeChannel, setActiveChannel, stopPlayer }), [activeChannel]);

  return (
    <PersistentPlayerContext.Provider value={value}>
      {children}
      {activeChannel && !collapsed ? (
        <aside className={styles.root} aria-label="MOMSAT player">
          <div className={styles.inner}>
            <PlayerProEnhanced channel={activeChannel} />
            <button className={styles.close} type="button" onClick={stopPlayer} aria-label="بستن پلیر شناور">×</button>
          </div>
        </aside>
      ) : null}
    </PersistentPlayerContext.Provider>
  );
}
