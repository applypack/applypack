import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBornName, searchName } from './search-names';
import { withLocale } from './i18n/locale';

describe('searchName (#652)', () => {
  it('words the names a search is born with in the reader’s language', () => {
    assert.equal(searchName('My profile'), 'My search');
    assert.equal(withLocale('uk', () => searchName('My profile')), 'Мій пошук');
    assert.equal(withLocale('fr', () => searchName('New profile')), 'Nouvelle recherche');
  });

  it('leaves a name the person typed as it is', () => {
    assert.equal(withLocale('uk', () => searchName('Senior Full-Stack Developer')), 'Senior Full-Stack Developer');
    assert.equal(searchName('my profile'), 'my profile');
  });
});

describe('isBornName', () => {
  it('knows a born name as stored and as any language showed it and saved it back', () => {
    for (const name of ['My profile', 'New profile', 'My search', 'Мій пошук', 'Nueva búsqueda']) assert.ok(isBornName(name), name);
    assert.equal(isBornName('Backend in Berlin'), false);
  });
});
