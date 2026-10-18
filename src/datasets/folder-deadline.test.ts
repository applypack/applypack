import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NoAnswer, deadlines } from './folder-deadline';

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
/** A promise and the way to settle it from outside. */
function held<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('a call that answers in time gives its answer, or its own error', async () => {
  const d = deadlines(200);
  assert.equal(await d.inTime('/inbox', async () => 'listing'), 'listing');
  await assert.rejects(d.inTime('/inbox', async () => Promise.reject(Object.assign(new Error('no such folder'), { code: 'ENOENT' }))), { code: 'ENOENT' });
  assert.equal(d.stalled('/inbox'), false);
});

// #397: a listing that never came back held the fetch lock for ever, and every source stopped.
test('a call that does not answer in time ends as NoAnswer, and the folder is stalled', async () => {
  const d = deadlines(30);
  const started = Date.now();
  await assert.rejects(d.inTime('/nas/jobs', never), NoAnswer);
  assert.ok(Date.now() - started < 2_000);
  assert.equal(d.stalled('/nas/jobs'), true);
  assert.equal(d.stalled('/home/jobs'), false);
});

test('a stalled folder is asked nothing more: the next call fails at once and is never made', async () => {
  const d = deadlines(30);
  await assert.rejects(d.inTime('/nas/jobs', never), NoAnswer);
  let made = 0;
  const started = Date.now();
  await assert.rejects(d.inTime('/nas/jobs', async () => ++made), NoAnswer);
  assert.deepEqual([made, Date.now() - started < 25], [0, true]);
  // Another folder is asked as usual.
  assert.equal(await d.inTime('/home/jobs', async () => ++made), 1);
});

test('the folder is asked again once the call that was out comes home, with an answer or an error', async () => {
  const d = deadlines(30);
  const slow = held<string>();
  await assert.rejects(d.inTime('/nas/jobs', () => slow.promise), NoAnswer);
  assert.equal(d.stalled('/nas/jobs'), true);
  slow.resolve('the disk woke up');
  await new Promise((r) => setImmediate(r));
  assert.equal(d.stalled('/nas/jobs'), false);
  assert.equal(await d.inTime('/nas/jobs', async () => 'listing'), 'listing');
  // An error nobody is waiting for frees it too, and is nobody's unhandled rejection.
  const broken = held<string>();
  await assert.rejects(d.inTime('/nas/jobs', () => broken.promise), NoAnswer);
  broken.reject(new Error('EIO'));
  await new Promise((r) => setImmediate(r));
  assert.equal(d.stalled('/nas/jobs'), false);
});
