import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLandsOn, runNav } from './run-nav';

test("a run's page lights the menu entry it returns to", () => {
  assert.equal(runNav('/jobs/309?match=1#resume-match'), 'jobs');
  assert.equal(runNav('/jobs'), 'jobs');
  assert.equal(runNav('/jobs/import'), 'jobs');
  assert.equal(runNav('/resumes/4'), 'resumes');
  assert.equal(runNav('/screen/2'), 'screen');
  assert.equal(runNav('/letter'), 'letter');
  assert.equal(runNav('/target'), 'target');
  // Setup lights nothing, and a lookalike path is not its neighbour.
  assert.equal(runNav('/welcome?step=matches'), undefined);
  assert.equal(runNav('/jobsearch'), undefined);
});

test('#580: the line under the steps says where the result lands, by where the run came from', () => {
  // A resume's own runs: a scan of an upload, Resume strength, Save as vN without a job, the shape read with AI.
  assert.equal(runLandsOn('/resumes/4'), 'target.run.closeResume');
  assert.equal(runLandsOn('/resumes/4/render?shape=text'), 'target.run.closeResume');
  // Is it real?, Compare and a letter from the job page, Save as vN from Tailor, a letter from /letter, a paste on Tailor resume.
  assert.equal(runLandsOn('/jobs/309?tab=verify#verification'), 'target.run.closeJob');
  assert.equal(runLandsOn('/jobs/309/target'), 'target.run.closeJob');
  assert.equal(runLandsOn('/letter'), 'target.run.closeJob');
  assert.equal(runLandsOn('/target'), 'target.run.closeJob');
  assert.equal(runLandsOn('/welcome?step=matches'), 'target.run.closeSetup');
  assert.equal(runLandsOn('/jobs'), 'target.run.closeImport');
  assert.equal(runLandsOn('/jobs/import'), 'target.run.closeImport');
  assert.equal(runLandsOn('/screen/2/compare?ids=1,2'), 'target.run.closeScreening');
  assert.equal(runLandsOn('/settings?tab=ai'), 'target.run.closeSettings');
});
