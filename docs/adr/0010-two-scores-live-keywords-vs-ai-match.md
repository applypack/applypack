# 0010 — Two scores: live keyword coverage in the browser, AI match on demand

**Status:** Accepted (2026-08-28)

## Context

The targeted-resume view (`/jobs/:id/target`) shows the posting and the
resume side by side and lets the user edit the resume text in place, with
the score updating as they type — the Resume Worded interaction. Our
comparison is one Claude call (~1 min, judgment-heavy, billed): it cannot
run per keystroke, and its score is a rubric, not a count.

## Decision

Two scores, labelled as such, never merged:

- **AI match** — unchanged: one `ResumeMatch` per run. It is the *frame*:
  which keywords matter (priority 1-4), their aliases, what cannot be
  claimed, what to change (`actions`, with an exact `quote`), what to cut
  (`removals`, with a `quote`). Runs on demand: "Re-analyze with AI" sends
  the edited text (`draftText`) and stores the result as a `draft` match;
  the analysed text is snapshotted in `ResumeMatch.resumeText` so old
  matches keep highlighting the text they judged.
- **Keyword coverage (live)** — `src/web/public/target.mjs`, a dependency-
  free ES module that runs in the browser (and under `node:test`). Weighted
  presence of the AI's keyword list in the current text: P1 = 3, P2 = 2,
  P3/P4 = 1; `cannot_claim` excluded from the denominator unless the user
  opts in. Token-aware matching (`C++`, `.NET`, `CI/CD`, `Node.js`,
  trailing periods). The same module renders both panes' highlights.

Editing is a `<textarea>` over a mirrored highlight layer; the draft lives
in `localStorage` per match until "Re-analyze" or "Save as new version"
(which stores the text as a `.md` version — there is no `.docx` to update).

## Consequences

✅ The score reacts instantly and deterministically; the expensive call
runs only when the user asks.
✅ The AI's keyword list carries the semantics (aliases, priorities,
cannot_claim), so the counter is not a naive noun scan.
❌ Two numbers on screen. The copy says which is which, and the AI score
is the one the rubric in the prompt keeps comparable across versions.
❌ Highlights depend on the model quoting the resume verbatim; a
paraphrased `quote` falls back to a loose match and, failing that, to the
list only.
❌ Text-only versions: saving a draft produces a `.md` resume version, not
a styled `.docx`. The docx patching stays in the CLI skill (TASKS §5.10).
