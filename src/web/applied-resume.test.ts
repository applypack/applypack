import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appliedResumeColumns,
  needsAppliedResume,
  packAsShown,
  packChoiceValue,
  readAppliedResumeChoice,
} from './applied-resume';

describe('readAppliedResumeChoice', () => {
  it('an absent field says nothing — a page with no picker must not erase a record', () => {
    assert.deepEqual(readAppliedResumeChoice(undefined), { kind: 'keep' });
    assert.deepEqual(readAppliedResumeChoice(null), { kind: 'keep' });
  });

  it('an empty value is a real answer: record nothing', () => {
    assert.deepEqual(readAppliedResumeChoice(''), { kind: 'clear' });
    assert.deepEqual(readAppliedResumeChoice('   '), { kind: 'clear' });
  });

  it('an id is the answer it looks like', () => {
    assert.deepEqual(readAppliedResumeChoice('7'), { kind: 'set', id: 7 });
    assert.deepEqual(readAppliedResumeChoice(7), { kind: 'set', id: 7 });
  });

  it('junk changes nothing rather than clearing a recorded application', () => {
    assert.deepEqual(readAppliedResumeChoice('abc'), { kind: 'keep' });
    assert.deepEqual(readAppliedResumeChoice('-3'), { kind: 'keep' });
    assert.deepEqual(readAppliedResumeChoice('1.5'), { kind: 'keep' });
  });
});

describe('the application pack as the file that went out', () => {
  const at = new Date('2026-10-10T08:00:00.000Z');
  const ready = { status: 'ready', sentAt: null, text: 'the tailored text', resumeId: 3, finishedAt: at };

  it('is offered while a ready pack nobody froze exists, and names that preparing', () => {
    assert.equal(packChoiceValue(ready), `pack-${at.getTime()}`);
    assert.deepEqual(readAppliedResumeChoice(packChoiceValue(ready)), { kind: 'pack', at: at.getTime() });
    for (const not of [null, { ...ready, status: 'running' }, { ...ready, status: 'stopped' }, { ...ready, sentAt: at }, { ...ready, text: null }, { ...ready, resumeId: null }, { ...ready, finishedAt: null }]) {
      assert.equal(packChoiceValue(not), null);
    }
  });

  it('is taken only when the pack is still the one the page showed', () => {
    assert.equal(packAsShown(ready, at.getTime()), ready);
    // Prepared again in another tab: a later preparing, another file.
    assert.equal(packAsShown({ ...ready, finishedAt: new Date(at.getTime() + 60_000) }, at.getTime()), null);
    // Being prepared again right now, or frozen already.
    assert.equal(packAsShown({ ...ready, status: 'queued', text: null, finishedAt: null }, at.getTime()), null);
    assert.equal(packAsShown({ ...ready, sentAt: at }, at.getTime()), null);
    assert.equal(packAsShown(null, at.getTime()), null);
    // A value that names no preparing (an older page's form, a typed one) is taken for none.
    assert.equal(packAsShown(ready, readAppliedResumeChoice('pack-').kind === 'pack' ? 0 : -1), null);
    assert.equal(packAsShown(ready, Number('x')), null);
  });
});

describe('appliedResumeColumns', () => {
  const resume = { id: 4, version: 3, text: 'Senior backend engineer…', hidden: false };

  it('records the id, the version AND the text — the bytes move under the version', () => {
    assert.deepEqual(appliedResumeColumns(resume), {
      appliedResumeId: 4,
      appliedResumeVersion: 3,
      appliedResumeText: 'Senior backend engineer…',
    });
  });

  it('a resume deleted in another tab records nothing instead of blocking the change', () => {
    assert.deepEqual(appliedResumeColumns(null), {
      appliedResumeId: null,
      appliedResumeVersion: null,
      appliedResumeText: null,
    });
  });

  it('the /target scratch row is never an application', () => {
    assert.equal(appliedResumeColumns({ ...resume, hidden: true }).appliedResumeId, null);
  });
});

describe('needsAppliedResume', () => {
  const applied = { appliedResumeId: null, appliedAt: null, pipelineStage: null, status: 'NEW' };

  it('a card dragged into a funnel column left the question unanswered', () => {
    assert.equal(needsAppliedResume({ ...applied, pipelineStage: 'applied' }), true);
  });

  it('so did the application form with a date and no resume', () => {
    assert.equal(needsAppliedResume({ ...applied, appliedAt: new Date() }), true);
  });

  it('and so did "Mark applied" with the picker set to "don\'t record"', () => {
    assert.equal(needsAppliedResume({ ...applied, status: 'APPLIED' }), true);
  });

  it('never asks once an answer is stored', () => {
    assert.equal(needsAppliedResume({ ...applied, appliedResumeId: 4, status: 'APPLIED' }), false);
  });

  it('never asks about a job that was never applied to', () => {
    assert.equal(needsAppliedResume(applied), false);
  });
});
