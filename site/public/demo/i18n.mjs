/*
 * The catalog's words in the browser (ADR 0061, stage 3). The page modules
 * write their own lines after a page loads — a status, a progress line, a
 * tooltip — and they write them in the interface's language through `t()`,
 * as the server does.
 *
 * The first half mirrors src/i18n/message.ts line for line (the syntax, the
 * parser, the formatter): public/ is served as it is, with no build step, so
 * the TypeScript cannot be imported here. src/web/i18n-mirror.test.ts runs
 * every message of every catalog through both and requires the same text —
 * change one, change the other.
 *
 * The messages: English from ./i18n-en.mjs (the catalog's `browser.*` keys,
 * written by `npm run i18n:browser`), overlaid by the page's own
 * <script type="application/json" id="i18n-messages"> when the page is in
 * another language (layout.tsx). Read once, on the first word; with no
 * document — a test, the server loading a module — it is English.
 */

import { ENGLISH } from './i18n-en.mjs';

/* ---------- the syntax: a mirror of src/i18n/message.ts ---------- */

class MessageSyntaxError extends Error {
  constructor(message, source, at) {
    super(`${message} at ${at} in "${source}"`);
    this.name = 'MessageSyntaxError';
  }
}

const PLURAL_KEYWORDS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const QUOTABLE = new Set(['{', '}', '<', '#']);
const OPEN_TAG = /^<([a-z][a-z0-9]*)>/;
const CLOSE_TAG = /^<\/([a-z][a-z0-9]*)>/;
const VOID_TAG = /^<([a-z][a-z0-9]*)\s*\/>/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;
const SELECTOR = /^(=\d+|[A-Za-z_][A-Za-z0-9_]*)/;

export function parseMessage(source) {
  let pos = 0;

  const fail = (message) => {
    throw new MessageSyntaxError(message, source, pos);
  };
  const skipSpace = () => {
    while (pos < source.length && /\s/.test(source[pos])) pos++;
  };
  const take = (pattern, what) => {
    const m = pattern.exec(source.slice(pos));
    if (!m) return fail(`expected ${what}`);
    pos += m[0].length;
    return m[0];
  };
  const expect = (ch) => {
    if (source[pos] !== ch) fail(`expected "${ch}"`);
    pos++;
  };

  /** `pound` is the plural argument a bare # stands for, when there is one around. */
  function nodes(stop, pound) {
    const out = [];
    let text = '';
    const flush = () => {
      if (text) out.push(text);
      text = '';
    };
    while (pos < source.length) {
      const ch = source[pos];
      if (ch === "'") {
        const next = source[pos + 1];
        if (next === "'") {
          text += "'";
          pos += 2;
        } else if (next !== undefined && QUOTABLE.has(next)) {
          // A quoted run: everything up to the closing apostrophe is literal.
          pos++;
          for (;;) {
            if (pos >= source.length) fail('unclosed quote');
            if (source[pos] === "'") {
              if (source[pos + 1] === "'") {
                text += "'";
                pos += 2;
                continue;
              }
              pos++;
              break;
            }
            text += source[pos++];
          }
        } else {
          text += ch;
          pos++;
        }
      } else if (ch === '{') {
        flush();
        out.push(argument(pound));
      } else if (ch === '}') {
        if (!stop.brace) fail('unexpected "}"');
        flush();
        return out;
      } else if (ch === '#' && pound !== null) {
        flush();
        out.push({ kind: 'number', name: pound });
        pos++;
      } else if (ch === '<') {
        const rest = source.slice(pos);
        const close = CLOSE_TAG.exec(rest);
        if (close) {
          if (close[1] !== stop.tag) fail(`unexpected </${close[1]}>`);
          flush();
          return out;
        }
        const empty = VOID_TAG.exec(rest);
        const open = OPEN_TAG.exec(rest);
        if (empty) {
          flush();
          pos += empty[0].length;
          out.push({ kind: 'tag', name: empty[1], children: [] });
        } else if (open) {
          flush();
          pos += open[0].length;
          const name = open[1];
          const children = nodes({ brace: false, tag: name }, pound);
          if (!source.startsWith(`</${name}>`, pos)) fail(`unclosed <${name}>`);
          pos += name.length + 3;
          out.push({ kind: 'tag', name, children });
        } else {
          if (/^<\/?[A-Za-z]/.test(rest)) fail('a tag is <name>…</name> or <name/>, lower case and without attributes');
          // "salary < 100k": not a tag, so not markup.
          text += ch;
          pos++;
        }
      } else {
        text += ch;
        pos++;
      }
    }
    if (stop.brace) fail('unclosed "{"');
    if (stop.tag) fail(`unclosed <${stop.tag}>`);
    flush();
    return out;
  }

  function argument(pound) {
    expect('{');
    skipSpace();
    const name = take(NAME, 'an argument name');
    skipSpace();
    if (source[pos] === '}') {
      pos++;
      return { kind: 'arg', name };
    }
    expect(',');
    skipSpace();
    const type = take(NAME, 'an argument type');
    skipSpace();
    if (type === 'number') {
      expect('}');
      return { kind: 'number', name };
    }
    if (type !== 'plural' && type !== 'select') return fail(`unknown argument type "${type}"`);
    expect(',');
    // No prototype: a selector is looked up with a value from outside (a status, a file kind).
    const cases = Object.create(null);
    for (;;) {
      skipSpace();
      if (source[pos] === '}') break;
      const selector = take(SELECTOR, 'a selector');
      if (type === 'plural' && !selector.startsWith('=') && !PLURAL_KEYWORDS.has(selector)) fail(`"${selector}" is not a plural category`);
      if (Object.hasOwn(cases, selector)) fail(`"${selector}" is given twice`);
      skipSpace();
      expect('{');
      // A select inside a plural keeps the plural's #.
      cases[selector] = nodes({ brace: true, tag: null }, type === 'plural' ? name : pound);
      expect('}');
    }
    pos++;
    if (!Object.hasOwn(cases, 'other')) fail(`{${name}, ${type}} has no "other"`);
    return { kind: type, name, cases };
  }

  return nodes({ brace: false, tag: null }, null);
}

/** A branch by its selector, never one an object inherits (`constructor`, `__proto__` …). */
function ownCase(cases, key) {
  return Object.hasOwn(cases, key) ? cases[key] : undefined;
}

const pluralRules = new Map();
const numberFormats = new Map();

function pluralCategory(tag, n) {
  let rules = pluralRules.get(tag);
  if (!rules) pluralRules.set(tag, (rules = new Intl.PluralRules(tag)));
  return rules.select(n);
}

function localNumber(tag, n) {
  let format = numberFormats.get(tag);
  if (!format) numberFormats.set(tag, (format = new Intl.NumberFormat(tag)));
  return format.format(n);
}

/**
 * The message with its arguments in place, for the language `tag` formats in.
 * An argument nobody passed stays in sight as `{name}`.
 */
export function formatMessage(nodes, params, tag) {
  const out = [];
  const push = (text) => {
    const last = out.length - 1;
    if (typeof out[last] === 'string') out[last] += text;
    else out.push(text);
  };
  for (const node of nodes) {
    if (typeof node === 'string') {
      push(node);
      continue;
    }
    if (node.kind === 'tag') {
      out.push({ tag: node.name, children: formatMessage(node.children, params, tag) });
      continue;
    }
    // Own properties only: an argument named `toString` that nobody passed stays in sight as `{toString}`.
    const value = Object.hasOwn(params, node.name) ? params[node.name] : undefined;
    if (value === undefined) {
      push(`{${node.name}}`);
    } else if (node.kind === 'arg') {
      push(String(value));
    } else if (node.kind === 'number') {
      push(typeof value === 'number' ? localNumber(tag, value) : value);
    } else {
      const branch =
        node.kind === 'plural'
          ? (ownCase(node.cases, `=${value}`) ?? ownCase(node.cases, pluralCategory(tag, Number(value))))
          : ownCase(node.cases, String(value));
      for (const part of formatMessage(branch ?? node.cases.other ?? [], params, tag)) {
        if (typeof part === 'string') push(part);
        else out.push(part);
      }
    }
  }
  return out;
}

/** The parts as plain text: an inline element gives its words and nothing else. */
export function partsToText(parts) {
  return parts.map((p) => (typeof p === 'string' ? p : partsToText(p.children))).join('');
}

/* ---------- the page's language ---------- */

const ENGLISH_PAGE = { locale: 'en', tag: 'en-US', messages: {} };
let page = null;

/** What the page embedded: its language, the tag `Intl` formats with, and its messages. English when there is nothing. */
function readPage() {
  if (page) return page;
  page = ENGLISH_PAGE;
  try {
    const el = typeof document === 'undefined' ? null : document.getElementById('i18n-messages');
    const data = el ? JSON.parse(el.textContent ?? '') : null;
    if (data && typeof data.locale === 'string' && typeof data.tag === 'string' && data.messages && typeof data.messages === 'object') {
      page = { locale: data.locale, tag: data.tag, messages: data.messages };
    }
  } catch {
    // A page that cannot be read speaks English, as every module did before.
  }
  return page;
}

/** The interface's language on this page ("en", "uk", …) — what a request for language-bound data names. */
export function pageLocale() {
  return readPage().locale;
}

const parsed = new Map();

function nodesOf(key) {
  const { messages } = readPage();
  const source = (Object.hasOwn(messages, key) ? messages[key] : undefined) ?? ENGLISH[key] ?? key;
  let nodes = parsed.get(source);
  if (!nodes) parsed.set(source, (nodes = parseMessage(source)));
  return nodes;
}

/** The message as parts: text, and the inline elements a caller turns into markup. */
export function tParts(key, params = {}) {
  return formatMessage(nodesOf(key), params, readPage().tag);
}

/** The message for `key` as text, in the page's language. */
export function t(key, params) {
  return partsToText(tParts(key, params));
}

/** "a, b, c" — a short list of counts or labels, joined the way the page's language joins one. */
export function formatList(items) {
  return new Intl.ListFormat(readPage().tag, { type: 'unit', style: 'short' }).format(items);
}

/** `n` with `digits` decimals, as `toFixed` rounds it, written with the language's decimal mark ("1.2" / "1,2"). */
export function formatDecimal(n, digits) {
  const mark = new Intl.NumberFormat(readPage().tag).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';
  return n.toFixed(digits).replace('.', mark);
}
