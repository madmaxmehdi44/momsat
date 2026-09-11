'use client';

import { createContext, createPortal, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import PlayerProEnhanced from './PlayerProEnhanced';
import StreamAccelerator from './StreamAccelerator';
import styles from './PersistentPlayerProvider.module.css';

type Source = { url: string; title?: string | null; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean };
export type PersistentChannel = { id?: number; name?: string; image?: string | null; url?: string | null; referer?: string | null; origin?: string | null; sources?: Source[] };
type PlayerHostRect = { top: number; left: number; width: number; height: number };

type PersistentPlayerContextValue = {
  activeChannel: PersistentChannel | null;
  expanded: boolean;
  setActiveChannel: (channel: PersistentChannel) => void;
  stopPlayer: () => void;
  registerPlayerHost: (element: HTMLElement | null) => void;
};

const STORAGE_KEY = 'momsat.persistent-player.v1';
const PersistentPlayerContext = createContext<PersistentPlayerContextValue | null>(null);

function channelKey(channel: PersistentChannel) {
  return JSON.stringify({
    id: channel.id ?? null,
    name: channel.name ?? '',
    image: channel.image ?? null,
    url: channel.url ?? null,
    referer: channel.referer ?? null,
    origin: channel.origin ?? null,
    sources: (channel.sources ?? []).map((source) => ({
      url: source.url,
      title: source.title ?? null,
      referer: source.referer ?? null,
      origin: source.origin ?? null,
      country: source.country ?? null,
      vip: source.vip ?? false,
    })),
  });
}

function isCurrentChannelPage(pathname: string | null, channel: PersistentChannel | null) {
  if (!pathname || channel?.id == null) return false;
  const normalized = pathname.replace(/\/+$/, '');
  return normalized === `/channel/${channel.id}`;
}

export function usePersistentPlayer() {
  const value = useContext(PersistentPlayerContext);
  if (!value) throw new Error('usePersistentPlayer must be used inside PersistentPlayerProvider');
  return value;
}

export default function PersistentPlayerProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [activeChannel, setActiveChannelState] = useState<PersistentChannel | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [playerHost, setPlayerHost] = useState<HTMLElement | null>(null);
  const [hostRect, setHostRect] = useState<PlayerHostRect | null>(null);

  const expanded = isCurrentChannelPage(pathname, activeChannel);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setActiveChannelState(JSON.parse(raw) as PersistentChannel);
    } catch {}
  }, []);

  const setActiveChannel = useCallback((channel: PersistentChannel) => {
    setCollapsed(false);
    setActiveChannelState((current) => {
      if (current && channelKey(current) === channelKey(channel)) return current;
      return channel;
    });
  }, []);

  const stopPlayer = useCallback(() => {
    setCollapsed(true);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  const registerPlayerHost = useCallback((element: HTMLElement | null) => {
    setPlayerHost((current) => current === element ? current : element);
  }, []);

  useEffect(() => {
    if (!expanded || !playerHost) {
      setHostRect(null);
      return;
    }

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = playerHost.getBoundingClientRect();
        setHostRect({
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width,
          height: rect.height,
        });
      });
    };

    const observer = new ResizeObserver(update);
    observer.observe(playerHost);
    window.addEventListener('resize', update, { passive: true });
    window.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
    };
  }, [expanded, playerHost]);

  useEffect(() => {
    document.body.style.paddingBottom = activeChannel && !collapsed && !expanded ? '112px' : '';
    return () => { document.body.style.paddingBottom = ''; };
  }, [activeChannel, collapsed, expanded]);

  useEffect(() => {
    if (!activeChannel || collapsed) return;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(activeChannel)); } catch {}
  }, [activeChannel, collapsed]);

  const value = useMemo(() => ({
    activeChannel,
    expanded,
    setActiveChannel,
    stopPlayer,
    registerPlayerHost,
  }), [activeChannel, expanded, setActiveChannel, stopPlayer, registerPlayerHost]);

  const portalTarget = typeof document !== 'undefined' ? document.body : null;
  const canRenderPlayer = Boolean(activeChannel && !collapsed && portalTarget && (!expanded || hostRect));
  const player = canRenderPlayer ? createPortal(
    <aside
      className={`${styles.root} ${expanded ? styles.expanded : styles.mini}`}
      style={expanded && hostRect ? {
        top: hostRect.top,
        left: hostRect.left,
        width: hostRect.width,
        height: hostRect.height,
      } : undefined}
      aria-label="MOMSAT player"
    >
      <div className={styles.inner}>
        <StreamAccelerator urls={(activeChannel?.sources ?? []).map((source) => source.url)} />
        <PlayerProEnhanced channel={activeChannel!} />
        <button className={styles.close} type="button" onClick={stopPlayer} aria-label="بستن پلیر شناور">×</button>
        {!expanded && <div className={styles.nowPlaying} dir="rtl"><strong>{activeChannel?.name || 'MOMSAT'}</strong><span>در حال پخش</span></div>}
      </div>
    </aside>,
    portalTarget!,
  ) : null;

  return (
    <PersistentPlayerContext.Provider value={value}>
      {children}
      {player}
    </PersistentPlayerContext.Provider>
  );
}
