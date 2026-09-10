import type { Context, MiddlewareHandler } from 'hono';
import { flashRedirect } from './flash';
import { beginOnce, endOnce } from './inflight';

/**
 * A route that starts work — an AI call, a new row, a test message — refuses
 * a second press while the first is still in this process. The key names the
 * work; `back` is where the refused press lands with its one-line reason.
 */
export function onceGuard(key: (c: Context) => string, back: (c: Context) => string): MiddlewareHandler {
  return async (c, next) => {
    const k = key(c);
    if (!beginOnce(k)) return flashRedirect(back(c), 'warn', 'That is already running — give it a moment.');
    try {
      await next();
    } finally {
      endOnce(k);
    }
  };
}
