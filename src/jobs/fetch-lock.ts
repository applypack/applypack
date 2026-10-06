import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '../config';
import { singleConnectionUrl } from '../db-url';

/**
 * One fetch at a time across processes (ADR 0003, addendum 2026-09-28). The
 * worker's tick, the monthly HN pull, "Fetch now" in the dashboard and
 * `fetch-once.js` all take this Postgres advisory lock before they read a
 * source, deliver a held alert or classify anything; the one that cannot
 * take it does nothing, so no posting is classified — and paid for — twice.
 *
 * A session lock belongs to the connection that took it, and the shared
 * client pools its connections, so the lock lives on a client of its own
 * with exactly one. A crash closes that connection, and Postgres drops the
 * lock with it: nothing stale is ever left behind.
 */
const FETCH_LOCK_KEY = 0x41504b46; // "APKF": any constant the rest of the database does not use

export interface FetchLock {
  release(): Promise<void>;
}

/** The lock, or null when another fetch holds it. */
export function tryFetchLock(): Promise<FetchLock | null> {
  return tryAdvisoryLock(FETCH_LOCK_KEY);
}

/** The same kind of lock under another key, for a job with a queue of its own to guard (jobs/pack-job.ts). */
export async function tryAdvisoryLock(key: number): Promise<FetchLock | null> {
  const client = new PrismaClient({ datasourceUrl: singleConnectionUrl(config.DATABASE_URL) });
  let taken = false;
  try {
    const [row] = await client.$queryRaw<{ taken: boolean }[]>(
      Prisma.sql`SELECT pg_try_advisory_lock(${key}::bigint) AS taken`,
    );
    taken = row?.taken === true;
  } finally {
    if (!taken) await client.$disconnect();
  }
  if (!taken) return null;
  return {
    async release() {
      try {
        await client.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(${key}::bigint)`);
      } finally {
        await client.$disconnect();
      }
    },
  };
}
