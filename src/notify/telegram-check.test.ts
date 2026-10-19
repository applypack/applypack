import { test } from 'node:test';
import assert from 'node:assert/strict';
import { telegramFailure, telegramReason } from './telegram-check';

test('a refused token, a chat the bot cannot write to, and Telegram trouble are told apart (#561)', () => {
  assert.equal(telegramFailure('getMe', 401), 'token');
  assert.equal(telegramFailure('getMe', 404), 'token', 'a token with no bot behind it');
  assert.equal(telegramFailure('sendMessage', 400), 'chat', 'chat not found');
  assert.equal(telegramFailure('sendMessage', 403), 'chat', 'the bot was blocked, or never started');
  assert.equal(telegramFailure('getMe', 400), 'telegram');
  assert.equal(telegramFailure('sendMessage', 429), 'telegram');
  assert.equal(telegramFailure('getMe', 502), 'telegram');
});

test("Telegram's reason is its description, never the JSON it came in", () => {
  assert.equal(telegramReason(401, '{"ok":false,"error_code":401,"description":"Unauthorized"}'), '401 Unauthorized');
  assert.equal(telegramReason(502, '<html>Bad Gateway</html>'), 'HTTP 502');
  assert.equal(telegramReason(500, '{"ok":false}'), 'HTTP 500');
});
