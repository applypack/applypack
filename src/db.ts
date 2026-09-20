import { Prisma, PrismaClient } from '@prisma/client';
import { config } from './config';

export const prisma = new PrismaClient({
  // From config rather than the schema's env(): the built-in database's URL
  // comes from db.json when .env has none (ADR 0054).
  datasourceUrl: config.DATABASE_URL,
  log: ['warn', 'error'],
});

/**
 * A unique-constraint violation, whoever raised it (ADR 0053).
 *
 * Every write that races another tab meets P2002, and the four call sites
 * used to spell the check out — or, for the two that did not, answered a
 * second Telegram target or a second company row with a bare 500. One
 * predicate, so a duplicate can be *said* rather than thrown.
 *
 * Read the code, not the message: Prisma's wording changes between versions
 * and is not part of its contract.
 */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Run a write once more if a unique key settled a race in between.
 *
 * The retry, not a catch inside the transaction, is what makes this safe:
 * Postgres aborts a transaction on the first error (25P02), so a read taken
 * on the same `tx` afterwards throws too, and the user saw a 500 instead of
 * "this job is already here" (D4). A fresh attempt starts a fresh
 * transaction, whose own read finds the row the other request committed.
 *
 * Exactly one retry. If the racing write rolled back meanwhile, the second
 * attempt simply succeeds.
 */
export async function retryOnUniqueViolation<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return run();
  }
}
