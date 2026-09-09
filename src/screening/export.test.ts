import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, toMarkdown, type ExportRow, type ExportScreening } from './export';

const SCREENING: ExportScreening = {
  title: 'Senior Java — September',
  jobTitle: 'Senior Java Developer',
  companyName: 'Acme',
  gates: ['EU work authorisation', 'German B2'],
  createdAt: new Date('2026-09-09T10:00:00Z'),
};

const ROWS: ExportRow[] = [
  {
    number: 2,
    name: 'Олена, "QA"',
    file: 'olena.pdf',
    status: 'ok',
    note: null,
    bucket: 'pass',
    score: 81,
    adjustment: 10,
    adjustmentNote: 'referral from Ivan',
    adjusted: 91,
    sameAs: null,
    confidence: 'high',
    gates: [
      { gate: 'EU work authorisation', status: 'pass' },
      { gate: 'German B2', status: 'unknown' },
    ],
    mustCovered: 6,
    mustTotal: 7,
    years: 9,
    level: 'senior',
    verdict: 'Priority to talk to; ask about German.',
    questions: ['Which level of German?', 'Who owned the ledger?'],
    decision: 'interview',
  },
  {
    number: 5,
    name: null,
    file: 'scan.pdf',
    status: 'unreadable',
    note: 'no text layer',
    bucket: null,
    score: null,
    adjustment: 0,
    adjustmentNote: null,
    adjusted: null,
    sameAs: 2,
    confidence: null,
    gates: [],
    mustCovered: null,
    mustTotal: null,
    years: null,
    level: null,
    verdict: null,
    questions: [],
    decision: null,
  },
];

test('toCsv quotes what needs quoting and marks the gates', () => {
  const csv = toCsv(SCREENING, ROWS);
  const lines = csv.split('\r\n');
  assert.ok(lines[0]!.startsWith('﻿Applicant,Name,File,Status,Bucket,Score,Your adjustment,Adjusted score,Confidence,Gate: EU work authorisation,Gate: German B2,'));
  assert.ok(lines[1]!.includes(',81,+10 (referral from Ivan),91,high,'), 'the computed score, the correction and its reason, the adjusted number');
  assert.ok(lines[1]!.includes('"Олена, ""QA"""'), 'a comma and quotes inside a cell are escaped');
  assert.ok(lines[1]!.includes(',✓,?,6/7,9,senior,To interview,'));
  assert.ok(lines[1]!.includes('Which level of German? | Who owned the ledger?'));
  assert.ok(lines[2]!.startsWith('№5,,scan.pdf,unreadable,,,,,,,,'));
  assert.ok(lines[2]!.endsWith('another document of №2; no text layer'));
});

test('toMarkdown groups by bucket and lists the unread files', () => {
  const md = toMarkdown(SCREENING, ROWS);
  assert.match(md, /^# Senior Java — September/);
  assert.match(md, /## Priority to talk to \(1\)/);
  assert.match(md, /\| №2 \| Олена, "QA" \| 91 \(81 \+10\) \| high \| ✓ \| \? \| 6\/7 \| 9 \| senior \| To interview \|/);
  assert.match(md, /- Your adjustment: \+10 — referral from Ivan/);
  assert.match(md, /\*\*№2 — Олена, "QA"\.\*\* Priority to talk to; ask about German\./);
  assert.match(md, /- Which level of German\?/);
  assert.match(md, /## Not screened \(1\)\n\n- №5 scan\.pdf: no text layer/);
  assert.ok(!md.includes('## Ask first'), 'an empty bucket has no section');
});
