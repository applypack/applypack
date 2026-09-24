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
/** A schema's message can echo the value it refused; a flash rides in a cookie, so the echo is cut. */
const MAX_ISSUE_CHARS = 160;

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
 * The first thing a schema refused, as "field: reason" — so a flash can name
 * what was wrong instead of "Invalid form values".
 */
export function firstIssue(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  const first = issues[0];
  if (!first) return 'the form arrived empty';
  const field = first.path.map(String).join('.');
  const text = field ? `${field}: ${first.message}` : first.message;
  return text.length > MAX_ISSUE_CHARS ? `${text.slice(0, MAX_ISSUE_CHARS)}…` : text;
}

/**
 * A redirect target from a form field, kept local — an absolute or
 * protocol-relative URL would be an open redirect, and a control character
 * would be a header split: `Location: /jobs\r\nSet-Cookie: …` is two headers
 * to anything that does not encode it for us.
 */
export function safeBack(back: unknown, fallback: string): string {
  if (typeof back !== 'string') return fallback;
  if (!back.startsWith('/') || back.startsWith('//')) return fallback;
  return CONTROL_CHARS.test(back) ? fallback : back;
}

// C0, DEL and C1. Not just CR/LF: a bare \n splits a header for some clients
// and \u0085 is a line break to others.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

export function clearFlashCookie(): string {
  return 'flash=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
}
