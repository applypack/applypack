import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileName, copyName } from './tailored';

test('a copy is named after its resume and the employer it is for', () => {
  assert.equal(copyName('Dana Ruiz', 'Fernway'), 'Dana Ruiz — Fernway');
  assert.equal(copyName(' Dana Ruiz ', null), 'Dana Ruiz');
  assert.equal(copyName('Dana Ruiz', '  '), 'Dana Ruiz');
});

test('its file name is findable later and carries no version', () => {
  assert.equal(copyFileName('Dana Ruiz — full-stack', 'Fernway GmbH', 'docx'), 'dana-ruiz-full-stack-fernway-gmbh.docx');
  assert.equal(copyFileName('Резюме', null, 'md'), 'resume.md');
  assert.equal(copyFileName('frontend', 'Lumen Desk', 'docx'), 'frontend-lumen-desk.docx');
});
