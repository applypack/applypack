import type { Context, MiddlewareHandler } from 'hono';
import { flashRedirect } from './flash';
import { beginOnce, endOnce } from './inflight';
import { t } from '../i18n/t';

/**
 * A route that starts work — an AI call, a new row, a test message — refuses
 * a second press while the first is still in this process. The key names the
 * work; `back` is where the refused press lands with its one-line reason.
 */
export function onceGuard(key: (c: Context) => string, back: (c: Context) => string): MiddlewareHandler {
  return async (c, next) => {
    const k = key(c);
    if (!beginOnce(k)) return flashRedirect(back(c), 'warn', t('common.alreadyRunning'));
    try {
      await next();
    } finally {
      endOnce(k);
    }
  };
}
