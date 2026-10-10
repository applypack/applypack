import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AtsType, JobStatus } from '@prisma/client';
import { handPickedSource, statusAfterRescore } from './rescore-status';

const { NEW, ALERTED, APPLIED, DISMISSED, SAVED } = JobStatus;

test('a saved job keeps Saved through any re-score: only a search-found row is dismissed', () => {
  // The live case (#389): a saved posting no search wants, Re-classify pressed, the row came back Dismissed.
  for (const handPicked of [true, false]) {
    assert.equal(statusAfterRescore(SAVED, false, handPicked), SAVED);
    assert.equal(statusAfterRescore(SAVED, true, handPicked), SAVED);
    assert.equal(statusAfterRescore(APPLIED, false, handPicked), APPLIED);
    assert.equal(statusAfterRescore(APPLIED, true, handPicked), APPLIED);
  }
});

test('a row a search brought in is dismissed when no search wants it any more', () => {
  assert.equal(statusAfterRescore(NEW, false, false), DISMISSED);
  assert.equal(statusAfterRescore(ALERTED, false, false), DISMISSED);
});

test('a hand-picked posting no search wants is kept Saved, as the ingest stores it', () => {
  assert.equal(statusAfterRescore(NEW, false, true), SAVED);
  assert.equal(statusAfterRescore(ALERTED, false, true), SAVED);
});

test('a posting a search still wants keeps its place, and a dismissed one comes back as New', () => {
  assert.equal(statusAfterRescore(NEW, true, false), NEW);
  assert.equal(statusAfterRescore(ALERTED, true, true), ALERTED);
  assert.equal(statusAfterRescore(DISMISSED, true, false), NEW);
  assert.equal(statusAfterRescore(DISMISSED, true, true), NEW);
});

test("the person's own dismissal is not undone by a score that agrees with it", () => {
  assert.equal(statusAfterRescore(DISMISSED, false, false), DISMISSED);
  assert.equal(statusAfterRescore(DISMISSED, false, true), DISMISSED);
});

test('hand-picked is a pasted posting or a file in a folder of postings, never rows a tool wrote', () => {
  assert.equal(handPickedSource({ atsType: AtsType.MANUAL, sourceConfig: null }), true);
  assert.equal(handPickedSource({ atsType: AtsType.FOLDER, sourceConfig: { holds: 'postings', mapping: null, include: null, alerts: 'off' } }), true);
  const mapping = { title: 'title', id: 'id' };
  assert.equal(handPickedSource({ atsType: AtsType.FOLDER, sourceConfig: { holds: 'rows', mapping } }), false);
  // A config stored before `holds` existed reads as rows.
  assert.equal(handPickedSource({ atsType: AtsType.FOLDER, sourceConfig: { mapping } }), false);
  assert.equal(handPickedSource({ atsType: AtsType.FOLDER, sourceConfig: null }), false);
  assert.equal(handPickedSource({ atsType: AtsType.IMPORT, sourceConfig: { holds: 'postings', mapping: null } }), false);
  assert.equal(handPickedSource({ atsType: AtsType.GREENHOUSE, sourceConfig: null }), false);
});
