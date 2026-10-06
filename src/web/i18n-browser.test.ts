import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findCountry } from '../countries';
import { MESSAGE_KEYS, ownMessage } from '../i18n/catalog';
import { intlTag, withLocale } from '../i18n/locale';
import { countryChip } from '../i18n/places';
import { BROWSER_KEYS, browserMessagesJson, englishModule } from './browser-messages';
import { countriesRoute } from './routes/countries';

/*
 * The page modules' words (ADR 0061, stage 3): the committed English module
 * follows the catalog, every key a module names exists and every browser key
 * is named somewhere, the page's embed carries the language, and the country
 * picker writes a chip the save reads back in every language.
 */

const PUBLIC = join(__dirname, 'public');
const GENERATED = 'i18n-en.mjs';

/** Every `'browser.…'` a module names, in quotes of any kind — a key in a table counts as much as one in a call. */
function namedKeys(): Map<string, string[]> {
  const named = new Map<string, string[]>();
  for (const file of readdirSync(PUBLIC).filter((f) => f.endsWith('.mjs') && f !== GENERATED)) {
    for (const m of readFileSync(join(PUBLIC, file), 'utf8').matchAll(/['"`](browser\.[A-Za-z0-9_.]+)['"`]/g)) {
      named.set(m[1]!, [...(named.get(m[1]!) ?? []), file]);
    }
  }
  return named;
}

describe('the browser catalog', () => {
  it('public/i18n-en.mjs is what `npm run i18n:browser` writes from en.json', () => {
    assert.equal(readFileSync(join(PUBLIC, GENERATED), 'utf8'), englishModule(), 'run npm run i18n:browser');
  });

  it('every key a module names is in the catalog', () => {
    const known = new Set<string>(MESSAGE_KEYS);
    const unknown = [...namedKeys()].filter(([key]) => !known.has(key)).map(([key, files]) => `${key} (${files.join(', ')})`);
    assert.deepEqual(unknown, []);
  });

  it('every browser key is named by a module', () => {
    const named = namedKeys();
    assert.deepEqual(BROWSER_KEYS.filter((key) => !named.has(key)), []);
  });
});

describe('the page embed', () => {
  it('is nothing in English: the modules carry it', () => {
    assert.equal(browserMessagesJson('en'), null);
  });

  it('carries the language, its Intl tag and every browser message in it', () => {
    const json = browserMessagesJson('uk')!;
    assert.ok(!json.includes('<'), 'nothing in it can close the script element');
    const data = JSON.parse(json) as { locale: string; tag: string; messages: Record<string, string> };
    assert.equal(data.locale, 'uk');
    assert.equal(data.tag, intlTag('uk'));
    assert.deepEqual(Object.keys(data.messages), [...BROWSER_KEYS]);
    for (const key of BROWSER_KEYS) assert.equal(data.messages[key], ownMessage('uk', key), key);
    assert.ok(json.length < 32_000, `${json.length} characters on every page`);
  });

  it('marks the English in the pseudo-language, as t() does on the server', () => {
    const data = JSON.parse(browserMessagesJson('en-XA')!) as { messages: Record<string, string> };
    for (const key of BROWSER_KEYS) assert.equal(data.messages[key], `⟦${ownMessage('en', key)}⟧`, key);
  });
});

describe('public/i18n.mjs on a page', () => {
  type Translate = { t: (key: string, params?: Record<string, string | number>) => string; pageLocale: () => string; formatList: (items: string[]) => string; formatDecimal: (n: number, digits: number) => string; tParts: (key: string, params?: Record<string, string | number>) => unknown[] };
  const g = globalThis as { document?: unknown };
  /** A fresh copy of the module (its own page cache) on a page whose embed reads `text`. */
  const onPage = async (text: string | null, copy: string): Promise<Translate> => {
    g.document = { getElementById: (id: string) => (id === 'i18n-messages' && text !== null ? { textContent: text } : null) };
    return (await import(`./public/i18n.mjs?${copy}`)) as Translate;
  };
  after(() => {
    delete g.document;
  });

  it('speaks English with no embed, and when the embed cannot be read', async () => {
    for (const [text, copy] of [[null, 'none'], ['{not json', 'broken'], ['{"messages":{}}', 'partial']] as const) {
      const page = await onPage(text, copy);
      assert.equal(page.pageLocale(), 'en', copy);
      assert.equal(page.t('browser.applyAll.change', { n: 2 }), '2 changes', copy);
      assert.equal(page.formatDecimal(1.25, 1), '1.3', copy);
    }
  });

  it("speaks the page's language from its embed, with its plurals, lists and decimal mark", async () => {
    const page = await onPage(browserMessagesJson('uk'), 'uk');
    assert.equal(page.pageLocale(), 'uk');
    assert.equal(page.t('browser.applyAll.change', { n: 1 }), '1 зміну');
    assert.equal(page.t('browser.applyAll.change', { n: 3 }), '3 зміни');
    assert.equal(page.t('browser.applyAll.change', { n: 5 }), '5 змін');
    assert.equal(page.formatList(['№3', '№4', '№5']), '№3, №4 і №5');
    assert.equal(page.formatDecimal(1.25, 1), '1,3');
    assert.deepEqual(page.tParts('browser.save.saved'), ['Збережено']);
  });

  it('brackets every word in the pseudo-language', async () => {
    const page = await onPage(browserMessagesJson('en-XA'), 'pseudo');
    assert.equal(page.t('browser.screen.selected', { n: 3, total: 12 }), '⟦3 of 12 selected⟧');
  });
});

describe('the country picker in the interface language', () => {
  type Gazetteer = { countries: { code: string; name: string; local?: string; flag: string; names: string[]; demonyms: string[]; cities: string[] }[] };
  type Picker = {
    chipText: (c: Gazetteer['countries'][number]) => string;
    searchCountries: (q: string, countries: Gazetteer['countries']) => { country: Gazetteer['countries'][number]; via: string }[];
  };
  // @ts-expect-error — plain JS with no declaration file; the shape is Picker.
  const picker = import('./public/countries.mjs') as Promise<Picker>;
  const gazetteer = async (lang: string): Promise<Gazetteer> => (await (await countriesRoute.request(`/countries.json?lang=${lang}`)).json()) as Gazetteer;

  it('sends no second name in English', async () => {
    const { countries } = await gazetteer('en');
    assert.deepEqual(countries.filter((c) => 'local' in c), []);
  });

  for (const lang of ['en', 'uk', 'en-XA'] as const) {
    it(`writes the chip the server writes, and the save reads it back (${lang})`, async () => {
      const { chipText } = await picker;
      const { countries } = await gazetteer(lang);
      for (const country of countries) {
        const chip = chipText(country);
        assert.equal(chip, withLocale(lang, () => countryChip(country.code)), country.code);
        assert.equal(findCountry(chip)?.code, country.code, chip);
      }
    });
  }

  it('finds a country by its name in the language, comma and all', async () => {
    const { searchCountries, chipText } = await picker;
    const { countries } = await gazetteer('uk');
    assert.equal(searchCountries('Німеч', countries)[0]?.country.code, 'DE');
    const hk = countries.find((c) => c.code === 'HK')!;
    assert.match(hk.local ?? '', /,/);
    assert.equal(chipText(hk), '🇭🇰 Гонконг');
  });
});
