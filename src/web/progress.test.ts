import { test } from 'node:test';
import assert from 'node:assert/strict';

interface Link {
  href: string;
  target?: string | null;
  download?: boolean;
}
interface Click {
  defaultPrevented?: boolean;
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

// @ts-expect-error — plain JS with no declaration file; the shape is asserted below.
const progress = import('./public/progress.mjs') as Promise<{
  nextWidth: (current: number) => number;
  shouldTrack: (link: Link | null, event: Click, currentUrl: string) => boolean;
  init: unknown;
}>;

const HERE = 'http://127.0.0.1:4747/jobs?status=NEW';
const plainClick: Click = { button: 0 };

test('nextWidth creeps fast at first and slows toward the ceiling', async () => {
  const { nextWidth } = await progress;
  const first = nextWidth(0);
  const late = nextWidth(80) - 80;
  assert.ok(first > late, `first step ${first} should outpace late step ${late}`);
});

test('nextWidth never reaches 100 — only a new document ends the bar', async () => {
  const { nextWidth } = await progress;
  let w = 0;
  for (let i = 0; i < 500; i++) w = nextWidth(w);
  assert.equal(w, 90);
});

test('nextWidth keeps a visible floor so a long wait still moves', async () => {
  const { nextWidth } = await progress;
  assert.ok(nextWidth(89.9) > 89.9);
  assert.equal(nextWidth(-5), 0);
});

test('shouldTrack follows an ordinary in-app link', async () => {
  const { shouldTrack } = await progress;
  assert.equal(shouldTrack({ href: 'http://127.0.0.1:4747/settings' }, plainClick, HERE), true);
});

test('shouldTrack ignores clicks that open somewhere else', async () => {
  const { shouldTrack } = await progress;
  const link = { href: 'http://127.0.0.1:4747/settings' };
  assert.equal(shouldTrack({ ...link, target: '_blank' }, plainClick, HERE), false);
  assert.equal(shouldTrack({ ...link, download: true }, plainClick, HERE), false);
  assert.equal(shouldTrack(link, { ...plainClick, metaKey: true }, HERE), false);
  assert.equal(shouldTrack(link, { ...plainClick, ctrlKey: true }, HERE), false);
  assert.equal(shouldTrack(link, { button: 1 }, HERE), false);
});

test('shouldTrack ignores a link another handler already cancelled', async () => {
  const { shouldTrack } = await progress;
  const link = { href: 'http://127.0.0.1:4747/settings' };
  assert.equal(shouldTrack(link, { ...plainClick, defaultPrevented: true }, HERE), false);
});

test('shouldTrack ignores anything that is not an http(s) page load', async () => {
  const { shouldTrack } = await progress;
  assert.equal(shouldTrack({ href: 'mailto:a@b.co' }, plainClick, HERE), false);
  assert.equal(shouldTrack({ href: 'https://greenhouse.io/jobs/1' }, plainClick, HERE), false);
  assert.equal(shouldTrack({ href: '' }, plainClick, HERE), false);
  assert.equal(shouldTrack(null, plainClick, HERE), false);
});

test('shouldTrack ignores a fragment on the current page but follows one elsewhere', async () => {
  const { shouldTrack } = await progress;
  // The layout's skip link and #stages on settings only scroll.
  assert.equal(shouldTrack({ href: `${HERE}#main` }, plainClick, HERE), false);
  assert.equal(
    shouldTrack({ href: 'http://127.0.0.1:4747/settings#stages' }, plainClick, HERE),
    true,
  );
});
