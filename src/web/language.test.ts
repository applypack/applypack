import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { backFor, languagePage, resolveLanguage, withLanguagePage } from './language';
import { PSEUDO_LOCALE, type Locale } from '../i18n/locale';

/** What the switcher will offer once Ukrainian opens; until then only English is, and nothing is ever proposed. */
const OFFERED: Locale[] = ['en', 'uk'];

describe('resolveLanguage', () => {
  it('answers in the stored language, whatever the browser asks for', () => {
    assert.deepEqual(resolveLanguage({ stored: 'uk', setupCompleted: true, acceptLanguage: 'en-US,en;q=0.9' }), { locale: 'uk', invite: null });
    assert.deepEqual(resolveLanguage({ stored: 'en', setupCompleted: false, acceptLanguage: 'uk' }), { locale: 'en', invite: null });
  });

  it('never flips an install that is set up: English, whatever the browser says', () => {
    for (const acceptLanguage of ['uk-UA,uk;q=0.9', 'de', undefined]) {
      assert.equal(resolveLanguage({ stored: null, setupCompleted: true, acceptLanguage }).locale, 'en');
    }
  });

  it('offers nothing to a browser that asks for English, or for a language that is not offered', () => {
    assert.equal(resolveLanguage({ stored: null, setupCompleted: true, acceptLanguage: 'en-GB,en;q=0.9' }).invite, null);
    assert.equal(resolveLanguage({ stored: null, setupCompleted: true, acceptLanguage: 'xx-XX' }).invite, null);
    assert.equal(resolveLanguage({ stored: null, setupCompleted: false, acceptLanguage: 'xx-XX' }).locale, 'en');
  });

  it('opens a first run in the browser\'s language', () => {
    assert.deepEqual(resolveLanguage({ stored: null, setupCompleted: false, acceptLanguage: 'uk-UA,uk;q=0.9,en;q=0.5' }, OFFERED), { locale: 'uk', invite: null });
  });

  it('invites an install already set up, once, in the browser\'s language — and only when it prefers it to English', () => {
    assert.deepEqual(resolveLanguage({ stored: null, setupCompleted: true, acceptLanguage: 'uk-UA,uk;q=0.9,en;q=0.5' }, OFFERED), { locale: 'en', invite: 'uk' });
    assert.equal(resolveLanguage({ stored: null, setupCompleted: true, acceptLanguage: 'en,uk;q=0.5' }, OFFERED).invite, null);
    // Either answer to the invitation is a stored choice, and a stored choice is never asked again.
    assert.equal(resolveLanguage({ stored: 'en', setupCompleted: true, acceptLanguage: 'uk' }, OFFERED).invite, null);
  });

  it('proposes no language that is not offered yet', () => {
    assert.deepEqual(resolveLanguage({ stored: null, setupCompleted: true, acceptLanguage: 'uk' }, ['en']), { locale: 'en', invite: null });
    assert.deepEqual(resolveLanguage({ stored: null, setupCompleted: false, acceptLanguage: 'uk' }, ['en']), { locale: 'en', invite: null });
  });

  it('reads a stored code it does not know as no choice at all', () => {
    assert.deepEqual(resolveLanguage({ stored: 'tlh', setupCompleted: true, acceptLanguage: undefined }), { locale: 'en', invite: null });
  });

  it('honours the pseudo-language when stored: the route smoke sets it', () => {
    assert.equal(resolveLanguage({ stored: PSEUDO_LOCALE, setupCompleted: true, acceptLanguage: 'en' }).locale, PSEUDO_LOCALE);
  });
});

describe('the page around the switcher', () => {
  it('returns to the page a GET drew, and to the Overview after anything else', () => {
    assert.equal(backFor('GET', 'http://localhost:4747/jobs?status=NEW&q=node'), '/jobs?status=NEW&q=node');
    assert.equal(backFor('GET', 'http://localhost:4747/'), '/');
    assert.equal(backFor('POST', 'http://localhost:4747/resumes/3/compare-format'), '/');
  });

  it('offers nothing outside a request', () => {
    assert.deepEqual(languagePage(), { invite: null, back: '/' });
    assert.deepEqual(withLanguagePage({ invite: 'uk', back: '/jobs' }, () => languagePage()), { invite: 'uk', back: '/jobs' });
  });
});
