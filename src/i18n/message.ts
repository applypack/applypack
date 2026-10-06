/*
 * The catalog's message syntax: the part of ICU MessageFormat the interface
 * needs, parsed and formatted here with nothing but `Intl` (ADR 0061).
 *
 *   {name}                                   an argument, written as it is
 *   {n, number}                              a number in the language's own grouping
 *   {n, plural, one {# job} other {# jobs}}  by `Intl.PluralRules`; `=0` matches exactly; `#` is the number
 *   {kind, select, pdf {…} other {…}}        by the argument's value
 *   <link>words</link>, <br/>                an inline element the caller supplies (`tRich`); dropped by `t`
 *   '{'  '}'  '<'  '#'  ''                   the character itself
 *
 * An apostrophe quotes only when one of those four characters follows it, so
 * "don't" and "l'offre" are written plainly. Pure, and written to run in a
 * browser as it stands: stage 3 serves this same logic to the page modules.
 */

export type MessageParams = Record<string, string | number>;

type Cases = Record<string, MessageNode[]>;

export type MessageNode =
  | string
  | { kind: 'arg'; name: string }
  | { kind: 'number'; name: string }
  | { kind: 'plural'; name: string; cases: Cases }
  | { kind: 'select'; name: string; cases: Cases }
  | { kind: 'tag'; name: string; children: MessageNode[] };

/** A formatted message before it is flattened: text, and the inline elements with what they wrap. */
export type MessagePart = string | { tag: string; children: MessagePart[] };

export class MessageSyntaxError extends Error {
  constructor(message: string, source: string, at: number) {
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

/** What ended a run of nodes: a branch's brace, a closing tag, or the message itself. */
type Stop = { brace: boolean; tag: string | null };

export function parseMessage(source: string): MessageNode[] {
  let pos = 0;

  const fail = (message: string): never => {
    throw new MessageSyntaxError(message, source, pos);
  };
  const skipSpace = (): void => {
    while (pos < source.length && /\s/.test(source[pos]!)) pos++;
  };
  const take = (pattern: RegExp, what: string): string => {
    const m = pattern.exec(source.slice(pos));
    if (!m) return fail(`expected ${what}`);
    pos += m[0].length;
    return m[0];
  };
  const expect = (ch: string): void => {
    if (source[pos] !== ch) fail(`expected "${ch}"`);
    pos++;
  };

  /** `pound` is the plural argument a bare # stands for, when there is one around. */
  function nodes(stop: Stop, pound: string | null): MessageNode[] {
    const out: MessageNode[] = [];
    let text = '';
    const flush = (): void => {
      if (text) out.push(text);
      text = '';
    };
    while (pos < source.length) {
      const ch = source[pos]!;
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
          out.push({ kind: 'tag', name: empty[1]!, children: [] });
        } else if (open) {
          flush();
          pos += open[0].length;
          const name = open[1]!;
          const children = nodes({ brace: false, tag: name }, pound);
          if (!source.startsWith(`</${name}>`, pos)) fail(`unclosed <${name}>`);
          pos += name.length + 3;
          out.push({ kind: 'tag', name, children });
        } else {
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

  function argument(pound: string | null): MessageNode {
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
    const cases: Cases = {};
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

const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function pluralCategory(tag: string, n: number): string {
  let rules = pluralRules.get(tag);
  if (!rules) pluralRules.set(tag, (rules = new Intl.PluralRules(tag)));
  return rules.select(n);
}

function localNumber(tag: string, n: number): string {
  let format = numberFormats.get(tag);
  if (!format) numberFormats.set(tag, (format = new Intl.NumberFormat(tag)));
  return format.format(n);
}

/**
 * The message with its arguments in place, for the language `tag` formats in.
 * An argument nobody passed stays in sight as `{name}`: a visible slip on one
 * page, never a thrown render.
 */
export function formatMessage(nodes: readonly MessageNode[], params: MessageParams, tag: string): MessagePart[] {
  const out: MessagePart[] = [];
  const push = (text: string): void => {
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
    const value = params[node.name];
    if (value === undefined) {
      push(`{${node.name}}`);
    } else if (node.kind === 'arg') {
      push(String(value));
    } else if (node.kind === 'number') {
      push(typeof value === 'number' ? localNumber(tag, value) : value);
    } else {
      const branch =
        node.kind === 'plural'
          ? (node.cases[`=${value}`] ?? node.cases[pluralCategory(tag, Number(value))])
          : node.cases[String(value)];
      for (const part of formatMessage(branch ?? node.cases.other ?? [], params, tag)) {
        if (typeof part === 'string') push(part);
        else out.push(part);
      }
    }
  }
  return out;
}

/** The parts as plain text: an inline element gives its words and nothing else. */
export function partsToText(parts: readonly MessagePart[]): string {
  return parts.map((p) => (typeof p === 'string' ? p : partsToText(p.children))).join('');
}

/** What a message asks its caller for — the catalog test holds every language to the source's answer. */
export interface MessageShape {
  args: string[];
  tags: string[];
  /** Per plural argument, the categories its branches name (`=0` and the like left out). */
  plurals: Record<string, string[]>;
  /** Per select argument, its branches. */
  selects: Record<string, string[]>;
}

export function messageShape(nodes: readonly MessageNode[]): MessageShape {
  const args = new Set<string>();
  const tags = new Set<string>();
  const plurals: Record<string, Set<string>> = {};
  const selects: Record<string, Set<string>> = {};
  const walk = (list: readonly MessageNode[]): void => {
    for (const node of list) {
      if (typeof node === 'string') continue;
      if (node.kind === 'tag') {
        tags.add(node.name);
        walk(node.children);
        continue;
      }
      args.add(node.name);
      if (node.kind !== 'plural' && node.kind !== 'select') continue;
      const seen = ((node.kind === 'plural' ? plurals : selects)[node.name] ??= new Set());
      for (const [selector, branch] of Object.entries(node.cases)) {
        if (!selector.startsWith('=')) seen.add(selector);
        walk(branch);
      }
    }
  };
  walk(nodes);
  const sorted = (set: Set<string>): string[] => [...set].sort();
  const each = (record: Record<string, Set<string>>): Record<string, string[]> =>
    Object.fromEntries(Object.entries(record).map(([name, set]) => [name, sorted(set)]));
  return { args: sorted(args), tags: sorted(tags), plurals: each(plurals), selects: each(selects) };
}
