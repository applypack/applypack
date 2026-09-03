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
  /**
   * `X-Forwarded-Host` — what the browser asked for when a reverse proxy sits
   * in front (PR #87). Without it, a proxy that rewrites `Host` to `localhost`
   * makes every same-origin form look foreign. Safe to trust here: a browser
   * cannot set it on a cross-origin form POST (forms send no custom headers,
   * and a scripted request carrying one needs a CORS preflight this server
   * never grants), and a non-browser client already passes on its own.
   */
  forwardedHost?: string | null;
  /**
   * `Referer` — the fallback for a browser that sent no `Origin` and no
   * fetch metadata (PR #87). Weaker than either: it can be stripped by a proxy
   * or a privacy extension, which is why it is consulted last and its absence
   * is not held against the request.
   */
  referer?: string | null;
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
 * `Sec-Fetch-Site` decides whenever the browser sent it, and it decides
 * before `Origin` on purpose. Page script cannot set either header, but the
 * two answer different questions: `Origin` names the *document* that made the
 * request, while `Sec-Fetch-Site` is the browser's own comparison of that
 * initiator against this URL. They come apart in one real case — a page
 * rendered in a sandboxed frame has an opaque origin, so it posts to itself
 * with `Origin: null` and `Sec-Fetch-Site: same-origin` (measured, not
 * assumed). A page on someone else's site cannot produce `same-origin` in any
 * frame, sandboxed or not, so trusting it costs nothing and refusing it would
 * break a dashboard embedded in another tool.
 *
 * Accepted:
 * - `Sec-Fetch-Site: same-origin` — the browser vouches for it.
 * - `Sec-Fetch-Site: none` — typed, bookmarked or otherwise user-initiated;
 *   there is no other page involved, so there is nothing to ride.
 * - an `Origin` whose host is this host.
 * - a `Referer` from this host, when the browser sent no `Origin`.
 * - no `Origin`, no `Referer` and no `Sec-Fetch-Site` — curl, a script, the
 *   repo's own smoke runs. A browser always sends at least one of them on a POST, so
 *   this is not a hole an attacking page can climb through.
 *
 * Rejected: `cross-site` / `same-site` from the browser, a foreign `Origin`
 * or `Referer`, and an opaque `Origin` with no `Sec-Fetch-Site` to vouch for
 * it (which is what an attacker's sandboxed frame looks like on a browser too
 * old to send fetch metadata). `same-site` is refused because it means a
 * *different* host
 * under the same registrable domain — a sibling subdomain someone else
 * controls is exactly the neighbour this is meant to keep out, and every form
 * on this dashboard is served from the dashboard itself.
 */
export function sameOriginPost(check: OriginCheck): OriginVerdict {
  const site = check.secFetchSite?.trim().toLowerCase();
  if (site === 'cross-site' || site === 'same-site') {
    return { ok: false, reason: `Sec-Fetch-Site: ${site}` };
  }
  if (site === 'same-origin' || site === 'none') {
    return { ok: true, reason: `Sec-Fetch-Site: ${site}` };
  }

  const host = effectiveHost(check);
  const origin = check.origin?.trim();
  if (origin && origin !== 'null') {
    return compareHost(origin, host, 'Origin');
  }
  if (origin === 'null') return { ok: false, reason: 'opaque Origin, and no Sec-Fetch-Site to vouch for it' };

  // No Origin at all: some browsers omit it, and a proxy or privacy extension
  // can strip it. The Referer is what is left to go on (PR #87).
  const referer = check.referer?.trim();
  if (referer) return compareHost(referer, host, 'Referer');

  return { ok: true, reason: 'no browser origin headers (not a browser)' };
}

/**
 * What this dashboard is being reached as. `X-Forwarded-Host` wins when a
 * proxy set it — it is what the browser typed, and therefore what the browser
 * puts in `Origin`. Only the first value: a chain of proxies appends, and the
 * first entry is the one the client asked for.
 */
function effectiveHost(check: OriginCheck): string | null {
  const forwarded = check.forwardedHost?.split(',')[0]?.trim().toLowerCase();
  if (forwarded) return forwarded;
  return check.host?.trim().toLowerCase() || null;
}

function compareHost(url: string, host: string | null, header: string): OriginVerdict {
  const from = hostOf(url);
  if (!from) return { ok: false, reason: `unparseable ${header}: ${url}` };
  if (!host) return { ok: false, reason: `no Host header to compare the ${header} with` };
  return from === host
    ? { ok: true, reason: `same origin (${header})` }
    : { ok: false, reason: `${header} ${from} is not ${host}` };
}

/** Only requests that can change something are checked; GET and HEAD are read-only. */
export function guardedMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}
