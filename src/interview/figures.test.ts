import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unbackedFigures } from './figures';

test('a figure the material states is not marked, however it is written', () => {
  const sources = ['Скоротив час відповіді з 1 200 мс до 300 мс, це 75%.', 'Team of 12; budget 2,5 mln; 10,000 users'];
  assert.deepEqual(unbackedFigures('I cut latency from 1200 ms to 300 ms — 75% less — for 10 000 users on a team of 12.', sources), []);
  assert.deepEqual(unbackedFigures('The budget was 2.5 million.', sources), []);
});

test('a figure nobody wrote is marked once, as the answer wrote it', () => {
  const sources = ['Led the checkout rewrite in 2021.'];
  assert.deepEqual(unbackedFigures('In 2021 I led it and raised conversion by 40%, then by 40% again, saving 1,500 hours.', sources), ['40', '1,500']);
});

test('a lone digit is not a claim worth a mark', () => {
  assert.deepEqual(unbackedFigures('I ran 3 services with 2 people.', ['no numbers here']), []);
});

test('the same holds in any language, since only digits are read', () => {
  assert.deepEqual(unbackedFigures('Ich habe die Kosten um 35 % gesenkt.', ['Зменшив витрати на 35%']), []);
  assert.deepEqual(unbackedFigures('Zmniejszyłem koszty o 60%.', ['Зменшив витрати на 35%']), ['60']);
});

test('thousands written as a word in the note are the same figure written out', () => {
  assert.deepEqual(unbackedFigures('40,000 SMS were not sent.', ['40 тисяч SMS не відправились']), []);
  assert.deepEqual(unbackedFigures('50,000 SMS were not sent.', ['40 тисяч SMS не відправились']), ['50,000']);
});
