/*
 * One-shot flash message carried across a POST → redirect → GET in a
 * short-lived cookie. Shared by every route that redirects after a write.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
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
  /** What was typed into it, for a page that puts it back (#546): only the page reads it, as an attribute. */
  value?: string;
}

/** A typed value the flash carries back: a path, a name — never a page of text, which would outgrow the cookie. */
const MAX_VALUE_CHARS = 1024;

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
  /** What a refused form held — the page puts it back instead of an empty form (#534). */
  draft?: FormDraft;
}

/** A refused form's values, by the form they came from. */
export interface FormDraft {
  /** The form's `action` — the path the POST went to. */
  form: string;
  values: Record<string, string>;
}

const FLASH_TTL_SECONDS = 5;
/** A draft is a few short fields; the cap keeps a pasted essay from pushing the cookie past what a browser keeps. */
const MAX_DRAFT_FIELDS = 8;
const MAX_DRAFT_CHARS = 300;
/** A schema's message can echo the value it refused; a flash rides in a cookie, so the echo is cut. */
const MAX_ISSUE_CHARS = 160;

/*
 * Cookies ignore the port, so two installs on one machine — Docker on 4747,
 * `npm start` on 4848 — showed each other's flash (#556). The cookie's name
 * carries the port the page was asked at (`flash-4848`); app.ts sets it for
 * the request. Outside a request, and on a default port, it is `flash`.
 */
const FLASH_COOKIE = 'flash';
const cookieName = new AsyncLocalStorage<string>();

export function withFlashCookie<T>(url: string, fn: () => T): T {
  const port = new URL(url).port;
  return cookieName.run(port ? `${FLASH_COOKIE}-${port}` : FLASH_COOKIE, fn);
}

function currentName(): string {
  return cookieName.getStore() ?? FLASH_COOKIE;
}

export function flashRedirect(
  location: string,
  kind: FlashMessage['kind'],
  text: string,
  opts: { rerun?: boolean; mode?: string; tailor?: string; download?: string; field?: RefusedField; draft?: FormDraft } = {},
): Response {
  const value = encodeFlash({
    kind,
    text,
    ...(opts.rerun ? { rerun: true, mode: opts.mode } : {}),
    ...(opts.tailor ? { tailor: opts.tailor } : {}),
    ...(opts.download ? { download: opts.download } : {}),
    ...(opts.field
      ? { field: { form: opts.field.form, name: opts.field.name, ...(typedValue(opts.field.value) ? { value: opts.field.value } : {}) } }
      : {}),
    ...(opts.draft ? { draft: readDraft(opts.draft) } : {}),
  });
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      'Set-Cookie': `${currentName()}=${value}; Path=/; Max-Age=${FLASH_TTL_SECONDS}; HttpOnly; SameSite=Lax`,
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
  const match = new RegExp(`(?:^|;\\s*)${currentName()}=([^;]+)`).exec(cookieHeader);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed.kind === 'ok' || parsed.kind === 'warn' || parsed.kind === 'err') &&
      typeof parsed.text === 'string'
    ) {
      const draft = readDraft(parsed.draft);
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
        ...(isRefusedField(parsed.field)
          ? { field: { form: parsed.field.form, name: parsed.field.name, ...(typedValue(parsed.field.value) ? { value: parsed.field.value } : {}) } }
          : {}),
        // Values only go back into the form they came from, as attribute values the renderer escapes.
        ...(draft ? { draft } : {}),
      };
    }
  } catch {
    return null;
  }
  return null;
}

/** A refused field as a schema reports it; `code` is there when zod wrote it. */
export interface Issue {
  path: readonly PropertyKey[];
  message: string;
  code?: string;
}

/**
 * The first thing a schema refused, as "field: reason" — so a flash can name
 * what was wrong instead of "Invalid form values". `label` gives a field the
 * name its form shows it under (#549); a field it does not name keeps its own.
 */
export function firstIssue(issues: readonly Issue[], label?: (field: string) => string | undefined): string {
  const first = issues[0];
  if (!first) return t('flash.formEmpty');
  const name = first.path.map(String).join('.');
  const field = (label && label(name)) ?? name;
  const reason = issueReason(first);
  const text = field ? `${field}: ${reason}` : reason;
  return text.length > MAX_ISSUE_CHARS ? `${text.slice(0, MAX_ISSUE_CHARS)}…` : text;
}

const english = z.locales.en();

/** zod's own English sentence for an issue whose input was `input`: the one a schema's message is told apart from. */
function zodSentence(issue: z.core.$ZodIssue, input?: unknown): string {
  const said = english.localeError({ ...issue, input } as z.core.$ZodRawIssue);
  return typeof said === 'string' ? said : (said?.message ?? '');
}

/**
 * zod's own sentence ("Invalid input: expected number, received undefined")
 * in the reader's language (ADR 0061). A message the schema wrote itself is
 * kept as written: it is the schema's to word.
 */
function issueReason(issue: Issue): string {
  if (issue.code === undefined) return issue.message;
  const zod = issue as z.core.$ZodIssue;
  if (zod.code === 'invalid_type') {
    // zod's sentence names what arrived, which a finished issue no longer carries; "undefined" is a missing field.
    const missing = zodSentence(zod);
    if (issue.message === missing) return t('flash.issue.required');
    if (!issue.message.startsWith(missing.slice(0, missing.lastIndexOf(' ')))) return issue.message;
    return t('flash.issue.type', { expected: zod.expected === 'int' ? 'integer' : zod.expected });
  }
  if (zodSentence(zod) !== issue.message) return issue.message;
  switch (zod.code) {
    case 'too_small':
      return boundReason(zod.origin, 'min', Number(zod.minimum), zod.exact === true, zod.inclusive !== false);
    case 'too_big':
      return boundReason(zod.origin, 'max', Number(zod.maximum), zod.exact === true, zod.inclusive !== false);
    case 'invalid_format':
      return t('flash.issue.string', { validation: zod.format });
    case 'invalid_value':
      return t(zod.values.length > 1 ? 'flash.issue.enum' : 'flash.issue.literal');
    default:
      return t('flash.issue.invalid');
  }
}

/** A length, a count or a number out of bounds; a date or a bigint says only that it is not valid. */
function boundReason(type: string, side: 'min' | 'max', n: number, exact: boolean, inclusive: boolean): string {
  switch (type) {
    case 'string':
      return t(exact ? 'flash.issue.exactChars' : side === 'min' ? 'flash.issue.minChars' : 'flash.issue.maxChars', { n });
    case 'array':
    case 'set':
      return t(exact ? 'flash.issue.exactItems' : side === 'min' ? 'flash.issue.minItems' : 'flash.issue.maxItems', { n });
    case 'number':
      if (side === 'min') return t(inclusive ? 'flash.issue.minNumber' : 'flash.issue.aboveNumber', { n });
      return t(inclusive ? 'flash.issue.maxNumber' : 'flash.issue.belowNumber', { n });
    default:
      return t('flash.issue.invalid');
  }
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

/** A draft as the cookie may carry it: a form of ours, field names only, short string values. Anything else is none. */
function readDraft(value: unknown): FormDraft | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { form, values } = value as Record<string, unknown>;
  if (typeof form !== 'string' || !FORM_ACTION.test(form) || !values || typeof values !== 'object') return undefined;
  const fields = Object.entries(values).filter((e): e is [string, string] => FIELD_NAME.test(e[0]) && typeof e[1] === 'string');
  return { form, values: Object.fromEntries(fields.slice(0, MAX_DRAFT_FIELDS).map(([name, v]) => [name, v.slice(0, MAX_DRAFT_CHARS)])) };
}

function typedValue(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_VALUE_CHARS && !CONTROL_CHARS.test(value);
}

function isRefusedField(value: unknown): value is RefusedField {
  if (!value || typeof value !== 'object') return false;
  const { form, name } = value as Record<string, unknown>;
  return typeof form === 'string' && FORM_ACTION.test(form) && typeof name === 'string' && FIELD_NAME.test(name);
}

/** Any host does: only whether the value leaves it matters. `.invalid` never resolves (RFC 2606). */
const HERE = 'http://here.invalid';

/**
 * A redirect target from a form field, kept local — an absolute or
 * protocol-relative URL would be an open redirect, and a control character
 * would be a header split: `Location: /jobs\r\nSet-Cookie: …` is two headers
 * to anything that does not encode it for us.
 *
 * The value is read the way a browser reads a Location, not as a string: a
 * browser takes a backslash for a slash, so `/\host` is `//host`, and it
 * folds `/.//host` to the same. Both start with one slash, and both left the
 * site (#354). What comes back is the parser's own spelling, percent-encoded,
 * so a `back` with Cyrillic in its query is a header and not a 500.
 */
export function safeBack(back: unknown, fallback: string): string {
  if (typeof back !== 'string' || !back.startsWith('/') || CONTROL_CHARS.test(back)) return fallback;
  let url: URL;
  try {
    url = new URL(back, HERE);
  } catch {
    return fallback;
  }
  if (url.origin !== HERE || url.pathname.startsWith('//')) return fallback;
  return url.pathname + url.search + url.hash;
}

// C0, DEL and C1. Not just CR/LF: a bare \n splits a header for some clients
// and \u0085 is a line break to others.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

export function clearFlashCookie(): string {
  return `${currentName()}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
