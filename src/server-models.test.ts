import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listsModel, parseModelList, parseOllamaContextLength, parseOllamaTags, preferredModel, windowForUseIt } from './server-models';

test('a model list is its ids, once each and sorted; anything else is no list', () => {
  assert.deepEqual(parseModelList({ object: 'list', data: [{ id: 'qwen2.5:14b' }, { id: 'llama3.1:8b' }, { id: 'llama3.1:8b' }] }), [
    'llama3.1:8b',
    'qwen2.5:14b',
  ]);
  assert.deepEqual(parseModelList({ data: [] }), []);
  assert.equal(parseModelList({ models: ['x'] }), null);
  assert.equal(parseModelList(null), null);
});

test('the model offered first is a chat model when the server has one', () => {
  assert.equal(preferredModel(['all-minilm:latest', 'llama3.1:8b', 'nomic-embed-text:latest']), 'llama3.1:8b');
  assert.equal(preferredModel(['bge-m3:latest', 'qwen2.5:7b']), 'qwen2.5:7b');
  assert.equal(preferredModel(['nomic-embed-text:latest']), 'nomic-embed-text:latest');
  assert.equal(preferredModel([]), null);
});

test('a model named without its tag is the one Ollama lists as :latest', () => {
  assert.equal(listsModel(['llama3.1:latest'], 'llama3.1'), true);
  assert.equal(listsModel(['llama3.1:8b'], 'llama3.1:8b'), true);
  assert.equal(listsModel(['llama3.1:8b'], 'llama3.1'), false);
});

test("Ollama's /api/tags reads as the same list", () => {
  assert.deepEqual(
    parseOllamaTags({ models: [{ name: 'qwen2.5:14b', size: 9_000_000_000 }, { name: 'llama3.1:8b', details: { family: 'llama' } }] }),
    ['llama3.1:8b', 'qwen2.5:14b'],
  );
  assert.equal(parseOllamaTags({ data: [{ id: 'x' }] }), null);
});

test("a model's own context length is read out of Ollama's /api/show", () => {
  assert.equal(parseOllamaContextLength({ model_info: { 'general.architecture': 'gemma3', 'gemma3.context_length': 131_072 } }), 131_072);
  assert.equal(parseOllamaContextLength({ model_info: { 'llama.context_length': '8192' } }), null);
  assert.equal(parseOllamaContextLength({ details: { family: 'llama' } }), null);
  assert.equal(parseOllamaContextLength(null), null);
});

test('"Use it" picks 32k only for a model that allows it, and never over a window the person chose (#523)', () => {
  assert.equal(windowForUseIt(262_144, null), 32_768);
  assert.equal(windowForUseIt(32_768, null), 32_768);
  assert.equal(windowForUseIt(8_192, null), null);
  assert.equal(windowForUseIt(null, null), null);
  assert.equal(windowForUseIt(262_144, 16_384), null);
});
