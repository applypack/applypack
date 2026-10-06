import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MESSAGE_KEYS, catalogKeys, ownMessage, type MessageKey } from './catalog';
import { LOCALES, PSEUDO_LOCALE, SOURCE_LOCALE, intlTag, type Locale } from './locale';
import { formatMessage, messageShape, parseMessage, partsToText, type MessageParams, type MessageShape } from './message';

/*
 * The catalogs against their source (ADR 0061). Every language has every key
 * and no key the source lacks, asks for the same arguments and inline
 * elements, and writes each plural in exactly the forms `Intl.PluralRules`
 * says that language has — so a count never falls through to a form the
 * translator did not write.
 */

const LANGUAGES = (Object.keys(LOCALES) as Locale[]).filter((l) => l !== PSEUDO_LOCALE);
const TRANSLATIONS = LANGUAGES.filter((l) => l !== SOURCE_LOCALE);

const shapeOf = (locale: Locale, key: MessageKey): MessageShape | null => {
  const message = ownMessage(locale, key);
  return message === undefined ? null : messageShape(parseMessage(message));
};

const pluralForms = (locale: Locale): string[] => [...new Intl.PluralRules(intlTag(locale)).resolvedOptions().pluralCategories].sort();

/** A value for every argument a message names: a plural gets each number, the rest a word. */
function sampleParams(shape: MessageShape, n: number): MessageParams {
  const params: MessageParams = {};
  for (const arg of shape.args) params[arg] = arg in shape.plurals ? n : arg in shape.selects ? (shape.selects[arg]![0] ?? 'other') : 'x';
  return params;
}

describe('the source catalog', () => {
  it('names its keys in dotted words', () => {
    for (const key of MESSAGE_KEYS) assert.match(key, /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/, key);
  });

  it('holds a key once (JSON keeps the last of two silently)', () => {
    for (const locale of LANGUAGES) {
      const text = readFileSync(join(__dirname, 'catalog', `${locale}.json`), 'utf8');
      const written = [...text.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]!);
      const twice = written.filter((key, i) => written.indexOf(key) !== i);
      assert.deepEqual(twice, [], `${locale}.json`);
    }
  });
});

for (const locale of LANGUAGES) {
  describe(`${locale}.json`, () => {
    it('parses, says something, and formats for any count', () => {
      for (const key of MESSAGE_KEYS) {
        const message = ownMessage(locale, key);
        if (message === undefined) continue;
        assert.ok(message.trim().length > 0, `${key} is empty`);
        assert.equal(message, message.trim(), `${key} has a space at an end — spacing belongs to the page`);
        const nodes = parseMessage(message);
        for (const n of [0, 1, 2, 5, 21, 1.5]) {
          const text = partsToText(formatMessage(nodes, sampleParams(messageShape(nodes), n), intlTag(locale)));
          assert.ok(!/\{[A-Za-z_]\w*\}/.test(text), `${key} left an argument unfilled: ${text}`);
        }
      }
    });

    it('writes every plural in the forms the language has, no more and no fewer', () => {
      const forms = pluralForms(locale);
      for (const key of MESSAGE_KEYS) {
        for (const [arg, used] of Object.entries(shapeOf(locale, key)?.plurals ?? {})) {
          assert.deepEqual(used, forms, `${key}: {${arg}, plural} has ${used.join(', ')}; ${locale} needs ${forms.join(', ')}`);
        }
      }
    });
  });
}

for (const locale of TRANSLATIONS) {
  describe(`${locale}.json against the source`, () => {
    it('has no key the source does not', () => {
      const known = new Set<string>(MESSAGE_KEYS);
      assert.deepEqual(catalogKeys(locale).filter((key) => !known.has(key)), []);
    });

    it('asks for the same arguments, inline elements and select branches', () => {
      for (const key of MESSAGE_KEYS) {
        const [source, own] = [shapeOf(SOURCE_LOCALE, key)!, shapeOf(locale, key)];
        if (!own) continue;
        assert.deepEqual(own.args, source.args, `${key}: arguments`);
        assert.deepEqual(own.tags, source.tags, `${key}: inline elements`);
        assert.deepEqual(own.selects, source.selects, `${key}: select branches`);
        // Every plural of the source stays a plural. A language may add one on an argument the English writes plainly:
        // French and Spanish agree a participle with its count ("{failed} failed" → "# échoué(s)") where English does not.
        const missing = Object.keys(source.plurals).filter((name) => !(name in own.plurals));
        assert.deepEqual(missing, [], `${key}: plural arguments`);
      }
    });

    // Unfinished or offered alike: "unfinished" is about pages still hard-coded, never about a key left behind.
    it('has every key: a string ships with its translations', () => {
      assert.deepEqual(MESSAGE_KEYS.filter((key) => ownMessage(locale, key) === undefined), []);
    });
  });
}
