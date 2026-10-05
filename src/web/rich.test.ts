import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tRich } from './rich';
import { PSEUDO_LOCALE, withLocale } from '../i18n/locale';

describe('tRich', () => {
  const link = (words: unknown[]) => `<a>${words.join('')}</a>`;

  it('hands each inline element to its renderer, with the words it wraps', () => {
    const parts = tRich('settings.language.unfinishedNote', {}, { link });
    assert.equal(parts.length, 3);
    assert.equal(parts[1], '<a>the catalog files</a>');
    assert.equal(withLocale('uk', () => tRich('settings.language.unfinishedNote', {}, { link }))[1], '<a>файлах каталогу</a>');
  });

  it('keeps the words of an element nobody rendered', () => {
    assert.equal(tRich('settings.language.unfinishedNote', {}, {}).join('').includes('the catalog files'), true);
  });

  it('carries the pseudo brackets around the whole sentence', () => {
    const parts = withLocale(PSEUDO_LOCALE, () => tRich('settings.language.unfinishedNote', {}, { link }));
    assert.equal(parts[0], '⟦');
    assert.equal(parts.at(-1), '⟧');
  });
});
