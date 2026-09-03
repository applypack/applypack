import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appliedWithLabel } from './applied-with';

describe('appliedWithLabel', () => {
  it('names the resume and the version it was sent at', () => {
    assert.equal(appliedWithLabel({ name: 'Senior Backend', version: 3 }), 'Senior Backend v3');
  });

  it('is null when nothing was recorded', () => {
    assert.equal(appliedWithLabel(null), null);
    assert.equal(appliedWithLabel({ name: null, version: null }), null);
  });

  it('still answers after the resume row is deleted', () => {
    assert.equal(appliedWithLabel({ name: null, version: 3 }), 'a deleted resume v3');
  });

  it('drops the version when the snapshot predates one', () => {
    assert.equal(appliedWithLabel({ name: 'Senior Backend', version: null }), 'Senior Backend');
  });

  it('ignores a whitespace-only name', () => {
    assert.equal(appliedWithLabel({ name: '   ', version: 2 }), 'a deleted resume v2');
  });
});
