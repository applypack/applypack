/*
 * Cross-origin write protection for the dashboard (issue #69).
 *
 * There is no login here, so there is no session for an attacker to ride: the
 * real exposure is a page open in the same browser POSTing to the dashboard on
 * localhost — deleting a resume, flipping a setting, overwriting an AI key —
 * because a form POST needs no permission from the target site. That is what
 * this rejects, and nothing more. Tokens would mean a session store, a hidden
 * field in ~40 forms and a way to break every `curl` the operator has; the
 * headers a browser attaches on its own answer the same question.
 *
 * Pure: the middleware in server.ts hands over three header values and gets a
 * verdict. Reads no request body, so a rejected POST is never even parsed.
 */

export interface OriginCheck {
  /** `Origin` — sent by every browser on a POST, absent for curl and most scripts. */
  origin?: string | null;
  /** `Sec-Fetch-Site` — the browser's own account of where the request came from. */
  secFetchSite?: string | null;
  /** `Host` — what this dashboard is being reached as. */
  host?: string | null;
}

export interface OriginVerdict {
  ok: boolean;
  /** Why, for the log line and the 403 body — never shown to a browser as HTML. */
  reason: string;
}

/**
 * The scheme is deliberately not compared. Behind a TLS-terminating proxy the
 * browser says `https://` while `Host` carries no scheme at all, so demanding
 * a match would reject every real request on such a deployment. The property
 * this needs is that the *host* is ours, which is what an attacker's page
 * cannot forge.
 */
function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether a state-changing request came from the dashboard itself.
 *
 * Accepted:
 * - `Sec-Fetch-Site: same-origin` — the browser vouches for it.
 * - `Sec-Fetch-Site: none` — typed, bookmarked or otherwise user-initiated;
 *   there is no other page involved, so there is nothing to ride.
 * - no `Origin` and no `Sec-Fetch-Site` — curl, a script, the repo's own
 *   smoke runs. A browser always sends at least one of them on a POST, so
 *   this is not a hole an attacking page can climb through.
 *
 * Rejected: a foreign `Origin`, and `cross-site` / `same-site` from the
 * browser. `same-site` is refused too because it means a *different* host
 * under the same registrable domain — a sibling subdomain someone else
 * controls is exactly the neighbour this is meant to keep out, and every
 * form on this dashboard is served from the dashboard itself.
 */
export function sameOriginPost(check: OriginCheck): OriginVerdict {
  const site = check.secFetchSite?.trim().toLowerCase();
  if (site === 'cross-site' || site === 'same-site') {
    return { ok: false, reason: `Sec-Fetch-Site: ${site}` };
  }

  const origin = check.origin?.trim();
  // "null" is a real Origin value — a sandboxed iframe or a redirected form.
  // It is not this dashboard, so it is not allowed to write to it.
  if (origin && origin !== 'null') {
    const from = hostOf(origin);
    const host = check.host?.trim().toLowerCase();
    if (!from) return { ok: false, reason: `unparseable Origin: ${origin}` };
    if (!host) return { ok: false, reason: 'no Host header to compare the Origin with' };
    return from === host ? { ok: true, reason: 'same origin' } : { ok: false, reason: `Origin ${from} is not ${host}` };
  }
  if (origin === 'null') return { ok: false, reason: 'opaque Origin' };

  if (site === 'same-origin' || site === 'none') return { ok: true, reason: `Sec-Fetch-Site: ${site}` };
  return { ok: true, reason: 'no browser origin headers (not a browser)' };
}

/** Only requests that can change something are checked; GET and HEAD are read-only. */
export function guardedMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}
