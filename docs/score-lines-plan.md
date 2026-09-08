# One number outside, four judgments inside (plan)

> Analysis 2026-09-07, nothing built. Answers the owner's question: can the
> card show three or four scores the headline number was made of, and why was
> that idea not picked up in v1.70.0. Pairs with
> [ADR 0012](./adr/0012-deterministic-match-score.md),
> [ADR 0044](./adr/0044-the-posting-is-read-once-on-its-own.md) and §2, §4,
> §39, §49 of the Resume ↔ Job Intelligence analysis.

---

## 1. Why it was not picked up

Three reasons, and only one of them is a good one.

**It looked done.** `ScoreBreakdownChips` already renders under the summary:

```
Keywords 60/60 · Alignment 40/40 (strong · strong · strong) · you fit 100
```

Reading the intelligence analysis I checked whether a breakdown existed, saw
that one did, and moved on. But those chips show **the formula's parts**, not
the judgments. "Keywords 60/60" is an implementation detail — the size of a
weighted pool nobody outside the code knows about. The question a candidate
asks is not "how was the arithmetic done", it is "what did it decide about me".
Checking for the presence of a breakdown instead of for whether it answers
anything is the actual mistake.

**Every pass was driven by a reported bug.** The strikethrough, the 49-point
cliff, the empty advice list, the variance. Bug-driven work fixes what is
wrong; it never asks what is missing. Nothing in three passes forced the
question "is one number enough".

**Part of it was not computable until v1.70.0.** The most valuable of the four
lines below reads `evidence`, which did not exist before that release. That
part is chronology, not judgment.

---

## 2. The case that makes the argument

Match 133, a live row, is the screenshot's 100:

```
100/100   AI match · excellent
          draft · full analysis 0s ago
          Ready to apply — stop polishing, send it.
```

The breakdown behind it is genuinely perfect: keywords 60/60, alignment 40/40,
penalty 0, primary stack 2/2, ceiling 100. The formula is not wrong.

What the same row also holds, and the header does not say:

| | |
|---|---|
| The model's own summary | *"strong senior candidate whose resume **undersells** the WordPress/agency angle behind heavy enterprise-architecture noise"* |
| Suggested edits | 3 actions, 5 removals |
| Cautions | 3 |
| Hard requirements | 4 pass, **1 unknown** |
| Evidence | 11 of 13 terms shown in a bullet, **2 named only in a list** |

So the page says *stop polishing, send it* directly above *3 suggested edits ·
5 removals*, on a resume the analysis says undersells itself, with one
requirement nobody has confirmed. Every one of those facts is already stored.
None of them is in the header.

That is the whole argument. The number is right; the headline is not the
answer.

### A second, smaller finding from the same row

`Ready to apply — stop polishing, send it.` is gated on `matchScore >= 85`
and nothing else (`pages/target.tsx:269`). It ignores the gates, the cautions
and the action list. Whatever is decided about the lines below, that sentence
should read the diagnostics — a failed or unconfirmed hard requirement is
exactly the thing that stops an application, and it costs the score nothing.

---

## 3. What can honestly be shown today

Everything below is already in `ResumeMatch` — no new AI call, no prompt
change, no schema. Three lines made the number; two did not and still matter.

### Scored — these three are the 100

| Line | Reads | Source |
|---|---|---|
| **Requirements** | `24 of 33 of what the posting asks for` | `breakdown.keywordEarned / keywordTotal`, the count from `keywords[]` |
| **Core stack** | `PHP · WordPress — both present` | `primaryPresent / primaryTotal`, names from the primary keywords |
| **First glance** | `title, summary and recent role all strong` | `breakdown.alignment` |

Core stack deserves promoting hardest. It is the single biggest lever in the
formula — it caps the total — and today it is visible **only when it bites**
("capped at 30 — primary stack 0/1"). A candidate who is one keyword away from
a cap has no way to see it coming.

### Not scored — these two are why a 100 can still need work

| Line | Reads | Source |
|---|---|---|
| **Shown at work** | `11 of 13 in a bullet · 2 named only in a list` | `keywords[].evidence` (v1.70.0) |
| **To confirm** | `1 hard requirement the resume is silent on` | `hardRequirements[]` |

"Shown at work" is the new information. A term named on a skills line and a
term shown inside a bullet with a number are read completely differently by a
human, the formula does not distinguish them, and until v1.70.0 nothing
measured it. On match 133 it is the line that agrees with the model's own
"undersells" verdict.

---

## 4. What it should look like

The headline stays exactly as it is — one number, one word, one sentence. The
four lines replace the chip row that already sits under the summary, so the
page gains no new widget:

```
100/100   ready to send

what made the number
  Requirements    33 of 33 the posting asks for
  Core stack      PHP · WordPress — both present
  First glance    title, summary and recent role all strong

what it does not count
  Shown at work   11 of 13 in a bullet · 2 named only in a list
  To confirm      1 hard requirement the resume is silent on
```

Two rules the wording has to follow.

**Fractions and words, not invented percentages.** The variance fixture
measured a ±5 spread on a stable pair; "Requirements 76%" claims a precision
the system does not have. "33 of 33" is checkable and needs no legend.

**The split is visible.** A user who sees "Shown at work 11 of 13" under a 100
will ask why the 100 is a 100. The heading answers it before they ask. Sub-
scores that quietly do not feed the total are worse than no sub-scores.

Naming: avoid "ATS Visibility" for the evidence line, whatever §39 of the
analysis calls it. §3 of that same document is right that no product can claim
a real ATS score, and "Shown at work" is a claim about the resume rather than
about somebody else's software.

---

## 5. What not to copy from the analysis

The intelligence document's §49 lists six dimensions. Two of them should not
be built here:

- **Market Readiness** needs a job corpus or an O*NET / ESCO integration. No
  data source exists, and a dimension computed from nothing is a number that
  looks like the others and means less.
- **Resume Quality** already exists as its own thing: the job-agnostic
  strength review (ADR 0030), deliberately separate because "is this a good
  resume" and "does this resume fit this posting" are different questions.
  Folding it into a per-posting card merges two answers the product spent a
  release keeping apart. A link from one card to the other is the right size.

---

## 6. Cost, and the argument against

**Cost.** One pure module (`web/score-lines.ts`: breakdown + keywords + gates →
five lines) with unit tests, one component swapped in `resume-match-card.tsx`,
copy. No AI, no schema, no migration, no prompt version bump. Rows written
before v1.70.0 carry no `evidence`, so that one line reads "not measured on
this analysis" and everything else is unchanged.

**The argument against, stated fairly.** Four more lines on a page whose owner
has asked twice to simplify it. The mitigation is that this is a swap, not an
addition — the chip row it replaces is already four items, and the new ones are
sentences instead of ratios. If that argument does not convince on the real
page, the honest fallback is three lines and no "what it does not count"
heading: **Core stack**, **Shown at work**, **To confirm** — the two levers and
the one blocker, dropping Requirements and First glance back into the summary
sentence where they already are.

---

## 7. Recommendation

Build it, as a swap rather than an addition, in this order:

1. `score-lines.ts` and its tests — pure, no UI.
2. Gate `Ready to apply — stop polishing, send it.` on the diagnostics, not on
   the number alone. This is a small fix and it stands on its own; it can ship
   first.
3. Swap the chip row on `/jobs/:id/target` and `/jobs/:id`, and look at the
   real page before deciding between five lines and three.

Not a tagged feature on its own — it is UI over data that already exists, so it
rides with whatever minor it lands in.
