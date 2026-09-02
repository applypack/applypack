import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deleteConfirm } from './delete-confirm';

describe('deleteConfirm', () => {
  it('names both cascades, letters included', () => {
    assert.equal(
      deleteConfirm('Senior Backend', { matches: 12, letters: 3 }),
      'Delete "Senior Backend" and 12 comparisons and 3 cover letters? This cannot be undone.',
    );
  });

  it('drops the half that is empty', () => {
    assert.equal(
      deleteConfirm('Senior Backend', { matches: 4, letters: 0 }),
      'Delete "Senior Backend" and 4 comparisons? This cannot be undone.',
    );
    assert.equal(
      deleteConfirm('Senior Backend', { matches: 0, letters: 2 }),
      'Delete "Senior Backend" and 2 cover letters? This cannot be undone.',
    );
  });

  it('says so plainly when nothing is attached', () => {
    assert.equal(
      deleteConfirm('Draft', { matches: 0, letters: 0 }),
      'Delete "Draft"? Nothing else is attached to it.',
    );
  });

  it('speaks singular for one of each', () => {
    assert.equal(
      deleteConfirm('CV', { matches: 1, letters: 1 }),
      'Delete "CV" and 1 comparison and 1 cover letter? This cannot be undone.',
    );
  });
});
