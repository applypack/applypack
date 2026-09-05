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
  /** Which comparison the user asked for, so "Re-run anyway" repeats THAT one (ADR 0029). */
  mode?: string;
  /** The editor for the comparison just made — the flash offers "Tailor resume →" (#164). */
  tailor?: string;
}

const FLASH_TTL_SECONDS = 5;

export function flashRedirect(
  location: string,
  kind: FlashMessage['kind'],
  text: string,
  opts: { rerun?: boolean; mode?: string; tailor?: string } = {},
): Response {
  const value = encodeURIComponent(
    JSON.stringify({
      kind,
      text,
      ...(opts.rerun ? { rerun: true, mode: opts.mode } : {}),
      ...(opts.tailor ? { tailor: opts.tailor } : {}),
    }),
  );
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
      return {
        kind: parsed.kind,
        text: parsed.text,
        ...(parsed.rerun === true
          ? { rerun: true, ...(typeof parsed.mode === 'string' ? { mode: parsed.mode } : {}) }
          : {}),
        // A path of ours only — a cookie is the browser's to edit.
        ...(typeof parsed.tailor === 'string' && /^\/jobs\/\d+\/target\?match=\d+$/.test(parsed.tailor)
          ? { tailor: parsed.tailor }
          : {}),
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * A redirect target from a form field, kept local — an absolute or
 * protocol-relative URL would be an open redirect.
 */
export function safeBack(back: unknown, fallback: string): string {
  return typeof back === 'string' && back.startsWith('/') && !back.startsWith('//') ? back : fallback;
}

export function clearFlashCookie(): string {
  return 'flash=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
}
