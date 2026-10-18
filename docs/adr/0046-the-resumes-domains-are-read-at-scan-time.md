# 0046 — The resume's domains are read at scan time and compared with the posting's

**Status:** Accepted (2026-09-08); see the 2026-09-24 and 2026-10-18 addenda

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

## Addendum (2026-09-24): what changed since

- "prompt v14, withdrawn": the number was used again. The trial sentence
  was withdrawn, and `PROMPT_VERSION` 14 (`src/resume/prompts.ts`) is the
  CANDIDATE'S DOMAINS block this ADR decided.

## Addendum (2026-10-18): synonyms, the product, the sectors named (#207)

- **Synonyms.** The two sides also meet on a sector of the vocabulary the
  screening already reads (TASKS E6), so "healthcare" against "healthtech"
  and "banking" or "payments" against "fintech" read `match`. The
  vocabulary moved out of `src/screening/` to `src/sectors.ts`:
  `domain.ts` is reached by the worker's pack runner, and the worker never
  imports the screening module. The screening reads it as before. One pair
  the vocabulary keeps apart on purpose — its criterion asks for one sector
  — reads as one here: retail and e-commerce. Fitness and healthtech,
  insurance and banking stay `different`. The case this ADR called right,
  "healthtech" against "clinical research / CRO (pharma services)", now
  reads `match`, because the vocabulary files "clinical" under healthcare.
  Accepted: a silent notice costs nothing, while a wrong `different` tells
  the model not to claim a sector the person has worked in.
- **The product.** With no industry, the brief's product names the sector,
  but only when the vocabulary finds one in it ("AI order taking for
  restaurants"); a product that names none ("an analytics dashboard") stays
  `unknown`, since product words are often not sector words. The page then
  quotes the product. No stored brief had this shape when it was counted (0
  of 15).
- **Which sectors the notice names.** Still the scan's first three, most
  recent first. Naming the sectors closest to the posting's first would
  reorder nothing: a sector that shares a word or a sector with the
  posting's makes the verdict `match`, and then there is no sentence at all.
  The synonyms are what keep a close sector out of the sentence.
