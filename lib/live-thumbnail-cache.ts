'use client';

export type LiveThumbnailStatus = 'online' | 'offline' | 'loading';
export type LiveThumbnailEntry = {
  channelId: number;
  dataUrl: string | null;
  sourceUrl: string | null;
  status: LiveThumbnailStatus;
  updatedAt: number;
  failures: number;
};

const DB_NAME = 'momsat-live-thumbnails-v1';
const STORE_NAME = 'thumbnails';
const DB_VERSION = 1;

// Keep the last successful snapshot indefinitely in the browser.
// Freshness is decided by the catalog, not by deleting the cached image.
const STALE_AFTER_MS = 6 * 60 * 60_000;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'channelId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getLiveThumbnail(channelId: number): Promise<LiveThumbnailEntry | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(channelId);
      request.onsuccess = () => {
        const value = request.result as LiveThumbnailEntry | undefined;
        if (!value) {
          resolve(null);
          return;
        }

        // Never discard the last known image because it is old.
        // The caller decides whether it needs a background refresh.
        resolve(value);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function setLiveThumbnail(entry: LiveThumbnailEntry): Promise<void> {
  const db = await openDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearLiveThumbnails(): Promise<void> {
  const db = await openDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// Public for the catalog's refresh decision. The cache itself never deletes stale images.
export const LIVE_THUMBNAIL_MAX_AGE_MS = STALE_AFTER_MS;
