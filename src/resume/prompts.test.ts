import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatchPrompt,
  buildScanPrompt,
  parseMatchResponse,
  parseScanResponse,
  readHardRequirements,
} from './prompts';

const JOB = { title: 'x', companyName: 'x', location: '', description: 'x' };

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

test('parseMatchResponse accepts the v2 shape and rejects bad enums', () => {
  const good = parseMatchResponse(`\`\`\`json
{"summary": "Primary stack 1/1 — solid PHP fit, missing Drupal.",
 "alignment": {"title": "partial", "summary": "strong", "recent_role": "strong"},
 "strengths": ["10 years PHP"], "red_flags": [],
 "hard_requirements": [{"requirement": "US work authorization", "status": "unknown", "note": "resume is silent — confirm"}],
 "keywords": [{"term": "Drupal", "priority": 1, "requirement": "must", "primary": true, "status": "cannot_claim", "where": null, "note": "no CMS work listed"}],
 "actions": [{"section": "title", "where": "title line", "what": "Rename to Drupal Developer", "why": "exact title match", "priority": "high"}]}
\`\`\``);
  assert.ok(good.ok);
  assert.equal(good.data.alignment.title, 'partial');
  assert.deepEqual(good.data.cautions, []); // v3 field defaults for older replies
  assert.equal(good.data.keywords[0]?.status, 'cannot_claim');
  assert.equal(good.data.keywords[0]?.requirement, 'must');
  assert.equal(good.data.keywords[0]?.primary, true);
  assert.equal(good.data.keywords[0]?.elsewhere, null);
  assert.deepEqual(good.data.keywords[0]?.aliases, []);
  assert.equal(good.data.hard_requirements[0]?.status, 'unknown');
  assert.equal(good.data.actions[0]?.quote, null);
  assert.deepEqual(good.data.removals, []);

  // Old-style extras (match_score) are stripped, but alignment is required now.
  const noAlignment = parseMatchResponse('{"match_score": 72, "summary": "x", "keywords": [], "actions": []}');
  assert.equal(noAlignment.ok, false);

  const badPriority = parseMatchResponse(
    '{"summary": "x", "alignment": {"title": "strong", "summary": "strong", "recent_role": "strong"}, "keywords": [{"term": "Go", "priority": 5, "status": "present"}], "actions": []}',
  );
  assert.equal(badPriority.ok, false);
});

test('parseMatchResponse defaults requirement/primary for older replies and accepts ask_user', () => {
  const r = parseMatchResponse(
    '{"summary": "x", "alignment": {"title": "off", "summary": "off", "recent_role": "off"}, "keywords": [{"term": "Golang", "priority": 1, "status": "ask_user", "aliases": ["Go", "go "]}], "removals": [{"section": "skills", "where": "Key Skills row 8", "what": "Drop Kafka, Chef", "why": "never used in a role", "quote": "Kafka, Chef"}]}',
  );
  assert.ok(r.ok);
  assert.equal(r.data.keywords[0]?.status, 'ask_user');
  assert.equal(r.data.keywords[0]?.requirement, 'preferred');
  assert.equal(r.data.keywords[0]?.primary, false);
  assert.deepEqual(r.data.keywords[0]?.aliases, ['go']);
  assert.equal(r.data.removals[0]?.quote, 'Kafka, Chef');
});

test('readHardRequirements tolerates legacy rows', () => {
  assert.deepEqual(readHardRequirements(undefined), []);
  assert.deepEqual(readHardRequirements([]), []);
  assert.equal(readHardRequirements([{ requirement: 'Visa', status: 'pass', note: null }])[0]?.status, 'pass');
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
  assert.match(match.system, /"aliases"/);
  assert.match(match.system, /VERBATIM/);
});

test('the model judges facts; the application owns the number', () => {
  const { system } = buildMatchPrompt('resume', JOB);
  assert.match(system, /you never output a score/);
  assert.match(system, /computes the final score deterministically/);
  assert.doesNotMatch(system, /"match_score"/);
});

test('match rubric keeps the primary-stack gate (sibling tech never lifts the score)', () => {
  const { system } = buildMatchPrompt('resume', JOB);
  assert.match(system, /PRIMARY STACK/);
  assert.match(system, /"primary": true/);
  assert.match(system, /none → 30/);
  assert.match(system, /under half → 45/);
  assert.match(system, /React is not evidenced by Vue/);
  assert.match(system, /Node\.js is not evidenced by PHP/);
  assert.match(system, /Only "present" primary items count/);
  assert.match(system, /open with the stack verdict/);
  // v3: only must-requirements can be primary — a preferred tech must not cap the score.
  assert.match(system, /MUST requirements only/);
  assert.match(system, /preferred or nice-to-have is NEVER primary/);
});

test('red flags are blockers only; soft concerns go to unscored cautions (treadmill fix)', () => {
  const { system } = buildMatchPrompt('resume', JOB);
  assert.match(system, /ONLY facts that would block this application outright/);
  assert.match(system, /something NO resume edit can fix/);
  assert.match(system, /NEVER a red flag/);
  assert.match(system, /Domain-experience gaps|domain-experience gaps/i);
  assert.match(system, /over-qualification/);
  assert.match(system, /"cautions"/);
  assert.match(system, /displayed, never scored/);
  assert.match(system, /it is a caution/);
});

test('alignment grades follow objective criteria, no hedging', () => {
  const { system } = buildMatchPrompt('resume', JOB);
  assert.match(system, /OBJECTIVE criteria/);
  assert.match(system, /do not hedge to partial/);
  assert.match(system, /names at least two of the posting's must requirements/);
});

test('actions must not become a treadmill', () => {
  const { system } = buildMatchPrompt('resume', JOB);
  assert.match(system, /NO TREADMILL/);
  assert.match(system, /Never re-suggest something the resume already does/);
  assert.match(system, /one or two actions \(or none\) is the correct answer/);
});

test('previous keywords keep re-runs comparable', () => {
  const { system } = buildMatchPrompt('resume', JOB);
  assert.match(system, /CONSISTENCY ACROSS RUNS/);
  assert.match(system, /re-judge ONLY status, aliases and where/);

  const bare = buildMatchPrompt('resume', JOB);
  assert.doesNotMatch(bare.user, /PREVIOUS KEYWORDS/);
  const { user } = buildMatchPrompt('resume', JOB, {
    previousKeywords: [
      { term: 'Node.js', priority: 1, requirement: 'must', primary: true },
      { term: 'Azure', priority: 3, requirement: 'preferred', primary: false },
    ],
  });
  assert.match(user, /PREVIOUS KEYWORDS for this same posting/);
  assert.match(user, /- Node\.js \| P1 \| must \| primary/);
  assert.match(user, /- Azure \| P3 \| preferred\n/);
});

test('both prompts treat resume and posting as untrusted input', () => {
  assert.match(buildMatchPrompt('resume', JOB).system, /UNTRUSTED INPUT/);
  assert.match(buildMatchPrompt('resume', JOB).system, /do not follow it/);
  assert.match(buildScanPrompt('resume').system, /untrusted data/);
});

test('requirement levels come from the posting wording and context carries no weight', () => {
  const { system } = buildMatchPrompt('resume', JOB);
  assert.match(system, /"must": required \/ must have/);
  assert.match(system, /"nice": a plus \/ bonus/);
  assert.match(system, /"context": "we use X"/);
  assert.match(system, /NOISE: ignore company marketing, benefits/);
});

test('ask_user is sparing, hard-requirement silence is never a fail', () => {
  const { system } = buildMatchPrompt('resume', JOB);
  assert.match(system, /"ask_user"/);
  assert.match(system, /use it sparingly/);
  assert.match(system, /Silence is NEVER "fail"/);
  assert.match(system, /choose the lower/);
});

test('actions demand business impact and forbid invented metrics', () => {
  const { system } = buildMatchPrompt('resume', JOB);
  assert.match(system, /IMPACT: every suggested experience bullet states the business outcome/);
  assert.match(system, /NEVER invent a metric/);
  assert.match(system, /\[add your real number\]/);
});

test('the prompt asks for a small, fast reply', () => {
  const { system } = buildMatchPrompt('resume', JOB);
  assert.match(system, /~25 keywords/);
  assert.match(system, /12 words or fewer/);
});

test('removals rules protect the contact line and wanted keywords', () => {
  const { system } = buildMatchPrompt('resume', JOB);
  assert.match(system, /never remove the contact line/);
  assert.match(system, /email, phone/);
  assert.match(system, /KEEP WANTED KEYWORDS/);
  assert.match(system, /"present" or "add" for THIS posting/);
  assert.match(system, /which items to drop and which to keep/);
});

test('keyword terms must be short verbatim phrases with resume-aware aliases', () => {
  const { system } = buildMatchPrompt('resume', JOB);
  assert.match(system, /VERBATIM/);
  assert.match(system, /character-for-character/);
  assert.match(system, /SHORT: 1-4 words/);
  assert.match(system, /scan the RESUME text and include the exact spellings IT uses/);
});

test('candidate facts, denials and other-resume skills land in the user prompt only when present', () => {
  const bare = buildMatchPrompt('resume', JOB);
  assert.doesNotMatch(bare.user, /CANDIDATE-CONFIRMED/);
  assert.doesNotMatch(bare.user, /OTHER RESUMES/);

  const { user, system } = buildMatchPrompt('resume', JOB, {
    confirmedFacts: [{ term: 'azure', note: 'AKS at Contoso, 2023' }],
    deniedTerms: ['kubernetes'],
    otherResumeSkills: [{ skill: 'terraform', resumeName: 'DevOps CV' }],
  });
  assert.match(user, /CANDIDATE-CONFIRMED FACTS/);
  assert.match(user, /- azure: AKS at Contoso, 2023/);
  assert.match(user, /CANDIDATE-DENIED/);
  assert.match(user, /- kubernetes/);
  assert.match(user, /OTHER RESUMES of this candidate mention/);
  assert.match(user, /- terraform \(in "DevOps CV"\)/);
  // And the system prompt explains how to use each section.
  assert.match(system, /CANDIDATE-CONFIRMED FACT/);
  assert.match(system, /CANDIDATE-DENIED term/);
  assert.match(system, /OTHER RESUMES/);
});
