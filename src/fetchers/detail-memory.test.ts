import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planDetails, readDetails } from './detail-memory';

const opts = (cap: number) => ({ cap, delayMs: 0, source: 'test' });

describe('planDetails', () => {
  it('asks for what is not remembered, in list order, up to the cap', () => {
    assert.deepEqual(planDetails(['a', 'b', 'c', 'd'], new Set(['b']), 2), ['a', 'c']);
    assert.deepEqual(planDetails(['a', 'b'], new Set(['a', 'b']), 60), []);
    assert.deepEqual(planDetails(['a'], new Set(), 0), []);
  });
});

describe('readDetails — a board longer than the cap is read over a few ticks (#658)', () => {
  it('reads the cap, leaves the rest waiting, then reads only what it has not', async () => {
    const memory = new Map<string, string>();
    const asked: string[] = [];
    const readOne = async (id: string) => {
      asked.push(id);
      return `text of ${id}`;
    };
    const first = await readDetails(memory, ['a', 'b', 'c'], readOne, opts(2));
    assert.deepEqual([...first.details.keys()], ['a', 'b']);
    assert.equal(first.waiting, 1);
    assert.equal(first.requested, 2);
    const second = await readDetails(memory, ['a', 'b', 'c'], readOne, opts(2));
    assert.deepEqual([...second.details.keys()], ['a', 'b', 'c']);
    assert.equal(second.waiting, 0);
    // The third tick asks nothing: every listed posting is known.
    const third = await readDetails(memory, ['a', 'b', 'c'], readOne, opts(2));
    assert.equal(third.requested, 0);
    assert.deepEqual(asked, ['a', 'b', 'c']);
  });

  it('forgets a posting the board no longer lists', async () => {
    const memory = new Map([['gone', 'old'], ['kept', 'text']]);
    const read = await readDetails(memory, ['kept'], async () => 'new', opts(5));
    assert.deepEqual([...memory.keys()], ['kept']);
    assert.equal(read.requested, 0);
  });

  it('leaves a failed posting waiting while the others go out', async () => {
    const memory = new Map<string, string>();
    const read = await readDetails(
      memory,
      ['a', 'b', 'c'],
      async (id) => {
        if (id === 'b') throw new Error('timed out after 8000ms');
        return id === 'c' ? null : id;
      },
      opts(5),
    );
    assert.deepEqual([...read.details.keys()], ['a']);
    assert.equal(read.waiting, 2);
  });

  it('fails the read when every request failed, so the board is not called empty (gotcha 13)', async () => {
    await assert.rejects(
      readDetails(new Map(), ['a', 'b'], async () => { throw new Error('HTTP 503'); }, opts(5)),
      /HTTP 503/,
    );
    await assert.rejects(readDetails(new Map(), ['a'], async () => null, opts(5)), /no detail answer had the expected shape/);
    // Nothing asked is nothing failed.
    const none = await readDetails(new Map(), [], async () => 'x', opts(5));
    assert.equal(none.requested, 0);
  });
});
