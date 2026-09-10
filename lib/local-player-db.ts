export type LocalPlayerUser = {
  id: string;
  createdAt: number;
};

export type LocalPlayerSession = {
  id: string;
  userId: string;
  channelId?: number | null;
  channelName: string;
  sourceUrl: string;
  mode: 'proxy' | 'direct';
  startedAt: number;
  endedAt?: number;
  durationSec: number;
  bytes: number;
  estimatedBytes: boolean;
  bitrateKbps?: number;
  completed: boolean;
  updatedAt: number;
};

export type LocalPlayerStats = {
  sessions: number;
  totalDurationSec: number;
  totalBytes: number;
};

const DB_NAME = 'momsat-local';
const DB_VERSION = 1;
const USER_KEY = 'local-user';

type StoredUser = {
  id: string;
  userId: string;
  createdAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sessions')) {
        const store = db.createObjectStore('sessions', { keyPath: 'id' });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open local player database'));
  });
}

export async function getLocalPlayerUser(): Promise<LocalPlayerUser> {
  const db = await openDb();
  try {
    const existing = await new Promise<StoredUser | undefined>((resolve, reject) => {
      const request = db.transaction('users', 'readonly').objectStore('users').get(USER_KEY);
      request.onsuccess = () => resolve(request.result as StoredUser | undefined);
      request.onerror = () => reject(request.error);
    });
    if (existing?.userId) return { id: existing.userId, createdAt: existing.createdAt };

    const user: LocalPlayerUser = { id: crypto.randomUUID(), createdAt: Date.now() };
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction('users', 'readwrite').objectStore('users').put({ id: USER_KEY, userId: user.id, createdAt: user.createdAt } satisfies StoredUser);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    return user;
  } finally {
    db.close();
  }
}

export async function saveLocalPlayerSession(session: LocalPlayerSession) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction('sessions', 'readwrite').objectStore('sessions').put(session);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function getLocalPlayerStats(userId: string): Promise<LocalPlayerStats> {
  const db = await openDb();
  try {
    const sessions = await new Promise<LocalPlayerSession[]>((resolve, reject) => {
      const request = db.transaction('sessions', 'readonly').objectStore('sessions').index('userId').getAll(IDBKeyRange.only(userId));
      request.onsuccess = () => resolve((request.result as LocalPlayerSession[]) ?? []);
      request.onerror = () => reject(request.error);
    });
    return sessions.reduce<LocalPlayerStats>((stats, session) => ({
      sessions: stats.sessions + (session.completed ? 1 : 0),
      totalDurationSec: stats.totalDurationSec + Math.max(0, session.durationSec),
      totalBytes: stats.totalBytes + Math.max(0, session.bytes),
    }), { sessions: 0, totalDurationSec: 0, totalBytes: 0 });
  } finally {
    db.close();
  }
}
