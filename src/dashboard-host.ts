import { isIP } from 'node:net';

/*
 * Which names the dashboard answers to, and whether it is bound where only
 * this machine reaches it. Pure — tested in dashboard-host.test.ts.
 *
 * A page whose name its owner re-points at 127.0.0.1 (DNS rebinding) is,
 * to the browser, the same origin as the dashboard: it reads every answer,
 * and the cross-origin guard (web/same-origin.ts) compares `Origin` with a
 * `Host` the page chose. The `Host` header is the one thing such a page
 * cannot set, so the dashboard refuses a name it was not told about.
 */

/** A name and its port as the `Host` header carries them: `[::1]:4747`, `localhost:4747`, `jobs.example.com`. */
function hostName(header: string): string {
  const value = header.trim().toLowerCase();
  if (isIP(value) !== 0) return value;
  const bracketed = /^\[([^\]]*)\]/.exec(value);
  const name = bracketed ? bracketed[1]! : value.replace(/:\d*$/, '');
  // A trailing dot is the same name to the resolver and a different string to a check.
  return name.replace(/\.+$/, '');
}

/**
 * The names an operator listed (`WEB_ALLOWED_HOSTS`, comma-separated) plus
 * the one the dashboard is bound to. A leading dot covers the subdomains.
 */
export function allowedHostNames(listed: string, bind: string): string[] {
  return [...listed.split(','), bind].map((entry) => hostName(entry)).filter((name) => name.length > 0 && name !== '0.0.0.0' && name !== '::');
}

/**
 * Whether a request's `Host` is one the dashboard answers to. An address
 * literal always is: a rebinding page reaches the dashboard under its own
 * name, never under an address. So are `localhost` and its subdomains,
 * which a browser resolves to this machine without asking DNS. No `Host` at
 * all is not a browser (a browser always sends one) and passes, as it does
 * the cross-origin guard.
 */
export function hostAllowed(header: string | null | undefined, allowed: readonly string[]): boolean {
  if (!header?.trim()) return true;
  const name = hostName(header);
  if (isIP(name) !== 0) return true;
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  return allowed.some((entry) => (entry.startsWith('.') ? name.endsWith(entry) || name === entry.slice(1) : name === entry));
}

/** `WEB_HOST` names this machine's loopback: nothing else on the network reaches the dashboard. */
export function loopbackBind(bind: string): boolean {
  const name = hostName(bind);
  return name === 'localhost' || name === '::1' || (isIP(name) === 4 && name.startsWith('127.'));
}
