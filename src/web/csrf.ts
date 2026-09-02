import type { Context, MiddlewareHandler } from 'hono';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfOptions {
  logger?: { warn: (obj: Record<string, unknown>, msg: string) => void };
}

/**
 * Validates that mutating requests originate from the same host/port.
 * Blocks cross-site attacks via Sec-Fetch-Site, Origin, and Referer header checks.
 */
export function csrfProtection(options: CsrfOptions = {}): MiddlewareHandler {
  let log = options.logger;

  return async (c: Context, next) => {
    if (SAFE_METHODS.has(c.req.method)) {
      return next();
    }

    if (!log) {
      try {
        log = (await import('../logger')).logger;
      } catch {
        // In environments without DB configuration (e.g. isolated unit tests), skip logger
      }
    }

    const secFetchSite = c.req.header('sec-fetch-site');

    // 1. Explicit cross-site Fetch Metadata header check.
    if (secFetchSite === 'cross-site') {
      log?.warn(
        { path: c.req.path, method: c.req.method, secFetchSite },
        'csrf: blocked cross-site request via Sec-Fetch-Site',
      );
      return c.text('Forbidden: Cross-site request rejected', 403);
    }

    const rawForwarded = c.req.header('x-forwarded-host');
    const host = (rawForwarded ? rawForwarded.split(',')[0]?.trim() : null) || c.req.header('host') || '';

    // 2. Origin header check when present.
    const origin = c.req.header('origin');
    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (!host || originUrl.host.toLowerCase() !== host.toLowerCase()) {
          log?.warn(
            { path: c.req.path, method: c.req.method },
            'csrf: blocked request due to origin/host mismatch',
          );
          return c.text('Forbidden: Invalid request origin', 403);
        }
      } catch {
        log?.warn(
          { path: c.req.path, method: c.req.method },
          'csrf: blocked malformed origin',
        );
        return c.text('Forbidden: Malformed Origin header', 403);
      }
      return next();
    }

    // 3. Sec-Fetch-Site same-origin or none (direct user action) passes.
    if (secFetchSite === 'same-origin' || secFetchSite === 'none') {
      return next();
    }

    // 4. Referer fallback check if present.
    const referer = c.req.header('referer');
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        if (!host || refererUrl.host.toLowerCase() !== host.toLowerCase()) {
          log?.warn(
            { path: c.req.path, method: c.req.method },
            'csrf: blocked request due to referer/host mismatch',
          );
          return c.text('Forbidden: Invalid request referer', 403);
        }
      } catch {
        log?.warn(
          { path: c.req.path, method: c.req.method },
          'csrf: blocked malformed referer',
        );
        return c.text('Forbidden: Malformed Referer header', 403);
      }
      return next();
    }

    // 5. Non-browser HTTP clients (curl, automated tests) without browser headers.
    return next();
  };
}
