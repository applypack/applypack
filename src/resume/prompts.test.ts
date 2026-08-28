import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatchPrompt,
  buildScanPrompt,
  parseMatchResponse,
  parseScanResponse,
} from './prompts';

test('parseScanResponse normalises tags and tolerates missing optionals', () => {
  const r = parseScanResponse(`Here you go:\n{"title":" Senior Backend Engineer ","skills":["PHP","php","Laravel "],"role_types":["backend"],"summary":"Ten years of PHP."}`);
  assert.ok(r.ok);
  assert.equal(r.data.title, 'Senior Backend Engineer');
  assert.equal(r.data.seniority, null);
  assert.equal(r.data.years_experience, null);
  assert.deepEqual(r.data.skills, ['php', 'laravel']);
  assert.deepEqual(r.data.issues, []);
});

test('parseScanResponse rejects prose and wrong shapes', () => {
  assert.equal(parseScanResponse('I cannot read this resume.').ok, false);
  assert.equal(parseScanResponse('{"skills": "php"}').ok, false);
});

test('parseMatchResponse accepts the documented shape and rejects bad enums', () => {
  const good = parseMatchResponse(`\`\`\`json
{"match_score": 72, "summary": "Solid PHP fit, missing Drupal.",
 "strengths": ["10 years PHP"], "red_flags": [],
 "keywords": [{"term": "Drupal", "priority": 1, "status": "cannot_claim", "where": null, "note": "no CMS work listed"}],
 "actions": [{"section": "title", "where": "title line", "what": "Rename to Drupal Developer", "why": "exact title match", "priority": "high"}]}
\`\`\``);
  assert.ok(good.ok);
  assert.equal(good.data.match_score, 72);
  assert.equal(good.data.keywords[0]?.status, 'cannot_claim');
  assert.equal(good.data.actions[0]?.section, 'title');
  assert.deepEqual(good.data.removals, []);

  const bad = parseMatchResponse(
    '{"match_score": 72, "summary": "x", "keywords": [{"term": "Go", "priority": 5, "status": "present"}], "actions": []}',
  );
  assert.equal(bad.ok, false);
});

test('parseMatchResponse keeps removals', () => {
  const r = parseMatchResponse(
    '{"match_score": 50, "summary": "x", "removals": [{"section": "skills", "where": "Key Skills row 8", "what": "Drop Kafka, Chef", "why": "never used in a role"}]}',
  );
  assert.ok(r.ok);
  assert.equal(r.data.removals[0]?.what, 'Drop Kafka, Chef');
});

test('prompts carry the resume and posting, and clip oversized input', () => {
  const scan = buildScanPrompt('RESUME BODY');
  assert.match(scan.user, /RESUME BODY/);
  assert.match(scan.system, /"issues"/);

  const match = buildMatchPrompt('x'.repeat(40_000), {
    title: 'Senior Go Developer',
    companyName: 'Acme',
    location: '',
    description: 'Go, gRPC, Kubernetes',
  });
  assert.match(match.user, /Title: Senior Go Developer/);
  assert.match(match.user, /Location: \(not specified\)/);
  assert.match(match.user, /\[\.\.\. truncated\]/);
  assert.ok(match.user.length < 40_000);
  assert.match(match.system, /"removals"/);
  assert.match(match.system, /SAME rubric/);
});
