import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginScan, liveScanRun } from './scan-run';
import { getRun } from './target-runs';
import type { ResumeScan } from '../resume/prompts';

const copy = { subtitle: 'Reading it', onScanned: (s: ResumeScan) => `Scanned: ${s.skills.length} skills`, onFailed: 'Scan failed' };
const scanned = { skills: ['Node.js', 'TypeScript'], issues: [] } as unknown as ResumeScan;

/** A scan that waits for the test to answer it, counting how often it was asked. */
function pendingScan() {
  let answer: (scan: ResumeScan | null) => void = () => {};
  const scan = { calls: 0, answer: (s: ResumeScan | null) => answer(s) };
  const fn = () => {
    scan.calls++;
    return new Promise<ResumeScan | null>((resolve) => (answer = resolve));
  };
  return { scan, fn };
}

const settle = () => new Promise((r) => setImmediate(r));

test('#608: a Scan press while a save’s scan runs joins it instead of paying for a second one', async () => {
  const resume = { id: 6081, name: 'Alex Rivera', text: `Alex Rivera\nSenior Backend Engineer ${Math.random()}` };
  const { scan, fn } = pendingScan();
  const behindTheSave = beginScan(resume, copy, fn);
  assert.equal(behindTheSave.joined, false);
  // The resume page finds it, and says so instead of "Not scanned yet".
  assert.equal(liveScanRun(resume)?.id, behindTheSave.run.id);

  const pressed = beginScan(resume, copy, fn);
  assert.equal(pressed.joined, true);
  assert.equal(pressed.run.id, behindTheSave.run.id);
  assert.equal(scan.calls, 1, 'one AI call, not two');

  scan.answer(scanned);
  await settle();
  const done = getRun(behindTheSave.run.id);
  assert.equal(done?.stage, 'done');
  assert.equal(done?.resultUrl, '/resumes/6081');
  assert.equal(done?.flash, 'Scanned: 2 skills');
  assert.equal(liveScanRun(resume), null, 'a finished scan is not offered as running');
});

test('a scan of another text, or of another resume, is a run of its own', () => {
  const resume = { id: 6082, name: 'Alex Rivera', text: `Alex Rivera ${Math.random()}` };
  const { fn } = pendingScan();
  const first = beginScan(resume, copy, fn);
  assert.equal(beginScan({ ...resume, text: `${resume.text} edited` }, copy, fn).joined, false);
  assert.equal(beginScan({ ...resume, id: 6083 }, copy, fn).joined, false);
  assert.equal(liveScanRun({ ...resume, text: 'never scanned' }), null);
  assert.equal(liveScanRun(resume)?.id, first.run.id);
});

test('a scan that comes back empty ends the run on its failure sentence', async () => {
  const resume = { id: 6084, name: 'Alex Rivera', text: `Alex Rivera ${Math.random()}` };
  const { scan, fn } = pendingScan();
  const { run } = beginScan(resume, copy, fn);
  scan.answer(null);
  await settle();
  assert.equal(getRun(run.id)?.stage, 'error');
  assert.equal(getRun(run.id)?.error, 'Scan failed');
});
