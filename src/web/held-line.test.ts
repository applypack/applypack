import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { heldLine } from './held-line';

describe('heldLine', () => {
  it('says what holds the matches and links the one place to change it', () => {
    assert.deepEqual(heldLine(3, 'alerts-off'), {
      text: '3 matches are waiting: Alerts are switched off',
      href: '/settings?tab=notifications',
      action: 'switch them on',
    });
    assert.deepEqual(heldLine(2, 'window'), {
      text: '2 matches are waiting for the alert window to open',
      href: '/settings?tab=general',
      action: 'change when alerts arrive',
    });
    assert.equal(heldLine(4, 'next-check').text, '4 matches are waiting to be sent at the next hourly check');
  });

  it('agrees in number', () => {
    assert.equal(heldLine(1, 'no-targets').text, '1 match is waiting for a chat to send it to');
    assert.equal(heldLine(5, 'no-targets').text, '5 matches are waiting for a chat to send them to');
  });
});
