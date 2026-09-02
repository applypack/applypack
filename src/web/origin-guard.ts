import type { MiddlewareHandler } from 'hono';
import { logger } from '../logger';
import { guardedMethod, sameOriginPost } from './same-origin';

/*
 * The middleware half of the cross-origin write guard (issue #69). The
 * decision is pure and lives in same-origin.ts; this reads the four headers
 * it needs off the request and turns a refusal into a 403.
 *
 * It exists as its own module because the first version of it lived inline in
 * server.ts, where nothing could test it: when the check learned to read
 * `Referer` and `X-Forwarded-Host` (PR #87), the pure module and its tests
 * were updated and the inline reader was not, so the running dashboard quietly
 * kept the old behaviour with a green suite. server.ts cannot be imported by a
 * test — it starts listening — so the wiring gets a seam of its own.
 */
export function originGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (!guardedMethod(c.req.method)) return next();
    const verdict = sameOriginPost({
      origin: c.req.header('origin'),
      secFetchSite: c.req.header('sec-fetch-site'),
      host: c.req.header('host'),
      forwardedHost: c.req.header('x-forwarded-host'),
      referer: c.req.header('referer'),
    });
    if (verdict.ok) return next();
    logger.warn(
      { method: c.req.method, path: c.req.path, reason: verdict.reason },
      'web: cross-origin write refused',
    );
    return c.text('Cross-origin request refused.', 403);
  };
}
