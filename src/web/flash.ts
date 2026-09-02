/*
 * One-shot flash message carried across a POST → redirect → GET in a
 * short-lived cookie. Shared by every route that redirects after a write.
 */

export type FlashKind = 'ok' | 'warn' | 'err';

export interface FlashMessage {
  kind: FlashKind;
  text: string;
  /** The result shown is a stored analysis — the page offers "Re-run anyway". */
  rerun?: boolean;
}

const FLASH_TTL_SECONDS = 5;

export function flashRedirect(
  location: string,
  kind: FlashMessage['kind'],
  text: string,
  opts: { rerun?: boolean } = {},
): Response {
  const value = encodeURIComponent(JSON.stringify({ kind, text, ...(opts.rerun ? { rerun: true } : {}) }));
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      'Set-Cookie': `flash=${value}; Path=/; Max-Age=${FLASH_TTL_SECONDS}; HttpOnly; SameSite=Lax`,
    },
  });
}

export function parseFlashCookie(cookieHeader: string | undefined): FlashMessage | null {
  if (!cookieHeader) return null;
  const match = /(?:^|;\s*)flash=([^;]+)/.exec(cookieHeader);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed.kind === 'ok' || parsed.kind === 'warn' || parsed.kind === 'err') &&
      typeof parsed.text === 'string'
    ) {
      return { kind: parsed.kind, text: parsed.text, ...(parsed.rerun === true ? { rerun: true } : {}) };
    }
  } catch {
    return null;
  }
  return null;
}

export function clearFlashCookie(): string {
  return 'flash=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
}
