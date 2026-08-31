# 0021 — Cover letters generate from stored inputs only

**Status:** Accepted (2026-08-31)

## Context

F8's plan (§9) gates the card on an existing resume match and feeds it
"company facts from verification". Measured on our data first (2026-08-31):

- 807 jobs, all classified — but `ResumeMatch` covers **10 jobs (1.2%)**
  and `JobVerification` **4 (0.5%)**. A match-gated card is dead on ~99%
  of job pages; the no-match, no-verification path is the primary
  scenario, not a degradation.
- The 4 stored verifications DO carry citable company facts:
  `companySnapshot` is dense factual prose (founders, size, stack,
  customers, funding), `redFlags` are bullets. The company block is
  buildable — as optional garnish, present on 0.5% of pages.
- The one real cover letter in the corpus (sent to HS GovTech) is
  **~120 words**: greeting → who I am + core stack → why this company
  (mission, from the posting) + what I bring → thanks + one-line CTA →
  signature. The plan's 250–350 words has no evidence behind it.
- 0 of 3 resumes and 0 of 771 job descriptions contain Cyrillic (measured
  at F7), so a `language: auto|en|uk` switch would ship an untested path.
- `CandidateFact`: 4 confirmed bare tool terms, 4 denied; `fact-check.ts`
  (ADR 0020) blocks denied terms and unsourced metrics at 0.75 ms median.

## Decision

- **Inputs allowlist** — a letter is generated from: resume text +
  `CandidateFact` rows + posting text + the latest `ResumeMatch` for the
  selected resume (optional) + the stored `JobVerification.companySnapshot`
  (optional) + the user's angle text. Nothing else. The call is tool-free:
  `webTools` remains exclusive to `verify.ts` (ADR 0009); company research
  beyond stored verification is an ADR 0009 amendment, not a feature detail.
- **Match and verification are optional enrichers.** The card is enabled
  whenever one visible resume exists; the result panel names which inputs
  were actually used.
- **Angle inputs steer emphasis but are NOT gate sources.** A metric typed
  into an angle box that the resume does not carry is quoted back and
  dropped by the regeneration — not laundered into the letter through a
  free-text field.
- **120–180 words, hard cap 200**, modeled on the real letter. The body
  ends at the candidate's name: no email, phone, or links (a mangled phone
  digit would slip past the gate's contact masking).
- **English only.** The language switch is dropped until a non-English
  posting or resume exists; the gate already degrades `pass → warn` on
  non-Latin text it cannot read.
- **Gate wiring:** `factCheck` block → one regeneration with the reasons
  quoted verbatim → still block → nothing shown, nothing persisted. Manual
  edits re-run the gate **warn-only** (it polices the model, not the user)
  and the stored verdict updates.
- **Persistence:** `CoverLetter` rows accumulate newest-first (the `kind`
  column is reserved for F16 email drafts); only `pass`/`warn` letters are
  ever stored. Engine role: `resume` — same quality tier as match, no new
  role slot.

## Consequences

✅ The card is usable on all 807 job pages, not 10.
✅ F16 (application emails) reuses the same seam, rules, and table.
❌ Without a match the prompt extracts posting keywords itself — less
   structured than a match-fed letter.
❌ A true-but-unsourced metric in an angle costs one regeneration and is
   dropped; the remedy is putting it in the resume.
❌ Ukrainian letters are deferred, honestly, rather than shipped untested.

## When to revisit

The first non-English posting worth applying to (language switch); a real
letter refused on truthful content (tighten the extractor, never the
verdict); F16 riding on this table.
