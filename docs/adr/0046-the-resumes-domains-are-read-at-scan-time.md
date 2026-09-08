# 0046 — The resume's domains are read at scan time and compared with the posting's

**Status:** Accepted (2026-09-08)

## Context

The posting brief (ADR 0044) names the employer's sector for 118 of the
126 briefed postings on the live corpus; the resume side named nothing, so
a posting from another sector could only be noticed by the model, in prose
(match 139's cautions: "presents as senior Go/React… the posting is a
WordPress/PHP agency role"). Nazar asked for two things: advice written
toward the posting's sector, and a mark when the candidate has not worked
in it.

The first was measured before it was built. A sentence asking for the lean
in the audience rule (prompt v14, withdrawn) moved the share of
high-priority actions carrying a domain word from 15 of 43 to 14 of 47 over
three pairs and three runs each (`variance:compare`'s `domain` column) — the
model already writes "e-commerce checkout" and "restaurant order flow" where
the resume's facts allow, and writes nothing sector-shaped where they do not
(a PHP resume against a VDI posting: 0 of 20, both times). The lean is not a
prompt matter. The mark is a fact code can state, once the resume side is
known.

## Decision

- The scan reads `industries` — the sectors the resume's roles were in,
  most recent first, at most six, never guessed from an employer's name —
  into `Resume.industries` (one column, `scripts/rescan-resumes.ts` fills it
  on resumes from before).
- `src/resume/domain.ts` (pure) compares them with the brief's industry:
  `different` when both sides are known and share no sector word,
  `match` on any shared word or when the employer serves every sector (an
  agency, a consultancy, a software house, a staffing firm), `unknown` when
  either side is empty — and `unknown` says nothing anywhere.
- `different` does two things: the target page shows one sentence beside
  the thin-posting notice ("This posting is in X; your resume shows Y. The
  suggestions reframe transferable work…"), and both prompts get the
  candidate's domains as a fenced block with the instruction to reframe
  transferable work and never claim the sector; the gap goes to `cautions`.
- `domainLean` stays as a measurement (`variance:compare`), not a rule.

## Consequences

✅ A sector gap is said once, in code, the same way every time; the advice is
told not to invent sector experience (the fact-check gate would block the
wording anyway; now the model is told why). ❌ Existing resumes need one scan
each; the comparison is word overlap, so "healthtech" against "clinical
research / CRO" reads `different` — right in that case, and a synonym table
is the next step if a wrong `different` shows up on a real pair.

## When to revisit

A `different` verdict a user disputes on a real pair, or a posting whose
brief puts the sector in `product` rather than `industry` often enough that
the overlap should read both.
