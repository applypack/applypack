import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNav } from './run-nav';

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
