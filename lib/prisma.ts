import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

function withPgTimeouts(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return value;
    if (!url.searchParams.has('connect_timeout')) {
      url.searchParams.set('connect_timeout', String(Math.max(1, Number(process.env.DB_CONNECT_TIMEOUT_SEC || 2))));
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', String(Math.max(1, Number(process.env.DB_POOL_TIMEOUT_SEC || 2))));
    }
    return url.toString();
  } catch {
    return value;
  }
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const prisma = global.prisma ?? new PrismaClient(
  databaseUrl ? { datasources: { db: { url: withPgTimeouts(databaseUrl) } } } : undefined,
);

export { prisma };

if (process.env.NODE_ENV !== 'production') global.prisma = prisma;
