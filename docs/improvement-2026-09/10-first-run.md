# §10 — Make first-run UX more guided

**Verdict: the first five of the plan's eight steps shipped in v1.7.0; adopt the follow-through (steps 5–8) as one small block (P3).**

## What the plan proposes

Guide a new user through one complete success: connect AI → add a resume →
one search → fetch → **open one match → understand the score → tailor →
save / application**. Every step says what happens, why, whether it costs an
AI call, what leaves the machine, what success looks like.

## What the repo has today

- `/welcome` (`src/web/welcome-steps.ts`, `pages/welcome.tsx`): five steps,
  each derived from data, never stored — `ai` → `search` → `profile` →
  `sources` → `matches`. `/` redirects there until "Start the hourly watch"
  or "Skip setup"; the Overview shows "Finish setup →" while a step is open.
  Shipped v1.7.0–v1.11.0 (TASKS §11, [onboarding-plan.md](../onboarding-plan.md)).
- Cost markers exist on two steps only: step 1 *"spends one tiny AI call"*
  (`welcome.tsx:283`), step 2 *"No AI, no profile needed"* (`:391`). Step 3
  (the resume scan, one AI call ≈ 30 s) and step 5 (scoring ten jobs, ten
  calls) say nothing about cost; the violet button colour is the only signal
  (DESIGN.md: violet = AI action).
- After "Start the hourly watch" the wizard ends. Nothing on the Overview says
  *open a match → Compare → Tailor*; the user meets the Resume match card
  only by clicking into a job. `overview.tsx` has no post-setup branch.

## Assessment

The plan's steps 1–4 are shipped and match its principles (what happens, what
success looks like). Steps 5–8 are the product's actual value and the one
place a new user is left to find the door alone — the same "doorway" problem
issue #164 analysed for the match card. Two cheap pieces close it:

1. The two missing cost lines (a `<Hint>` each, same wording pattern as
   steps 1 and 2).
2. A data-derived "next" card on the Overview, shown while
   `setupCompletedAt` is set **and** `resume_match` has zero rows: *Open your
   best match → Compare (one AI call) → Tailor resume (no AI while you type)*
   with the top-scored job linked. It disappears the moment a comparison
   exists, exactly like the wizard's own steps.

No new tables, no new routes; `welcome-facts.ts` already loads the counts.

## Steps → TASKS §20, block `first-run-follow-through`

- [ ] Hints on wizard steps 3 and 5: what the call costs and how long it takes
      (`RESUME_TIMEOUT_MS` band; ten jobs ≈ N s on the CLI per §13 measurements).
- [ ] Overview "Your next three things" card, derived from data
      (`scoredCount > 0 && matchCount === 0`), linking the top match's
      `/jobs/:id` and explaining Compare vs Tailor in one line each.
- [ ] `welcome-steps.test.ts` grows the two conditions; screenshot in the PR.
