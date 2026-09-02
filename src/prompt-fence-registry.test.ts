import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { Profile } from '@prisma/client';
import * as classifierMod from './classifier';
import * as prefilterMod from './classifier-prefilter';
import * as extractMod from './jobs/posting-extract';
import * as resumeMod from './resume/prompts';
import * as verifyMod from './verification/prompts';
import { fenceClose, fenceOpen } from './prompt-fence';

/*
 * The F12 guard (ADR 0022). Two rosters are DERIVED — from the modules' own
 * exports and from a walk of src/ — so a prompt builder or an AI call site
 * added later cannot quietly skip the fence. Only the "how do I call it"
 * half is written by hand, because inventing arguments by reflection is the
 * kind of cleverness that breaks on the next signature change.
 */

/* CommonJS build (tsconfig module: CommonJS), so __dirname is the src root. */
const SRC = __dirname;
const BUILDER_RE = /^build[A-Za-z]*Prompt$/;

/** Every module that owns a prompt builder. New module → add it here and to CASES. */
const PROMPT_MODULES: Record<string, Record<string, unknown>> = {
  'classifier.ts': classifierMod,
  'classifier-prefilter.ts': prefilterMod,
  'jobs/posting-extract.ts': extractMod,
  'resume/prompts.ts': resumeMod,
  'verification/prompts.ts': verifyMod,
};

/**
 * Files allowed to call the provider directly. Each either goes through a
 * builder in CASES, or embeds no outside text at all — the reason is stated
 * so a new entry has to justify itself.
 */
const KNOWN_CALL_SITES: Record<string, string> = {
  'ai-provider.ts': 'the seam itself',
  'ai-runtime.ts': 'the chain that drives the seam',
  'classifier.ts': 'buildClassifyPrompt',
  'classifier-prefilter.ts': 'buildPrefilterPrompt',
  'jobs/posting-extract.ts': 'buildExtractPrompt',
  'resume/match.ts': 'buildMatchPrompt',
  'resume/suggestions.ts': 'buildSuggestionsPrompt',
  'resume/scan.ts': 'buildScanPrompt',
  'resume/review.ts': 'buildReviewPrompt',
  'resume/cover-letter.ts': 'buildCoverPrompt',
  'verification/verify.ts': 'buildVerifyPrompt',
  'scripts/resume-bench-once.ts': 'bench harness, reuses buildMatchPrompt',
  'web/ai-test.ts': 'engine connectivity test — a fixed literal, no outside text',
};

const PROFILE = {
  id: 1,
  name: 'Backend',
  seniority: ['senior'],
  stackRequired: ['php'],
  roleTypes: ['backend'],
  stackNiceToHave: [],
  stackExclude: [],
  remoteOk: true,
  remoteRegions: ['US'],
  hybridOk: false,
  onsiteCities: [],
  minSalaryUsd: 0,
  notes: '',
} as unknown as Profile;

/* A second search, so the multi-profile builders are fenced under the shape
   they actually run in — one search is the degenerate case, not the contract. */
const PROFILE_2 = { ...PROFILE, id: 7, name: 'QA', stackRequired: ['playwright'] } as Profile;

const RESUME = 'RESUME-NEEDLE';
const DESC = 'POSTING-NEEDLE';
const JOB = { title: 'TITLE-NEEDLE', companyName: 'COMPANY-NEEDLE', location: 'LOC-NEEDLE', description: DESC };
const CLASSIFY_INPUT = { ...JOB, postedAt: new Date('2026-08-31T00:00:00.000Z') };

interface Case {
  build: () => { system: string; user: string };
  /** Untrusted text that must sit inside the named fence. */
  fenced: [label: string, needle: string][];
}

const CASES: Record<string, Case> = {
  buildClassifyPrompt: {
    build: () => classifierMod.buildClassifyPrompt(CLASSIFY_INPUT, [PROFILE, PROFILE_2]),
    fenced: [
      ['JOB POSTING', DESC],
      ['JOB POSTING', 'TITLE-NEEDLE'],
      ['JOB POSTING', 'COMPANY-NEEDLE'],
      ['JOB POSTING', 'LOC-NEEDLE'],
    ],
  },
  buildPrefilterPrompt: {
    build: () => prefilterMod.buildPrefilterPrompt(CLASSIFY_INPUT, [PROFILE, PROFILE_2]),
    fenced: [
      ['JOB POSTING', DESC],
      ['JOB POSTING', 'TITLE-NEEDLE'],
      ['JOB POSTING', 'LOC-NEEDLE'],
    ],
  },
  buildExtractPrompt: {
    build: () => extractMod.buildExtractPrompt(DESC),
    fenced: [['JOB POSTING', DESC]],
  },
  buildScanPrompt: {
    build: () => resumeMod.buildScanPrompt(RESUME),
    fenced: [['RESUME', RESUME]],
  },
  buildReviewPrompt: {
    build: () =>
      resumeMod.buildReviewPrompt(RESUME, {
        roleTypes: ['ROLETYPE-NEEDLE'],
        // Our own words about the text, so they carry no fence — see the builder.
        atsChecks: ['No email address in the extracted text'],
      }),
    fenced: [
      ['RESUME', RESUME],
      // Tier 2: scanned out of the same untrusted resume.
      ['CLAIMED ROLES', 'ROLETYPE-NEEDLE'],
    ],
  },
  buildMatchPrompt: {
    build: () =>
      resumeMod.buildMatchPrompt(RESUME, JOB, 'full', {
        otherResumeSkills: [{ skill: 'ELSEWHERE-NEEDLE', resumeName: 'Old CV' }],
        previousKeywords: [{ term: 'PREVKW-NEEDLE', priority: 1, requirement: 'must', primary: true }],
      }),
    fenced: [
      ['RESUME', RESUME],
      ['JOB POSTING', DESC],
      ['JOB POSTING', 'TITLE-NEEDLE'],
      ['JOB POSTING', 'COMPANY-NEEDLE'],
      // Tier 2: text of ours that was derived from an untrusted posting.
      ['OTHER RESUME SKILLS', 'ELSEWHERE-NEEDLE'],
      ['PREVIOUS KEYWORDS', 'PREVKW-NEEDLE'],
    ],
  },
  buildSuggestionsPrompt: {
    build: () =>
      resumeMod.buildSuggestionsPrompt(RESUME, JOB, {
        summary: 'SUMMARY-NEEDLE',
        alignment: null,
        keywords: [{ term: 'VERDICT-NEEDLE', requirement: 'must', primary: true, status: 'present', where: 'WHERE-NEEDLE' }],
        hardRequirements: [{ requirement: 'GATE-NEEDLE', status: 'unknown' }],
      }),
    fenced: [
      ['RESUME', RESUME],
      ['JOB POSTING', DESC],
      ['JOB POSTING', 'TITLE-NEEDLE'],
      // Tier 2: the stored verdicts are model output over the untrusted texts.
      ['KEYWORD VERDICTS', 'SUMMARY-NEEDLE'],
      ['KEYWORD VERDICTS', 'VERDICT-NEEDLE'],
      ['KEYWORD VERDICTS', 'WHERE-NEEDLE'],
      ['KEYWORD VERDICTS', 'GATE-NEEDLE'],
    ],
  },
  buildCoverPrompt: {
    build: () =>
      resumeMod.buildCoverPrompt(RESUME, JOB, {
        tone: 'warm',
        match: { summary: 'MATCH-NEEDLE', strengths: [], aligned: [], gaps: [] },
        companySnapshot: 'SNAPSHOT-NEEDLE',
      }),
    fenced: [
      ['RESUME', RESUME],
      ['JOB POSTING', DESC],
      ['MATCH ANALYSIS', 'MATCH-NEEDLE'],
      ['COMPANY FACTS', 'SNAPSHOT-NEEDLE'],
    ],
  },
  buildVerifyPrompt: {
    build: () => verifyMod.buildVerifyPrompt({ ...JOB, url: 'https://x.example/1', postedAt: new Date(0) }),
    fenced: [
      ['JOB POSTING', DESC],
      ['JOB POSTING', 'TITLE-NEEDLE'],
      ['JOB POSTING', 'COMPANY-NEEDLE'],
    ],
  },
};

function walkSrc(): string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !e.name.includes('.test.'))
    .map((e) => relative(SRC, join(e.parentPath, e.name)).split(sep).join('/'));
}

test('every exported prompt builder has a fence case', () => {
  const found = Object.entries(PROMPT_MODULES).flatMap(([file, mod]) =>
    Object.keys(mod)
      .filter((k) => BUILDER_RE.test(k))
      .map((name) => ({ name, file })),
  );
  const missing = found.filter((b) => !(b.name in CASES));
  assert.deepEqual(
    found.map((b) => b.name).sort(),
    Object.keys(CASES).sort(),
    missing.length > 0
      ? `builder(s) with no fence case: ${missing.map((b) => `${b.name} (${b.file})`).join(', ')}`
      : 'CASES lists a builder that no longer exists',
  );
});

test('every AI call site is a known one', () => {
  const callers = walkSrc().filter((f) => readFileSync(join(SRC, f), 'utf8').includes('.complete('));
  const unknown = callers.filter((f) => !(f in KNOWN_CALL_SITES));
  assert.deepEqual(
    unknown,
    [],
    `new AI call site(s): ${unknown.join(', ')} — route the prompt through a build*Prompt and register it here`,
  );
});

for (const [name, { build, fenced }] of Object.entries(CASES)) {
  test(`${name}: untrusted text sits inside its fence`, () => {
    const { system, user } = build();
    for (const [label, needle] of fenced) {
      const open = user.indexOf(fenceOpen(label));
      const close = user.indexOf(fenceClose(label), open);
      const at = user.indexOf(needle);
      assert.notEqual(open, -1, `${name}: no "${label}" fence at all`);
      assert.ok(close > open, `${name}: "${label}" fence is never closed`);
      assert.ok(at > open && at < close, `${name}: ${needle} is outside the "${label}" fence`);
    }
    // The directive belongs to the system prompt, where the data cannot argue with it.
    assert.match(system, /SECURITY —/, `${name}: system prompt states no directive`);
    assert.match(system, /BEGIN UNTRUSTED/, `${name}: directive never names the marker pair`);
    assert.ok(!user.includes('SECURITY —'), `${name}: directive leaked into the user prompt`);
  });
}
