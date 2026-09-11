'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import PlayerProEnhanced from './PlayerProEnhanced';
import StreamAccelerator from './StreamAccelerator';
import styles from './PersistentPlayerProvider.module.css';

type Source = { url: string; title?: string | null; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean };
export type PersistentChannel = { id?: number; name?: string; image?: string | null; url?: string | null; referer?: string | null; origin?: string | null; sources?: Source[] };
type PlayerHostRect = { top: number; left: number; width: number; height: number };
type CatalogResponse = { channels?: PersistentChannel[] };
type MiniPosition = { left: number; top: number };

 type PersistentPlayerContextValue = {
  activeChannel: PersistentChannel | null;
  expanded: boolean;
  setActiveChannel: (channel: PersistentChannel) => void;
  stopPlayer: () => void;
  registerPlayerHost: (element: HTMLElement | null) => void;
};

const STORAGE_KEY = 'momsat.persistent-player.v1';
const MINI_POSITION_KEY = 'momsat.persistent-player.position.v1';
const MINI_WIDTH = 420;
const MINI_GAP = 16;
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

function clampMiniPosition(position: MiniPosition, width = MINI_WIDTH, height = 244) {
  if (typeof window === 'undefined') return position;
  const maxLeft = Math.max(MINI_GAP, window.innerWidth - width - MINI_GAP);
  const maxTop = Math.max(MINI_GAP, window.innerHeight - height - MINI_GAP);
  return {
    left: Math.min(Math.max(MINI_GAP, position.left), maxLeft),
    top: Math.min(Math.max(MINI_GAP, position.top), maxTop),
  };
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
  const [miniPosition, setMiniPosition] = useState<MiniPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const catalogPromiseRef = useRef<Promise<PersistentChannel[]> | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

  const expanded = isCurrentChannelPage(pathname, activeChannel);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setActiveChannelState(JSON.parse(raw) as PersistentChannel);
      const savedPosition = localStorage.getItem(MINI_POSITION_KEY);
      if (savedPosition) {
        const parsed = JSON.parse(savedPosition) as MiniPosition;
        if (Number.isFinite(parsed.left) && Number.isFinite(parsed.top)) setMiniPosition(clampMiniPosition(parsed));
      }
    } catch {}
  }, []);

  useEffect(() => {
    const ensurePosition = () => {
      setMiniPosition((current) => {
        if (current) return clampMiniPosition(current);
        if (typeof window === 'undefined') return current;
        return clampMiniPosition({
          left: window.innerWidth - MINI_WIDTH - MINI_GAP,
          top: window.innerHeight - 244 - MINI_GAP,
        });
      });
    };
    ensurePosition();
    window.addEventListener('resize', ensurePosition, { passive: true });
    return () => window.removeEventListener('resize', ensurePosition);
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

  const loadCatalog = useCallback(async () => {
    if (!catalogPromiseRef.current) {
      catalogPromiseRef.current = fetch('/api/catalog', { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error(`catalog request failed: ${response.status}`);
          const body = await response.json() as CatalogResponse;
          return Array.isArray(body.channels) ? body.channels : [];
        })
        .finally(() => {
          catalogPromiseRef.current = null;
        });
    }
    return catalogPromiseRef.current;
  }, []);

  useEffect(() => {
    const onChannelLinkClick = (event: MouseEvent) => {
      if (!activeChannel || collapsed) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null;
      if (!target) return;
      const href = target.getAttribute('href') || '';
      const match = href.match(/^\/channel\/(\d+)\/?(?:\?.*)?$/);
      if (!match) return;

      event.preventDefault();
      event.stopPropagation();
      const channelId = Number(match[1]);
      if (!Number.isFinite(channelId)) return;

      void loadCatalog().then((channels) => {
        const channel = channels.find((item) => Number(item.id) === channelId);
        if (channel) setActiveChannel(channel);
      }).catch(() => undefined);
    };

    document.addEventListener('click', onChannelLinkClick, true);
    return () => document.removeEventListener('click', onChannelLinkClick, true);
  }, [activeChannel, collapsed, loadCatalog, setActiveChannel]);

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
    if (!miniPosition) return;
    try { localStorage.setItem(MINI_POSITION_KEY, JSON.stringify(miniPosition)); } catch {}
  }, [miniPosition]);

  useEffect(() => {
    if (!activeChannel || collapsed) return;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(activeChannel)); } catch {}
  }, [activeChannel, collapsed]);

  const handleMiniPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (expanded || !miniPosition) return;
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [expanded, miniPosition]);

  const handleMiniPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || expanded) return;
    const next = clampMiniPosition({
      left: event.clientX - drag.offsetX,
      top: event.clientY - drag.offsetY,
    });
    setMiniPosition(next);
  }, [expanded]);

  const endMiniDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch {}
  }, []);

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
      } : miniPosition ? {
        left: miniPosition.left,
        top: miniPosition.top,
      } : undefined}
      aria-label="MOMSAT player"
    >
      <div className={styles.inner}>
        <div
          className={`${styles.dragHandle} ${dragging ? styles.dragging : ''}`}
          onPointerDown={handleMiniPointerDown}
          onPointerMove={handleMiniPointerMove}
          onPointerUp={endMiniDrag}
          onPointerCancel={endMiniDrag}
          role="presentation"
        />
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
