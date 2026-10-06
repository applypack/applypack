import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGE_KEYS, ownMessage } from '../i18n/catalog';
import { LOCALES, PSEUDO_LOCALE, intlTag, type Locale } from '../i18n/locale';
import { formatMessage, messageShape, parseMessage, partsToText, type MessageNode, type MessageParams, type MessagePart } from '../i18n/message';

/*
 * public/i18n.mjs mirrors src/i18n/message.ts for the page modules, which
 * cannot import TypeScript (ADR 0061, stage 3). Held to it here as score.mjs
 * is held to resume/score.ts: every message of every catalog goes through
 * both, with every plural count and select branch worth trying, and the two
 * must give the same parts and the same text.
 */

interface Mirror {
  parseMessage(source: string): MessageNode[];
  formatMessage(nodes: MessageNode[], params: MessageParams, tag: string): MessagePart[];
  partsToText(parts: MessagePart[]): string;
}

// Plain JS served as-is; node loads it the way the browser does.
// @ts-expect-error — no declaration file; the shape is the Mirror interface above.
const mirror = import('./public/i18n.mjs') as Promise<Mirror>;

const LANGUAGES = (Object.keys(LOCALES) as Locale[]).filter((l) => l !== PSEUDO_LOCALE);
/** Counts that reach every plural form of every language, an exact `=N`, a fraction and a grouped thousand. */
const COUNTS = [0, 1, 2, 3, 5, 11, 21, 22, 25, 1.5, 1000, 1234567];

/** Parameter sets for one message: each count, each select branch (and one no branch names), numbers and words for the rest. */
function paramSets(nodes: MessageNode[]): MessageParams[] {
  const shape = messageShape(nodes);
  const sets: MessageParams[] = [{}];
  const rounds = Math.max(COUNTS.length, ...Object.values(shape.selects).map((b) => b.length + 1));
  for (let i = 0; i < rounds; i++) {
    const params: MessageParams = {};
    for (const arg of shape.args) {
      const branches = shape.selects[arg];
      if (branches) params[arg] = branches[i] ?? 'unnamed';
      else if (arg in shape.plurals) params[arg] = COUNTS[i % COUNTS.length]!;
      else params[arg] = i % 2 === 0 ? COUNTS[i % COUNTS.length]! : `word ${i}`;
    }
    sets.push(params);
  }
  return sets;
}

describe('public/i18n.mjs formats as src/i18n/message.ts does', () => {
  for (const locale of LANGUAGES) {
    it(`every message of ${locale}.json, every count and branch`, async () => {
      const js = await mirror;
      const tag = intlTag(locale);
      let checked = 0;
      for (const key of MESSAGE_KEYS) {
        const source = ownMessage(locale, key);
        if (source === undefined) continue;
        const nodes = parseMessage(source);
        const mirrored = js.parseMessage(source);
        assert.deepEqual(mirrored, nodes, `${locale} ${key}: parsed`);
        for (const params of paramSets(nodes)) {
          const want = formatMessage(nodes, params, tag);
          const got = js.formatMessage(mirrored, params, tag);
          assert.deepEqual(got, want, `${locale} ${key} ${JSON.stringify(params)}`);
          assert.equal(js.partsToText(got), partsToText(want), `${locale} ${key}: text`);
          checked++;
        }
      }
      assert.ok(checked > MESSAGE_KEYS.length, `${locale}: ${checked} formats checked`);
    });
  }

  it('the syntax a catalog never holds: the same answer, the same refusal', async () => {
    const js = await mirror;
    const sources = [
      "It's '{'literal'}' and '<'tag> and ''",
      'salary < 100k, {n, number} more',
      '{n, plural, =0 {none} one {# <b>one</b>} other {{kind, select, pdf {# PDFs} other {# files}}}}',
      '<br/>Line two <link>see <b>this</b></link>',
      '{ spaced , select , a {A} other {B} }',
      '{n, plural, one {#} other {#}',
      '{n, plural, two {x}}',
      '{n, plural, lots {x} other {y}}',
      '{n, select, a {x} a {y} other {z}}',
      '{n, date}',
      '<a href="x">no</a>',
      '<b>open',
      'close</b>',
      "'{unclosed quote",
      '}',
      '{',
    ];
    for (const source of sources) {
      let want: unknown;
      let got: unknown;
      try {
        want = parseMessage(source);
      } catch (err) {
        want = (err as Error).message;
      }
      try {
        got = js.parseMessage(source);
      } catch (err) {
        got = (err as Error).message;
      }
      assert.deepEqual(got, want, source);
      if (typeof want === 'string') continue;
      for (const params of [{}, { n: 0 }, { n: 1, kind: 'pdf' }, { n: 7, kind: 'doc', spaced: 'a' }, { toString: 'x' }] as MessageParams[]) {
        assert.deepEqual(js.formatMessage(got as MessageNode[], params, 'en-US'), formatMessage(want as MessageNode[], params, 'en-US'), source);
      }
    }
  });
});
