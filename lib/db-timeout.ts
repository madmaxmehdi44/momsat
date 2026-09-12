import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

const DEFAULT_DB_READ_TIMEOUT_MS = Math.max(750, Number(process.env.DB_READ_TIMEOUT_MS || 1500));
const DEFAULT_DB_MAX_WAIT_MS = Math.max(250, Number(process.env.DB_MAX_WAIT_MS || 500));

export async function withDbReadTimeout<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  timeoutMs = DEFAULT_DB_READ_TIMEOUT_MS,
) {
  const effectiveTimeout = Math.max(250, Math.floor(timeoutMs));
  const transactionTimeout = effectiveTimeout + 750;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${effectiveTimeout}`);
    return operation(tx);
  }, {
    maxWait: DEFAULT_DB_MAX_WAIT_MS,
    timeout: transactionTimeout,
  });
}

export function dbReadTimeoutMs() {
  return DEFAULT_DB_READ_TIMEOUT_MS;
}
