import type { Context, MiddlewareHandler } from 'hono';
import { logger } from '../logger';
import { t } from '../i18n/t';
import { SOURCE_LOCALE, matchAcceptLanguage, offeredLocales, withLocale } from '../i18n/locale';
import { hostAllowed } from '../dashboard-host';
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
    return c.text(refusal(c, () => t('http.crossOrigin')), 403);
  };
}

/**
 * Every request, read or write, under a name the dashboard answers to
 * (dashboard-host.ts). A page on someone else's name that resolves to this
 * machine is same-origin to the browser, so the guard above lets it write and
 * nothing stops it reading; refusing the name stops both.
 */
export function hostGuard(allowed: readonly string[]): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header('host');
    if (hostAllowed(host, allowed)) return next();
    logger.warn({ method: c.req.method, path: c.req.path, host }, 'web: request under an unknown host name refused');
    return c.text(refusal(c, () => t('http.unknownHost', { host: host ?? '' })), 403);
  };
}

/**
 * Both refusals answer before the language middleware (app.ts), which reads
 * the stored language from the database; they read the browser's own instead,
 * so a refused page is not the one English line on a Ukrainian dashboard (#652).
 */
function refusal(c: Context, words: () => string): string {
  return withLocale(matchAcceptLanguage(c.req.header('accept-language'), offeredLocales()) ?? SOURCE_LOCALE, words);
}
