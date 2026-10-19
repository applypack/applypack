# 0045 — The resume text decides whether a keyword is present

**Status:** Accepted (2026-09-08). Amends the live-score rule of [0012](./0012-deterministic-match-score.md) and the anchoring rule of the [0044](./0044-the-posting-is-read-once-on-its-own.md) addendum.

## Context

ADR 0012 gave a `cannot_claim` keyword zero credit in the live editor "even
when typed", for claim safety; the anchoring pass that settles `present` vs
`add` against the resume text (`keyword-anchor.ts:anchorStatuses`) upgraded a
written `add` or `ask_user` to `present` and never touched `cannot_claim`. So
the status was a verdict the model gave on one text, and the number kept
honouring it after the text changed.

A live pair showed the cost (match 139, 2026-09-08): typing `Ajax` (an
`add`) moved the ring +3, typing `WordPress` or `BEM` (`cannot_claim`) moved
nothing — and WordPress already stood on the resume's own title line while
the stored row said "no WordPress work anywhere in resume", capped the score
at 70 as a missing primary and stored 41. The first fix that morning, a
confirm tier ("I have it"), asked the candidate to restate what the resume
said. The complaint was exact: the comparison should read the resume, not
the facts stored about the person.

Measured before deciding, over 138 stored comparisons and 2 202 keywords:
1 215 `cannot_claim` rows, 29 of them written in the text, 8 of those a
primary must. The 29 split into listed-only terms the model would not credit
(Rust, Java, WordPress, jQuery, a hedged "Go"), a version the alias table
folds (PHP 8 → PHP), a degree field (Engineering, on job titles), and 8
homonyms — "GCP" meaning Good Clinical Practice on an engineer's resume —
every homonym on a comparison scoring 0.

## Decision

Presence is a question about the text, and the matcher answers it for every
status, on both sides of the split:

| The text … | status stored (`anchorStatuses`) | live credit (`entriesFromLive`) | covers the primary cap |
| --- | --- | --- | --- |
| spells the term | `present`, whatever the model said | 1 | yes |
| does not, model said `present` or `add` | `add` | 0.5 | yes |
| does not, model said `ask_user` or `cannot_claim` | unchanged | 0 | no |

`src/web/score.test.ts` runs both sides over one fixture, edit by edit, and
demands equal breakdowns: the ring is the score the next analysis stores for
the same text, for every part a word search can read. A stored denial does
not outrank the text either — `facts.ts` already let a written word stand
over a stale "no".

What does not change: the model still judges the statuses, alignment, gates
and red flags; "named, but nothing behind it" is the `evidence` grade
(listed / described / measured), never the status; "+ add" is offered only
for `add`, and the replacement gate still refuses wording that would
introduce a `cannot_claim` term — a claim the app writes is not a claim the
user writes. The confirm tier stays as the other way in: a fact stored once
and reused. `src/scripts/reanchor-matches.ts` brings stored rows under the
rule with no AI call.

## Consequences

- *Amended 2026-10-12 (v2.55.61, #203).* The status is the text's, and the
  note beside it stayed the model's: a row read "in your resume" next to
  "no WP evidence to support it" — the reason for the verdict the code had
  just overruled. Of the three ways out (drop the note, replace it, keep
  and label it) the note is kept and labelled, because it loses nothing:
  `anchorStatuses` records the verdict it overruled on the row
  (`overruled`: `ask_user` or `cannot_claim`), and the keyword table says
  the note was written before the word was found. An `add` that is written
  was never contradicted, so its note ("Candidate confirmed: …") is shown
  as it is. Rows flipped before this version carry no record and read as
  they did.
- *Amended 2026-10-18 (#204).* A `cannot_claim` the text spells only through
  an alias ("PHP" for "PHP 8") turns `present` with a real grade, and a red
  flag naming it stopped being exempt in `red-flags.ts:countableFlags`: ten
  points for what the row's "as PHP" badge already says (match 80 lost them on
  the backfill). A flag naming an alias-only term is exempt now, like one
  naming a missing or listed-only term, and `store.ts:rescoreMatchKeywords`
  reads the alias-only mark off the comparison's text before the flags, as
  `match.ts` does, so a backfill or a keyword edit charges what an analysis
  would. The ring holds the stored penalty, so it agrees with no change of its
  own. `SCORING.version` stays 6: which flags reach the formula is decided
  before it, as for the skills-line exemption.

✅ The number reads the resume; live and stored agree on the same text; no
page asks for a "yes" about a word already on it; the primary cap lifts the
moment the stack is written in.
❌ A homonym earns its weight (GCP); a term listed with nothing behind it
earns as much as one described — the badge says "skills line only", the
number does not; a user can raise the number by typing. The app's job is the
warning, not the veto.

## When to revisit

If evidence grading enters the score (evidence.ts's own trigger), "written"
stops being binary and this rule becomes the floor of that scale. Or if a
homonym shows up on a comparison that matters — one scoring above the noise.

## Addendum (2026-09-28): the text decides strength too

Presence stays one question about the text. Since score v6 (ADR 0058), so is
strength: whether a written term sits on a list of terms or inside a sentence
about work is read off the text on both sides, by `evidence.ts` on the server
and `public/evidence.mjs` under the editor, and a term only listed earns 0.85
of its credit. The model's own "named, nothing behind it" stays a note, as
this ADR decided.
