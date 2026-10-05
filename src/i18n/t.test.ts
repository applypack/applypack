import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PSEUDO_LOCALE, withLocale } from './locale';
import { t, tParts } from './t';

describe('t', () => {
  it('is English outside a request', () => {
    assert.equal(t('nav.jobs'), 'Jobs');
    assert.equal(t('layout.newer', { version: '9.9.9' }), 'v9.9.9 is out');
  });

  it('is the language of the context', () => {
    assert.equal(withLocale('uk', () => t('nav.jobs')), 'Вакансії');
    assert.equal(withLocale('uk', () => t('time.ago.minutes', { n: 5 })), '5 хв тому');
  });

  it('picks the plural form by the language\'s own rules', () => {
    const active = (n: number) => withLocale('uk', () => t('ui.activeInside', { n }));
    assert.deepEqual([1, 3, 5, 21].map(active), ['активний', 'активні', 'активних', 'активний']);
  });

  it('gives an inline element\'s words as text, and the element as a part', () => {
    assert.equal(t('settings.language.unfinishedNote').includes('<'), false);
    assert.ok(tParts('settings.language.unfinishedNote').some((part) => typeof part !== 'string' && part.tag === 'link'));
  });

  it('marks everything in the pseudo-language, and says it in English', () => {
    assert.equal(withLocale(PSEUDO_LOCALE, () => t('nav.jobs')), '⟦Jobs⟧');
    assert.deepEqual(withLocale(PSEUDO_LOCALE, () => tParts('nav.jobs')), ['⟦', 'Jobs', '⟧']);
  });
});
