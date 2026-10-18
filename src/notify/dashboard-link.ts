import { t } from '../i18n/t';

/*
 * The address the person opens the dashboard at, typed once on Settings →
 * Notifications, and the links a message carries into it (#487). An install
 * cannot know its own: it listens on 127.0.0.1:4747 by default and may sit
 * behind a proxy, so with no address a message carries no such link. Pure.
 */

type DashboardUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * The address as typed, made one a link can start with: http(s), with its
 * path (a proxy may serve the dashboard under one) and without a trailing
 * slash, a query or a fragment. A user name or password is refused: the link
 * goes into a chat, and the dashboard asks for them itself.
 */
export function checkDashboardUrl(input: string): DashboardUrlCheck {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: t('engine.url.notAddress') };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: t('engine.url.scheme') };
  if (url.username || url.password) return { ok: false, reason: t('settings.dashboardUrl.noCredentials') };
  return { ok: true, url: `${url.origin}${url.pathname.replace(/\/+$/, '')}` };
}

/**
 * A page of the dashboard ("/jobs/12?tab=pack") as a link a message can carry,
 * or null with no address set. The stored address is checked again: a row is
 * a row, and a hand-edited one must not put a credential or a script in a chat.
 */
export function dashboardLink(address: string | null, path: string): string | null {
  const checked = address ? checkDashboardUrl(address) : null;
  return checked?.ok ? `${checked.url}${path}` : null;
}
