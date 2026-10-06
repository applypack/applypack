/*
 * One-shot flash message carried across a POST → redirect → GET in a
 * short-lived cookie. Shared by every route that redirects after a write.
 */

import { t } from '../i18n/t';

export type FlashKind = 'ok' | 'warn' | 'err';

/** A form field's name and a form's action as our pages write them — nothing a selector could trip on. */
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const FORM_ACTION = /^\/[A-Za-z0-9/_-]{0,200}$/;

/** A field a schema refused, by the form it sits in: a page can hold several fields of one name. */
export interface RefusedField {
  /** The form's `action` — the path the POST went to. */
  form: string;
  name: string;
}

export interface FlashMessage {
  kind: FlashKind;
  text: string;
  /** The result shown is a stored analysis — the page offers "Re-run anyway". */
  rerun?: boolean;
  /** Which comparison the user asked for, so "Re-run anyway" repeats THAT one (ADR 0029). */
  mode?: string;
  /** The editor for the comparison just made — the flash offers "Tailor resume →" (#164). */
  tailor?: string;
  /** A file the action just wrote — the flash offers to download it (TASKS R25). */
  download?: string;
  /** The form field a schema refused — the page marks it invalid and points it at this message (TASKS U15). */
  field?: RefusedField;
}

const FLASH_TTL_SECONDS = 5;
/** A schema's message can echo the value it refused; a flash rides in a cookie, so the echo is cut. */
const MAX_ISSUE_CHARS = 160;

export function flashRedirect(
  location: string,
  kind: FlashMessage['kind'],
  text: string,
  opts: { rerun?: boolean; mode?: string; tailor?: string; download?: string; field?: RefusedField } = {},
): Response {
  const value = encodeFlash({
    kind,
    text,
    ...(opts.rerun ? { rerun: true, mode: opts.mode } : {}),
    ...(opts.tailor ? { tailor: opts.tailor } : {}),
    ...(opts.download ? { download: opts.download } : {}),
    ...(opts.field ? { field: opts.field } : {}),
  });
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      'Set-Cookie': `flash=${value}; Path=/; Max-Age=${FLASH_TTL_SECONDS}; HttpOnly; SameSite=Lax`,
    },
  });
}

/**
 * The message as a cookie value: its JSON in base64url. A browser drops a
 * cookie past 4 096 bytes without a word, and percent-encoding spends six
 * characters on a Cyrillic letter and nine on a Devanagari one — a
 * 500-character message in Ukrainian would never arrive (ADR 0061). Base64url
 * spends under three and four.
 */
function encodeFlash(message: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(message), 'utf8').toString('base64url');
}

export function parseFlashCookie(cookieHeader: string | undefined): FlashMessage | null {
  if (!cookieHeader) return null;
  const match = /(?:^|;\s*)flash=([^;]+)/.exec(cookieHeader);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
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
        ...(typeof parsed.download === 'string' && /^\/resumes\/\d+\/download$/.test(parsed.download) ? { download: parsed.download } : {}),
        // A form's path and a field's name, nothing else: both land in a selector on the page.
        ...(isRefusedField(parsed.field) ? { field: { form: parsed.field.form, name: parsed.field.name } } : {}),
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
  if (!first) return t('flash.formEmpty');
  const field = first.path.map(String).join('.');
  const text = field ? `${field}: ${first.message}` : first.message;
  return text.length > MAX_ISSUE_CHARS ? `${text.slice(0, MAX_ISSUE_CHARS)}…` : text;
}

/**
 * The field the first issue is about, in the form that posted to `form` — the
 * top of the issue's path, when it names one (TASKS U15). It is
 * `flashRedirect`'s options as it stands: `refusedField(c.req.path, issues)`.
 */
export function refusedField(form: string, issues: readonly { path: readonly PropertyKey[] }[]): { field?: RefusedField } {
  const name = issues[0]?.path[0];
  return typeof name === 'string' && isRefusedField({ form, name }) ? { field: { form, name } } : {};
}

function isRefusedField(value: unknown): value is RefusedField {
  if (!value || typeof value !== 'object') return false;
  const { form, name } = value as Record<string, unknown>;
  return typeof form === 'string' && FORM_ACTION.test(form) && typeof name === 'string' && FIELD_NAME.test(name);
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
