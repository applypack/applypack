import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applicantNotice, LEGAL_NOTE } from './notice';

describe('applicantNotice', () => {
  it('names the retention the install actually keeps', () => {
    assert.match(applicantNotice('hr@example.com', 90), /deleted 90 days after we receive them/);
    assert.match(applicantNotice('hr@example.com', 30), /deleted 30 days after we receive them/);
    assert.match(applicantNotice('hr@example.com', 1), /deleted 1 day after we receive them/);
  });

  it('never promises a deletion the tool does not do', () => {
    // The old sentence promised "after the hiring round closes"; nothing in
    // the tool closes a round, so no wording may imply one.
    for (const days of [7, 90, 365]) {
      assert.doesNotMatch(applicantNotice('hr@example.com', days), /round closes/i);
    }
  });

  it('keeps the address and the two things the applicant may ask for', () => {
    const text = applicantNotice('hr@example.com', 90);
    assert.match(text, /hr@example\.com/);
    assert.match(text, /reviewed by a person/);
    assert.match(text, /No decision is made automatically/);
  });

  it('is usable without arguments, with a placeholder and the default days', () => {
    assert.match(applicantNotice(), /\[contact address\]/);
    assert.match(applicantNotice(), /90 days/);
  });

  it('the legal note still names the laws the mode sits under', () => {
    for (const law of ['AI Act', 'GDPR', 'Local Law 144', 'SB 24-205', 'HB 3773']) {
      assert.ok(LEGAL_NOTE.includes(law), `${law} missing`);
    }
  });
});
