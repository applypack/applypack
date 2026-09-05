import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askForJson } from './ai-json';
import type { AiCallRequest, AiCallResult } from './ai-runtime';
import { extractJson, jsonFailure, type ParseResult } from './text-utils';

const REQ: AiCallRequest = { system: 's', user: 'u', maxTokens: 100, label: 'test', role: 'resume' };

/** A runtime that answers from a script; null means "no engine answered". */
function runtime(replies: (string | null)[]) {
  const calls: AiCallRequest[] = [];
  return {
    calls,
    complete: async (req: AiCallRequest): Promise<AiCallResult | null> => {
      calls.push(req);
      const text = replies[calls.length - 1] ?? null;
      return text === null ? null : { text, providerId: 'anthropic_api', model: 'm', viaFallback: calls.length > 1 };
    },
  };
}

const parse = (text: string): ParseResult<{ n: number }> => {
  const json = extractJson(text) as { n?: unknown } | null;
  if (json === null) return jsonFailure(text);
  return typeof json.n === 'number' ? { ok: true, data: { n: json.n } } : { ok: false, error: 'no n' };
};

test('askForJson returns the parsed reply with the engine marker', async () => {
  const ai = runtime(['{"n":1}']);
  const answer = await askForJson(ai, REQ, parse);
  assert.deepEqual(answer?.data, { n: 1 });
  assert.equal(answer?.model, 'm');
  assert.equal(answer?.attempt, 0);
  assert.equal(answer?.chars, 7);
  assert.equal(ai.calls.length, 1);
});

test('askForJson retries once when the reply did not fit the schema, and names a fallback engine', async () => {
  const ai = runtime(['{"x":1}', '{"n":2}']);
  const answer = await askForJson(ai, REQ, parse);
  assert.deepEqual(answer?.data, { n: 2 });
  assert.equal(answer?.attempt, 1);
  assert.equal(answer?.model, 'm · fallback');
  assert.equal(ai.calls.length, 2);
});

test('askForJson gives up after the second bad reply', async () => {
  const ai = runtime(['{"x":1}', 'not even json']);
  assert.equal(await askForJson(ai, REQ, parse), null);
  assert.equal(ai.calls.length, 2);
});

test('askForJson does not retry a reply cut off inside the JSON', async () => {
  const ai = runtime(['{"n": {"deep": 1', '{"n":3}']);
  assert.equal(await askForJson(ai, REQ, parse), null);
  assert.equal(ai.calls.length, 1);
});

test('askForJson returns null when no engine answered', async () => {
  const ai = runtime([null]);
  assert.equal(await askForJson(ai, REQ, parse), null);
  assert.equal(ai.calls.length, 1);
});
