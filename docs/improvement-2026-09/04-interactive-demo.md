# §4 — Keep the interactive demo prominent

**Verdict: done.**

## What the plan proposes

Put the demo near the top with one instruction — "Try typing `Redis`" — and
make the result visually obvious.

## What the repo has today

- The demo is **inside the hero** (`site/public/index.html:63–98`): score
  value with `aria-live`, a bar, chips, the posting and the editable resume
  side by side.
- The hint under it is the plan's sentence and two more that show the two
  things the plan wants proven: *"Type `Redis` into the skills line: the score
  moves on the next keystroke. Type `Terraform`: nothing moves, because the
  model marked it cannot-claim against the original resume, and typing a word
  is not evidence. Delete every `TypeScript` to watch the primary-stack cap
  bite."*
- `/demo/` is the full page; `src/web/site-vendor.test.ts` holds the vendored
  `score.mjs` / `target.mjs` byte-identical to the app's, so the demo cannot
  drift from the product.

## Steps

None.
