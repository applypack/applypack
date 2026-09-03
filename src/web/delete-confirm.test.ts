import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { companyDeleteConfirm, deleteConfirm, type DeleteImpact } from './delete-confirm';

const NONE: DeleteImpact = {
  matches: 0,
  letters: 0,
  reviews: 0,
  searches: 0,
  applications: 0,
};

describe('deleteConfirm', () => {
  it('names every cascade — letters and strength reviews included', () => {
    assert.equal(
      deleteConfirm('Senior Backend', { ...NONE, matches: 12, letters: 3, reviews: 2 }),
      'Delete "Senior Backend" and 12 comparisons, 3 cover letters and 2 strength reviews? This cannot be undone.',
    );
  });

  it('drops the parts that are empty', () => {
    assert.equal(
      deleteConfirm('Senior Backend', { ...NONE, matches: 4 }),
      'Delete "Senior Backend" and 4 comparisons? This cannot be undone.',
    );
    assert.equal(
      deleteConfirm('Senior Backend', { ...NONE, letters: 2 }),
      'Delete "Senior Backend" and 2 cover letters? This cannot be undone.',
    );
    assert.equal(
      deleteConfirm('Senior Backend', { ...NONE, reviews: 1 }),
      'Delete "Senior Backend" and 1 strength review? This cannot be undone.',
    );
  });

  it('says so plainly when nothing is attached', () => {
    assert.equal(
      deleteConfirm('Draft', NONE),
      'Delete "Draft"? Nothing else is attached to it.',
    );
  });

  it('speaks singular for one of each', () => {
    assert.equal(
      deleteConfirm('CV', { ...NONE, matches: 1, letters: 1, reviews: 1 }),
      'Delete "CV" and 1 comparison, 1 cover letter and 1 strength review? This cannot be undone.',
    );
  });

  // SetNull, not Cascade: these survive the delete. The dialog said nothing
  // about either, so a search silently fell back to guessing its resume.
  it('names the searches that stop hunting with it', () => {
    assert.equal(
      deleteConfirm('Senior Backend', { ...NONE, searches: 1 }),
      'Delete "Senior Backend"? 1 search stops hunting with it. This cannot be undone.',
    );
    assert.equal(
      deleteConfirm('Senior Backend', { ...NONE, searches: 3 }),
      'Delete "Senior Backend"? 3 searches stop hunting with it. This cannot be undone.',
    );
  });

  it('names the applications that lose the resume name', () => {
    assert.equal(
      deleteConfirm('Senior Backend', { ...NONE, applications: 1 }),
      'Delete "Senior Backend"? 1 application will show "a deleted resume" instead. This cannot be undone.',
    );
    assert.equal(
      deleteConfirm('Senior Backend', { ...NONE, applications: 2 }),
      'Delete "Senior Backend"? 2 applications will show "a deleted resume" instead. This cannot be undone.',
    );
  });

  it('keeps what is deleted and what merely unlinks in separate clauses', () => {
    assert.equal(
      deleteConfirm('Senior Backend', {
        matches: 12,
        letters: 3,
        reviews: 0,
        searches: 1,
        applications: 2,
      }),
      'Delete "Senior Backend" and 12 comparisons and 3 cover letters?' +
        ' 1 search stops hunting with it and 2 applications will show "a deleted resume" instead.' +
        ' This cannot be undone.',
    );
  });
});

describe('companyDeleteConfirm', () => {
  it('names what rides along with the jobs', () => {
    // Measured on the live database: "Delete Reddit and all its 73 jobs?" was
    // hiding six applications and a cover letter.
    assert.equal(
      companyDeleteConfirm('Reddit', { jobs: 73, applications: 6, comparisons: 0, letters: 1 }),
      'Delete "Reddit", 73 jobs, and with them 6 tracked applications and 1 cover letter? This cannot be undone.',
    );
  });

  it('stays short when only the jobs would go', () => {
    assert.equal(
      companyDeleteConfirm('Acme', { jobs: 12, applications: 0, comparisons: 0, letters: 0 }),
      'Delete "Acme" and 12 jobs? This cannot be undone.',
    );
  });

  it('handles a company that never posted anything', () => {
    assert.match(
      companyDeleteConfirm('Acme', { jobs: 0, applications: 0, comparisons: 0, letters: 0 }),
      /and no jobs\?/,
    );
  });

  it('uses the singular for one of each', () => {
    assert.match(
      companyDeleteConfirm('Acme', { jobs: 1, applications: 1, comparisons: 1, letters: 1 }),
      /1 job, and with them 1 tracked application, 1 resume comparison and 1 cover letter/,
    );
  });
});
