import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCALES,
  PSEUDO_LOCALE,
  currentLocale,
  intlTag,
  isLocale,
  isSelectableLocale,
  matchAcceptLanguage,
  offeredLocales,
  unfinishedLocales,
  withLocale,
  type Locale,
} from './locale';

describe('the language of the moment', () => {
  it('is English outside any context, so a script and a test read as before', () => {
    assert.equal(currentLocale(), 'en');
    assert.equal(intlTag(), 'en-US');
  });

  it('is what the context set, through an await, and nests', async () => {
    await withLocale('uk', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      assert.equal(currentLocale(), 'uk');
      assert.equal(withLocale('en', () => currentLocale()), 'en');
      assert.equal(currentLocale(), 'uk');
    });
    assert.equal(currentLocale(), 'en');
  });
});

describe('the registry', () => {
  it('offers English, and never the pseudo-language', () => {
    assert.ok(offeredLocales().includes('en'));
    assert.ok(![...offeredLocales(), ...unfinishedLocales()].includes(PSEUDO_LOCALE));
    assert.equal(isLocale(PSEUDO_LOCALE), true);
    assert.equal(isSelectableLocale(PSEUDO_LOCALE), false);
  });

  it('knows a code only as written', () => {
    for (const value of ['EN', 'en-US', 'toString', '', null, undefined, 7]) assert.equal(isLocale(value), false, String(value));
    assert.equal(isSelectableLocale('en'), true);
  });

  it('gives every language a tag Intl accepts, with Latin digits', () => {
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      const tag = intlTag(locale);
      assert.deepEqual(Intl.NumberFormat.supportedLocalesOf([tag]), [tag], locale);
      assert.equal(new Intl.NumberFormat(tag).resolvedOptions().numberingSystem, 'latn', locale);
      assert.equal(new Intl.DateTimeFormat(tag).resolvedOptions().numberingSystem, 'latn', locale);
    }
  });
});

describe('matchAcceptLanguage', () => {
  const among: Locale[] = ['en', 'uk'];

  it('takes the first offered language in the browser\'s order', () => {
    assert.equal(matchAcceptLanguage('uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7', among), 'uk');
    assert.equal(matchAcceptLanguage('en-GB,en;q=0.9,uk;q=0.8', among), 'en');
    assert.equal(matchAcceptLanguage('pl,uk;q=0.8,en;q=0.5', among), 'uk');
  });

  it('reads the weights, not the order they are written in', () => {
    assert.equal(matchAcceptLanguage('en;q=0.3, uk;q=0.9', among), 'uk');
    assert.equal(matchAcceptLanguage('uk;q=0, en', among), 'en');
  });

  it('ignores the region and the case', () => {
    assert.equal(matchAcceptLanguage('UK-ua', among), 'uk');
    assert.equal(matchAcceptLanguage('uk_UA', among), 'uk');
  });

  it('reads a weight whatever case its name is written in (#368)', () => {
    assert.equal(matchAcceptLanguage('uk;Q=0.1, en;q=0.5', among), 'en');
  });

  it('has nothing to say for a header that names none of them, or for none at all', () => {
    assert.equal(matchAcceptLanguage('pl,de;q=0.8', among), null);
    assert.equal(matchAcceptLanguage('*', among), null);
    assert.equal(matchAcceptLanguage('', among), null);
    assert.equal(matchAcceptLanguage(undefined, among), null);
    assert.equal(matchAcceptLanguage('uk', ['en']), null);
  });

  it('survives a header that is not one', () => {
    assert.equal(matchAcceptLanguage(';;;,,q=,;q=abc,uk;q=abc', among), null);
    assert.equal(matchAcceptLanguage(`${'xx,'.repeat(500)}uk`, among), null);
  });
});
