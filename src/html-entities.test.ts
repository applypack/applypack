import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { namedEntity } from './html-entities';

describe('namedEntity', () => {
  it('gives each name the character HTML 5 gives it', () => {
    assert.equal(namedEntity('eacute'), 'é');
    assert.equal(namedEntity('yuml'), 'ÿ');
    assert.equal(namedEntity('Omega'), 'Ω');
    assert.equal(namedEntity('sigmaf'), 'ς');
    assert.equal(namedEntity('mdash'), '—');
    // HTML 4 drew these from U+2329; HTML 5, and every browser, from U+27E8.
    assert.equal(namedEntity('lang'), '⟨');
  });

  it('knows names by their case, and only the basic six in capitals', () => {
    assert.equal(namedEntity('Eacute'), 'É');
    assert.equal(namedEntity('QUOT'), '"');
    assert.equal(namedEntity('EACUTE'), undefined);
    assert.equal(namedEntity('nope'), undefined);
  });
});
