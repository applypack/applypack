import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addresseeFromFinding, greetingOf } from './addressee';

test('reads the person out of a verifier finding, never a role, a vendor or the company', () => {
  const live =
    "References 'Ben' on the team. Verified: Ben Davies is real Product Engineering Team Lead at Hospitable (confirmed via The Org, LinkedIn, Apollo.io).";
  assert.equal(addresseeFromFinding(live, 'Hospitable.com'), 'Ben Davies');
  assert.equal(addresseeFromFinding('Hiring Manager not named; the posting is anonymous.', 'Acme'), null);
  assert.equal(addresseeFromFinding('Reach out to Anna-Maria Kowalski, Head of Talent Acquisition.', 'Acme'), 'Anna-Maria Kowalski');
  assert.equal(addresseeFromFinding('Acme Robotics lists no recruiter.', 'Acme Robotics'), null);
  assert.equal(addresseeFromFinding('The LinkedIn Page names nobody.', 'Acme'), null);
});

test('a stored letter tells who it greeted, so a regenerate keeps the name', () => {
  assert.equal(greetingOf('Hi Ben Davies,\n\nI am writing…'), 'Ben Davies');
  assert.equal(greetingOf('Dear Anna-Maria Kowalski,\n…'), 'Anna-Maria Kowalski');
  assert.equal(greetingOf('Hi Hospitable team,\n…'), null);
  assert.equal(greetingOf('Dear Hiring Manager,\n…'), null);
  assert.equal(greetingOf('No greeting at all'), null);
});
