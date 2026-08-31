# 0020 — The fact gate blocks fabrication, not imprecision

**Status:** Accepted (2026-08-31)

## Context

Cover letters (F8) and, later, AI edit suggestions in the target editor
generate prose that a recruiter reads as the candidate's own claims. Gotcha
11 already cost us once: a scoring prompt without an explicit hard cap
averaged its way to a flattering number. A generation prompt without a
deterministic check does the same with facts — an invented "40%" reads
exactly like a real one.

Measured on our own data before designing (2026-08-31):

- **`CandidateFact` carries no numbers.** 8 rows (4 confirmed, 4 denied),
  every one a bare tool term (`nginx`, `stripe`, `varnish`). The model is
  `term/status/note`. So the metric side of the gate is sourced entirely
  from resume text; facts can only ever support a *tool* assertion — and a
  `denied` row is the one signal that contradicts the resume outright.
- **Noise dominates the numeric surface.** 59 digit-bearing spans in the
  6004-char resume, ~19 of them real claims. The rest are years
  (`2009`–`2024`), tool versions (`PHP 7`, `v1.5`, `HTML5`, `EC2`, `p95`),
  big-O (`O(N2log2N)`), a ZIP (`78758`) and a phone in two formats
  (`267-5544`, `267 5544`). "Any digit is a claim" makes the gate fire on
  its own contact line.
- **The plan's headline normalization example does not occur.** Zero
  thousands separators in our texts; the only regex hit is `267 554` —
  a fragment of the phone number. Meanwhile 7 spelled-out numerals do
  occur (`four developers`, `three parts`, `zero downtime`), which the plan
  never mentions. A digit-only extractor blocks "mentored 4 developers"
  against a resume that says "four".
- **NFKC is necessary but not sufficient.** It leaves `–`, `—` and `’`
  untouched — the exact non-ASCII characters our resumes contain (`∙` ×10,
  `–` ×7, `’` ×4). Dash and quote folding are separate explicit steps.
- **No Ukrainian exists yet.** 0 of 3 resumes and 0 of 771 job descriptions
  contain Cyrillic, so the plan's "EN + UA extraction" has no fixture behind
  it.

## Decision

`src/resume/fact-check.ts` is a pure module (no Prisma, no I/O — sources
arrive as arguments; `store.ts` loads them). It extracts claims from the
generated text and from the sources through **one** normalization pipeline
and returns `pass | warn | block` plus the claims behind the verdict.

**It is a fabrication detector, not a precision auditor.** Every ambiguous
case resolves toward *not blocking*. A gate that fires on truthful text
teaches the user to click through it, at which point it protects nothing.
Concretely:

| Situation | Verdict | Why |
|---|---|---|
| Value absent from every source | `block` | the thing the gate exists for |
| `denied` CandidateFact term asserted | `block` | user said outright they lack it |
| Employer / title asserted with a history trigger, absent from sources | `block` | plan acceptance criterion |
| `10 years` vs source `10+ years` | supported | `+` is hedging, not a different number |
| `40 min` vs source bare `4` | supported only when one side has no unit | unit drift is phrasing |
| `40%` vs source `40 min` | unsupported | both carry units, and they differ |
| count noun differs (`200 million users` vs `…registered users`) | supported | value carries the claim, not the noun |
| Numeric span the extractor cannot classify | `warn` + "N claims could not be checked" | unchecked must never look like checked-and-clean |

Normalization applies identically to both sides: NFKC → dash fold → quote
fold → bullet fold → block-level breaks become sentence boundaries →
lowercase; then per-number canonicalization (contact/URL spans stripped
first, then spelled-out numerals, magnitude suffixes, and group-structured
thousands separators). Allowlist entries (`allowMetrics` / `allowFacts`)
run through the same pipeline, so an entry that can never match is
detectable rather than silently inert.

**Language scope, stated honestly:** percent, currency and bare-number
extraction is script-agnostic and works in any language; count nouns and
the employer/title triggers are English-only. A sentence that is mostly
non-Latin marks its numbers `unchecked`, degrading `pass → warn`. The gate
never reports "clean" for text it cannot read.

## Consequences

✅ F8 can regenerate against quoted violations instead of showing an
   unverified letter; every later generation surface reuses one seam.
✅ The 4 `denied` facts finally do work — they contradict generation.
✅ Pure and unit-testable; no schema, no UI, no toggle in this feature.
❌ Tool assertions are checked only against the CandidateFact vocabulary —
   we do not classify arbitrary words as tools. A fabricated tool the user
   has never been asked about passes.
❌ The bias toward not blocking lets a true number be reused under a
   different unit when one side is unitless.
❌ A four-state provenance model on `CandidateFact` (`verified / supported /
   derived-unverified / cannot-confirm`) is **deferred**: it needs a schema
   change F7 deliberately avoids, and our 8 bare-term rows show no
   population to model. Revisit when facts feed generation beyond F8.

## When to revisit

A real letter blocked on a truthful claim (tighten the extractor, never the
verdict), or the first non-English resume entering the corpus — at which
point the `unchecked` counter is already the measurement of how much that
language costs us.
