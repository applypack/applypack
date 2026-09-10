import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordinal, toCsv, toMarkdown, type ExportRow, type ExportScreening } from './export';
import type { Calibration } from './calibration';

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
    standout: ['Speaks Polish', 'Spoke at JavaDay 2024'],
    career: '9.8 years across 3 employers · in a role now',
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
    standout: [],
    career: null,
    decision: null,
  },
];

test('toCsv quotes what needs quoting and marks the gates', () => {
  const csv = toCsv(SCREENING, ROWS);
  const lines = csv.split('\r\n');
  assert.ok(lines[0]!.startsWith('﻿Applicant,Name,File,Status,Bucket,Score,Your adjustment,Adjusted score,Confidence,Gate: EU work authorisation,Gate: German B2,'));
  // The adjustment opens with a sign and is not a number, so it is text-marked for Excel.
  assert.ok(lines[1]!.includes(",81,'+10 (referral from Ivan),91,high,"), 'the computed score, the correction and its reason, the adjusted number');
  assert.ok(lines[1]!.includes('"Олена, ""QA"""'), 'a comma and quotes inside a cell are escaped');
  assert.ok(lines[1]!.includes(',✓,?,6/7,9,senior,9.8 years across 3 employers · in a role now,To interview,'), 'the career line sits after the level');
  assert.ok(lines[1]!.includes(',Speaks Polish | Spoke at JavaDay 2024,Which level of German? | Who owned the ledger?'), 'stand-out facts before the questions');
  assert.ok(lines[2]!.startsWith('№5,,scan.pdf,unreadable,,,,,,,,'));
  assert.ok(lines[2]!.endsWith('another document of №2; no text layer'));
});

test('toCsv text-marks a cell that a spreadsheet would run as a formula', () => {
  const rows: ExportRow[] = [
    { ...ROWS[0]!, file: "=cmd|' /C calc'!A0.pdf", verdict: '@SUM(1)', questions: ['-2+3'], adjustment: 0, adjustmentNote: null },
  ];
  const line = toCsv(SCREENING, rows).split('\r\n')[1]!;
  assert.ok(line.includes(",'=cmd|' /C calc'!A0.pdf,"), 'the file name an applicant chose');
  assert.ok(line.includes(",'@SUM(1),"), 'model text');
  assert.ok(line.includes(",'-2+3"), 'a leading minus that is not a number');
  assert.ok(line.includes(',81,'), 'a plain number keeps its sign and stays a number');
});

test('toMarkdown groups by bucket and lists the unread files', () => {
  const md = toMarkdown(SCREENING, ROWS);
  assert.match(md, /^# Senior Java — September/);
  assert.match(md, /## Priority to talk to \(1\)/);
  assert.match(md, /\| №2 \| Олена, "QA" \| 91 \(81 \+10\) \| high \| ✓ \| \? \| 6\/7 \| 9 \| senior \| To interview \|/);
  assert.match(md, /- Your adjustment: \+10 — referral from Ivan/);
  assert.match(md, /- Stands out: Speaks Polish; Spoke at JavaDay 2024\n- Career: 9\.8 years across 3 employers · in a role now/);
  assert.match(md, /\*\*№2 — Олена, "QA"\.\*\* Priority to talk to; ask about German\./);
  assert.match(md, /- Which level of German\?/);
  assert.match(md, /## Not screened \(1\)\n\n- №5 scan\.pdf: no text layer/);
  assert.ok(!md.includes('## Ask first'), 'an empty bucket has no section');
});

test('toMarkdown adds the decisions section only when the calibration has enough to say', () => {
  const cal: Calibration = {
    total: 6,
    decided: { interview: 2, hold: 1, declined: 2 },
    enough: true,
    pairs: { concordant: 5, discordant: 3, fixedByAdjustment: 0 },
    agreement: 0.63,
    top: { k: 2, hit: 1 },
    surprises: [{ number: 4, position: 4, total: 6, decision: 'interview', why: ['EU work permit: unknown', 'PHP: skills list'] }],
    separations: [],
  };
  const md = toMarkdown(SCREENING, ROWS, cal);
  assert.match(md, /## Your decisions against the order\n\n1 of your 2 To interview sit in the table's top 2; the table orders 63% of your pairs the way you decided \(5 of 8\)\.\n\n- №4: To interview, 4th of 6 in the table — EU work permit: unknown · PHP: skills list/);
  assert.ok(!toMarkdown(SCREENING, ROWS, { ...cal, enough: false }).includes('## Your decisions'));
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ['st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'st', 'nd', 'st']);
});
