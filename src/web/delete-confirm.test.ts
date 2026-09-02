import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deleteConfirm } from './delete-confirm';

describe('deleteConfirm', () => {
  it('names every cascade — letters and strength reviews included', () => {
    assert.equal(
      deleteConfirm('Senior Backend', { matches: 12, letters: 3, reviews: 2 }),
      'Delete "Senior Backend" and 12 comparisons, 3 cover letters and 2 strength reviews? This cannot be undone.',
    );
  });

  it('drops the parts that are empty', () => {
    assert.equal(
      deleteConfirm('Senior Backend', { matches: 4, letters: 0, reviews: 0 }),
      'Delete "Senior Backend" and 4 comparisons? This cannot be undone.',
    );
    assert.equal(
      deleteConfirm('Senior Backend', { matches: 0, letters: 2, reviews: 0 }),
      'Delete "Senior Backend" and 2 cover letters? This cannot be undone.',
    );
    assert.equal(
      deleteConfirm('Senior Backend', { matches: 0, letters: 0, reviews: 1 }),
      'Delete "Senior Backend" and 1 strength review? This cannot be undone.',
    );
  });

  it('says so plainly when nothing is attached', () => {
    assert.equal(
      deleteConfirm('Draft', { matches: 0, letters: 0, reviews: 0 }),
      'Delete "Draft"? Nothing else is attached to it.',
    );
  });

  it('speaks singular for one of each', () => {
    assert.equal(
      deleteConfirm('CV', { matches: 1, letters: 1, reviews: 1 }),
      'Delete "CV" and 1 comparison, 1 cover letter and 1 strength review? This cannot be undone.',
    );
  });
});
