'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import PlayerProEnhanced from './PlayerProEnhanced';
import StreamAccelerator from './StreamAccelerator';
import StreamHealthObserver from './StreamHealthObserver';
import styles from './PersistentPlayerProvider.module.css';

type Source = { url: string; title?: string | null; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean };
export type PersistentChannel = { id?: number; channelId?: number; name?: string; image?: string | null; url?: string | null; referer?: string | null; origin?: string | null; sources?: Source[] };
type PlayerHostRect = { top: number; left: number; width: number; height: number };
type CatalogResponse = { channels?: PersistentChannel[] };
type MiniPosition = { left: number; top: number };
type PlaybackFailureDetail = { channelId: number; url: string; reason?: string };

type PersistentPlayerContextValue = {
  activeChannel: PersistentChannel | null;
  expanded: boolean;
  setActiveChannel: (channel: PersistentChannel) => void;
  play: (channel: PersistentChannel) => void;
  stopPlayer: () => void;
  registerPlayerHost: (element: HTMLElement | null) => void;
};

const STORAGE_KEY = 'momsat.persistent-player.v1';
const MINI_POSITION_KEY = 'momsat.persistent-player.position.v1';
const MINI_WIDTH = 420;
const MINI_GAP = 16;
const PersistentPlayerContext = createContext<PersistentPlayerContextValue | null>(null);

function persistentChannelId(channel: PersistentChannel | null | undefined) {
  const id = channel?.id ?? channel?.channelId;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

function channelKey(channel: PersistentChannel) {
  return JSON.stringify({ id: persistentChannelId(channel), name: channel.name ?? '', image: channel.image ?? null, url: channel.url ?? null, referer: channel.referer ?? null, origin: channel.origin ?? null, sources: (channel.sources ?? []).map((source) => ({ url: source.url, title: source.title ?? null, referer: source.referer ?? null, origin: source.origin ?? null, country: source.country ?? null, vip: source.vip ?? false })) });
}

function isCurrentWatchRoute(pathname: string | null, channel: PersistentChannel | null) {
  const id = persistentChannelId(channel);
  if (!pathname || id == null) return false;
  const normalized = pathname.replace(/\/+$/, '');
  return normalized === `/channel/${id}` || normalized === '/watch';
}

function clampMiniPosition(position: MiniPosition, width = MINI_WIDTH, height = 244) {
  if (typeof window === 'undefined') return position;
  const maxLeft = Math.max(MINI_GAP, window.innerWidth - width - MINI_GAP);
  const maxTop = Math.max(MINI_GAP, window.innerHeight - height - MINI_GAP);
  return { left: Math.min(Math.max(MINI_GAP, position.left), maxLeft), top: Math.min(Math.max(MINI_GAP, position.top), maxTop) };
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
  const failoverHistoryRef = useRef<Map<number, Set<string>>>(new Map());
  const activeChannelRef = useRef<PersistentChannel | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const expanded = isCurrentWatchRoute(pathname, activeChannel);

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
    const ensurePosition = () => setMiniPosition((current) => {
      if (current) return clampMiniPosition(current);
      return clampMiniPosition({ left: window.innerWidth - MINI_WIDTH - MINI_GAP, top: window.innerHeight - 244 - MINI_GAP });
    });
    ensurePosition();
    window.addEventListener('resize', ensurePosition);
    return () => window.removeEventListener('resize', ensurePosition);
  }, []);

  useEffect(() => {
    activeChannelRef.current = activeChannel;
  }, [activeChannel]);

  const setActiveChannel = useCallback((channel: PersistentChannel) => {
    const nextId = persistentChannelId(channel);
    const currentId = persistentChannelId(activeChannelRef.current);
    if (nextId != null && nextId !== currentId) failoverHistoryRef.current.delete(nextId);
    setActiveChannelState(channel);
  }, []);

  const stopPlayer = useCallback(() => setActiveChannelState(null), []);

  const loadCatalog = useCallback(async () => {
    if (catalogPromiseRef.current) return catalogPromiseRef.current;
    const promise = fetch('/api/catalog', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<CatalogResponse> : ({ channels: [] }))
      .then((body) => body.channels ?? [])
      .catch(() => [])
      .finally(() => { catalogPromiseRef.current = null; });
    catalogPromiseRef.current = promise;
    return promise;
  }, []);

  const play = useCallback((channel: PersistentChannel) => {
    setActiveChannel(channel);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(channel)); } catch {}
  }, [setActiveChannel]);

  useEffect(() => {
    try {
      if (activeChannel) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(activeChannel));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [activeChannel]);

  useEffect(() => {
    const handlePlaybackFailure = (event: Event) => {
      const detail = (event as CustomEvent<PlaybackFailureDetail>).detail;
      const current = activeChannelRef.current;
      const channelId = persistentChannelId(current);
      if (!detail || !current || channelId == null || detail.channelId !== channelId || !detail.url) return;

      const allSources = Array.from(new Map(
        [
          ...(current.url ? [{ url: current.url, referer: current.referer, origin: current.origin }] : []),
          ...(current.sources ?? []),
        ].map((source) => [source.url.trim(), source]).filter(([url]) => Boolean(url)),
      ).values());
      if (allSources.length <= 1) return;

      const failedUrl = detail.url.trim();
      const history = failoverHistoryRef.current.get(channelId) ?? new Set<string>();
      history.add(failedUrl);
      failoverHistoryRef.current.set(channelId, history);

      const currentIndex = allSources.findIndex((source) => source.url.trim() === failedUrl);
      const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
      const next = [...allSources.slice(startIndex), ...allSources.slice(0, startIndex)]
        .find((source) => !history.has(source.url.trim()));
      if (!next) return;

      const others = allSources.filter((source) => source.url.trim() !== next.url.trim());
      setActiveChannel({ ...current, url: next.url, referer: next.referer ?? null, origin: next.origin ?? null, sources: [next, ...others] });
    };

    window.addEventListener('momsat:playback-failure', handlePlaybackFailure);
    return () => window.removeEventListener('momsat:playback-failure', handlePlaybackFailure);
  }, [setActiveChannel]);

  const registerPlayerHost = useCallback((element: HTMLElement | null) => setPlayerHost(element), []);

  useEffect(() => {
    if (!playerHost) { setHostRect(null); return; }
    const update = () => {
      const rect = playerHost.getBoundingClientRect();
      setHostRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(playerHost);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [playerHost]);

  const value = useMemo<PersistentPlayerContextValue>(() => ({ activeChannel, expanded, setActiveChannel, play, stopPlayer, registerPlayerHost }), [activeChannel, expanded, setActiveChannel, play, stopPlayer, registerPlayerHost]);

  const player = activeChannel && miniPosition ? <>
    <StreamHealthObserver channel={activeChannel} />
    <StreamAccelerator channel={activeChannel} />
    <div
      className={`${styles.floatingPlayer}${collapsed ? ` ${styles.collapsed}` : ''}`}
      style={expanded && hostRect ? { left: hostRect.left, top: hostRect.top, width: hostRect.width, height: hostRect.height } : { left: miniPosition.left, top: miniPosition.top, width: MINI_WIDTH }}
      onPointerDown={(event) => {
        if (expanded || event.button !== 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!dragRef.current || dragRef.current.pointerId !== event.pointerId || expanded) return;
        setMiniPosition(clampMiniPosition({ left: event.clientX - dragRef.current.offsetX, top: event.clientY - dragRef.current.offsetY }));
      }}
      onPointerUp={(event) => {
        if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setDragging(false);
        try {
          const next = miniPosition ? clampMiniPosition(miniPosition) : null;
          if (next) localStorage.setItem(MINI_POSITION_KEY, JSON.stringify(next));
        } catch {}
      }}
    >
      {!expanded && <button type="button" className={styles.collapseButton} onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'باز کردن پخش‌کننده' : 'کوچک کردن پخش‌کننده'}>{collapsed ? '+' : '−'}</button>}
      <PlayerProEnhanced channel={activeChannel} />
    </div>
  </> : null;

  return <PersistentPlayerContext.Provider value={value}>
    {children}
    {player && createPortal(player, document.body)}
  </PersistentPlayerContext.Provider>;
}
