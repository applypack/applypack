# §5 — Make the scoring architecture a core marketing message

**Verdict: done; the two-column contrast graphic is optional polish (P3).**

## What the plan proposes

Lead with "AI extracts facts. Code computes the score." and a visual that
contrasts *Job + Resume → AI extracts evidence → deterministic rules →
explainable score* with *Job + Resume → LLM → "87 %"*.

## What the repo has today

- `#score` on the landing: *"Most AI resume tools average their way to a
  flattering number. ApplyPack splits the job: the model only marks what is
  present, missing or unverifiable, and a unit-tested formula applies the
  caps."* Then four theses (primary-stack gate, no sibling credit, unknowns
  stay unknown, honest deltas) and a link to ADR 0012.
- README pillar two: *"The model marks facts, code computes the score."*
- The demo above it is the proof rather than a diagram.

## Assessment

The message is there, in the words the plan asks for. A drawn contrast
(two arrows, one ending in "87 %") could go beside the four theses; it is a
graphic, not a change in what the page says. Worth ten minutes when the site
is next touched, not a block of its own.

## Steps

Fold into the site pass in [06-employer-split.md](./06-employer-split.md) as
an optional item.
