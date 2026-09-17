import { z } from 'zod';

/*
 * db.json: how to reach the built-in database. Written once by the launcher
 * (mode 0600), read by the launcher and by config.ts, so `npm run dev` and the
 * once-scripts find the database `npm start` or `npm run db` is running. The
 * password only guards a loopback server whose files sit in the same folder
 * (ADR 0054).
 */

export const LOCAL_DB_USER = 'applypack';
/** initdb's own database: the cluster serves ApplyPack alone, so nothing has to create another. */
export const LOCAL_DB_NAME = 'postgres';
/** 5432 is where a Postgres already on the machine answers, 5433 is compose's publish. */
export const PREFERRED_PORT = 5434;

export const DbStateSchema = z.object({
  port: z.number().int().min(1).max(65_535),
  user: z.string().min(1),
  password: z.string().min(16),
});

export type DbState = z.infer<typeof DbStateSchema>;

export function parseDbState(text: string): DbState | null {
  try {
    const parsed = DbStateSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function databaseUrl(state: DbState): string {
  const user = encodeURIComponent(state.user);
  const password = encodeURIComponent(state.password);
  return `postgresql://${user}:${password}@127.0.0.1:${state.port}/${LOCAL_DB_NAME}`;
}

/** DATABASE_URL wins; without one, the built-in database's, if it was ever created. */
export function resolveDatabaseUrl(fromEnv: string | undefined, stateText: string | null): string | undefined {
  if (fromEnv?.trim()) return fromEnv;
  const state = stateText === null ? null : parseDbState(stateText);
  return state ? databaseUrl(state) : undefined;
}
