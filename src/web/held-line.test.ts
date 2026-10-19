import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { alertsSwitchedLine, heldLine } from './held-line';

describe('heldLine', () => {
  it('says what holds the matches and links the one place to change it', () => {
    assert.deepEqual(heldLine(3, 'alerts-off'), {
      text: '3 matches are waiting: Alerts are switched off',
      href: '/settings?tab=notifications',
      action: 'switch them on',
    });
    assert.deepEqual(heldLine(2, 'window'), {
      text: '2 matches are waiting for the alert window to open',
      href: '/settings?tab=notifications#alerts',
      action: 'change when alerts arrive',
    });
    assert.equal(heldLine(4, 'next-check').text, '4 matches are waiting to be sent at the next hourly check');
  });

  it('agrees in number', () => {
    assert.equal(heldLine(1, 'no-targets').text, '1 match is waiting for a chat to send it to');
    assert.equal(heldLine(5, 'no-targets').text, '5 matches are waiting for a chat to send them to');
  });
});

describe('alertsSwitchedLine', () => {
  it('never speaks of every channel when there is none (#572)', () => {
    assert.equal(alertsSwitchedLine(true, 2, null), 'Alerts enabled on every channel.');
    assert.equal(alertsSwitchedLine(true, 1, heldLine(3, 'next-check')), 'Alerts enabled on every channel. 3 matches are waiting to be sent at the next hourly check.');
    assert.match(alertsSwitchedLine(true, 0, null), /^Alerts enabled, but no chat is set up yet/);
    assert.equal(alertsSwitchedLine(false, 0, null), 'Alerts disabled.', 'with no chat nothing is held for later');
    assert.match(alertsSwitchedLine(false, 1, null), /^Alerts disabled on every channel\. What is found meanwhile waits/);
  });
});
