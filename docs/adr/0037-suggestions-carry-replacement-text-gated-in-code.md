# 0037 — Suggestions carry replacement text; the fact gate decides what is applicable

**Status:** Accepted (2026-09-04)

## Context

TASKS §5.15 closed "AI-tailored resume" on 2026-09-01 because auto-rewriting
prose reopens the fabrication surface the fact gate (ADR 0020) exists to close,
and left one reopen trigger: a real application round proving manual tailoring
too slow. The owner pulled that trigger in §18, in a narrower form — the user
picks each edit, the model only proposes wording, the file keeps the design.

Stages 1 and 2 built the picking on the wording the model was already writing
inside its `what` sentence. That worked better than expected and stopped
exactly where the data stops: `proposalOf` found a wording in 167 of 209
stored actions (80 %), Apply could act on 108 (52 %), and the rest were
additions with nothing to replace or instructions with no wording. Asking the
model for the wording in a field of its own was the obvious next step; the
question was who decides whether that wording may be pasted.

## Decision

1. **Two fields on every action** (prompt v7): `replacement`, the complete new
   text for the quoted span — or, for an addition, the new line — and
   `insert_after`, the resume line an addition follows, verbatim. `what` says
   what changes in one clause. One `RULE_BULLET_STYLE` governs this wording and
   the review's "example" line, so there is one house style for every rewritten
   sentence the product proposes (review prompt v3).
2. **The gate runs in code, at persist time, in both places a suggestion list
   is stored** (`match.ts`, `suggestions.ts`), never in the prompt: `factCheck`
   with the resume, the posting and the confirmed facts as sources; a
   replacement may not introduce a keyword marked `cannot_claim`; a rewrite
   that loses a must-have or primary keyword the quote carried is refused, a
   lost nice-to-have is a note.
3. **A refused wording is an explicit `null` with the reason on `why`.** The
   card shows the question, Copy and Edit & apply — the user writes the
   sentence, the product does not. The schema keeps "absent" and "null" apart
   (`judgedText`), so a v6 row still parses its quoted span and a judged row
   never does.
4. Keyword additions stay deterministic (`add` and confirmed terms only,
   stage 2). Nothing in this stage writes to the resume file.

Each rule was measured on the 108 wordings the model had written before the
field existed. Resume + facts alone blocked four — all by the employer
extractor, none by a metric: "B2B SaaS" and "East Coast hours" are posting
vocabulary, and adding the posting as a source clears them while laundering
zero metrics; "Node.js and TypeScript" in a PHP resume was a real fabrication
that `factCheck` cannot see (it checks tools only against facts), hence the
`cannot_claim` rule. KEEP WANTED KEYWORDS as first specified dropped 21 of
108, and 11 of those were paraphrased phrases or nice-to-haves — hence the
must/primary split.

## Consequences

- **More output tokens on the full report, measured: +4 % reply characters**
  (4 710 → 4 910 on the five bench fixtures, p50 20 → 22 s), for every action
  arriving paste-ready — 10 of 10 in the bench, 9 of 10 on the first live
  analysis, against 52 % before.
- **Apply on one press, including additions** (`insertAfterLine`), with the
  gate's refusals visible on the card as a reason, not as a silent absence.
- The prompt bump costs what bumps always cost here: stored v6 rows are no
  longer a memo hit and their keyword frame is not carried.
- `factCheck`'s employer heuristic still reads "for Node.js and Go services"
  as an employer; with the posting as a source it now only bites on text that
  is in neither document, which is the honest reading of it.
- The gate does not judge meaning. A replacement that drops half of a run-on
  skills block keeps every keyword the score reads and passes; Undo (stage 2)
  is what makes that acceptable.

Alternatives considered: letting the model mark its own wording "safe"
(rejected — ADR 0012's rule that the model judges facts and the code owns the
verdict applies here exactly); running the gate at render time (rejected —
the verdict would then differ between the job page and the change sheet, and
cost a fact check on every view).
