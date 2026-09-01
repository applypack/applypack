# /resumes: page overhaul + on-demand resume strength review

> **Analysis only — nothing implemented.** Written 2026-08-31 from a parallel
> session (browser audit of the live page at desktop + 375px, plus code
> verification) while `backlog-triage` was checked out with uncommitted work.
> Do not start without checking §10/§11 status in [TASKS.md](./TASKS.md) first.
> Companion TASKS.md section: §12.

Two parts. **Part A** is a findings audit of the existing `/resumes` hub and
`/resumes/:id` detail page. **Part B** is the design for the one genuinely new
feature the owner asked for: an **on-demand "is this resume strong?" review**
with visible progress and concrete make-it-stronger advice.

---

## Part A — /resumes page audit (verified 2026-08-31)

### A.0 Facts established (don't re-derive)

- `POST /resumes` awaits `scanResume` (~60 s AI call) before redirecting
  ([routes/resumes.tsx](../src/web/routes/resumes.tsx) `POST /resumes`). The
  browser sits on a frozen form; the submit button is never disabled, so a
  second click creates a duplicate resume **and** a second AI call. Same
  synchronous shape in `/resumes/:id/replace`, `/rescan` and `/draft`.
- The async pattern already exists and is in daily use:
  [target-runs.ts](../src/web/target-runs.ts) (in-memory registry, typed
  `RunStep` union) + the polled progress page
  [target-run.tsx](../src/web/pages/target-run.tsx) with per-step icons and
  the violet rotating activity line (§6.2). Used by `/target`,
  `/jobs/:id/match` and target re-upload — but not by resume upload/scan.
- At 375px the hub table (`min-w-[52rem]` + `overflow-x-auto`) shows only
  Name and a truncated Headline; Skills, Scanned and **both action buttons
  are behind horizontal scroll** — effectively unreachable on a phone.
- The `Table` primitive renders `th` from `columns: (string | JSX)[]`;
  there is no way to put a responsive class on the `th` itself, so hiding
  columns per breakpoint needs a small primitive extension
  (`columns: {label, class}[]` or similar). A finding against the system,
  recorded honestly.
- Deleting a resume cascades `ResumeMatch` **and** `CoverLetter` (including
  the user's manual `editedText`); the confirm says
  "Delete this resume and its comparisons?" — letters are not mentioned.
- The hub Skills column shows the first 6 of ~85 scanned `skills`; on the
  two real resumes both rows read `php, go, javascript, typescript, sql…`
  — zero differentiation. `Resume.primarySkills` (the 2–5 core stack,
  [schema.prisma](../prisma/schema.prisma)) exists and is unused here.
- No effectiveness signal on the hub: `ResumeMatch` holds count / latest /
  best `matchScore` per resume (one `groupBy`), none surfaced.
- `Resume.version` is shown on the detail header but not in the hub rows.
- `POST /facts` ([routes/facts.ts](../src/web/routes/facts.ts)) already
  accepts an arbitrary `term + decision + note + back` — a manual
  "add fact" form and a status-flip button need **no new backend**.
  Today a wrong answer can only be Forgotten, then the user waits for some
  future comparison to re-ask.
- There is no rename route — the name is fixed at upload forever, while a
  resume on v5 is often no longer what its v1 name says.
- `listOtherResumeSkills` (store.ts) already computes cross-resume skill
  evidence; `CoverLetter` rows relate to `resumeId` but are reachable only
  through each job's page.

### A.1 Findings, prioritized

| # | P | Finding | Fix (existing primitives) |
|---|---|---------|---------------------------|
| 1 | P0 | Upload & scan blocks the browser ~60 s, double-submit unguarded | Reuse the run registry: create resume → redirect to a run page (`steps: ['scan']`) → `resultUrl: /resumes/:id`. Same for replace/rescan. Add a `scan` label to the run-page step map if missing |
| 2 | P0 | 375px row: actions + 3 of 5 columns off-screen | Remove Delete from hub rows entirely (it lives on the detail page; destructive actions shouldn't be one click from a list). Hide Headline/Skills below `sm:` — needs the `Table` th-class extension above. Result: Name / Scanned / Set default fits with no scroll |
| 3 | P1 | Delete confirm understates blast radius (letters silently lost) | Confirm text mentions cover letters; ideally interpolate counts ("…, 12 comparisons and 3 letters") |
| 4 | P1 | Skills column doesn't differentiate resumes | Show `primarySkills` as `Tag`s first, rest as `+N` |
| 5 | P1 | No performance signal per resume | "Matches" column: count + best/latest score as `FitBadge` (number + meter, reads without colour) |
| 6 | P2 | Version invisible in hub | `Badge tone="info"` `v{N}` next to the name, as on the detail header |
| 7 | P2 | Facts: can't add or flip | Inline add form + per-row flip button over the existing `POST /facts` upsert |
| 8 | P2 | No rename | `POST /resumes/:id/rename` + inline form on the detail header |
| 9 | P3 | Polish | Filename mono line desktop-only (or `title` attr); facts grouped confirmed-first + `updatedAt` ("confirmed 2w ago"); absolute date in `title` on relative dates; `tabindex="0"` on the horizontal-scroll container |

### A.2 Feature candidates beyond the strength review

- **Score history per job across versions.** The detail hint already promises
  "the history below shows how the score moves between versions", but
  Comparisons is a flat list. Group by job, show `61 → 78` progressions
  (data: `resumeVersion` + `createdAt`; deltas via
  [diff.ts](../src/resume/diff.ts)). Closes the compare → edit → re-check
  loop that is the product's core.
- **Cover letters section on `/resumes/:id`** (job, tone, date, gate
  verdict) — also makes the delete blast radius visible.
- **Cross-resume skill diff** ("only in this resume / missing vs default")
  from `listOtherResumeSkills` — answers "which resume do I send when the
  posting wants X".
- **"Fill profile from this resume" link on the detail page** — the flow
  exists (ADR 0015) but is discoverable only via Settings and a one-time
  flash line.
- **Duplicate-upload guard**: sha256 over `original`, warn
  "identical to v3 of Senior Backend PHP". Cheap; pairs with finding #1's
  double-submit risk.

---

## Part B — On-demand resume strength review

### B.1 Product intent (owner's requirements, 2026-08-31)

1. Answer **"is this resume strong?"** and **"how do I make it stronger?"**
   — the outcome the owner named: the candidate should read like the best
   hire and a professional at their craft.
2. **Strictly on-demand.** Never auto-run on upload; upload keeps its
   current single scan. The review is a button the user presses.
3. **Discoverable.** A real card with an explainer and a visible CTA — the
   owner explicitly ruled out "an icon at the top nobody notices".
4. **Visible progress.** While the review runs, show *what is being
   checked*, step by step — the run-page pattern, not a spinner.

### B.2 Relationship to what already exists (no duplication)

| Existing | What it covers | What the review adds |
|----------|----------------|----------------------|
| `scan.ts` + `SCAN_SYSTEM` issues | Mechanical hygiene, job-agnostic: headings order, date formats, bullet counts, buzzwords, contact line, length, parser-breaking layout | A *judged rubric*: per-dimension grades with evidence, an overall strength score, prioritized rewrite advice, asks for missing metrics |
| `parse-warnings.ts` | Deterministic ATS parseability of the extracted text | Feeds the review run as a free pre-step (no AI) |
| `match.ts` / `score.ts` | Resume **vs one posting** | The review is deliberately job-agnostic — "strong for your role type", not "fits this job". Card copy must state this split ("to check against a posting, use Resume match on a job page") |
| Detail card "Issues to fix (any job)" | Renders the scan's issues | Once a review exists for the current version, its advice list **subsumes** this card — one advice surface, not two competing lists |

### B.3 Design decisions

1. **The model never outputs the overall number** (ADR 0012, gotchas 8/11 —
   every scoring prompt without hard caps inflates). The prompt marks
   per-dimension **grades** (`strong | ok | weak`, each with 1–2 verbatim
   evidence quotes); a pure `review-score.ts` maps grades → 0–100 with
   hard caps in code (e.g. impact/quantification `weak` → cap 55; two or
   more `weak` dimensions → cap 45 — exact caps tuned on the two real
   resumes at implementation time). Unit-tested like `score.test.ts`, with
   a gotcha-11-style guard: a duties-only, zero-numbers resume must not
   score high.
2. **Rubric dimensions** (each graded, each with evidence):
   - *First impression* — headline + summary: does a recruiter know in 10
     seconds who this is and at what level?
   - *Impact & quantification* — achievements vs duties; numbers, outcomes
     (revenue, cost, speed, reliability, users, time saved).
   - *Seniority signal* — scope, ownership, leadership, decisions; does the
     language match the claimed level?
   - *Clarity & structure* — density, section order, bullet quality, length
     (parse-warnings results injected as deterministic context).
   - *Role-type keyword coverage* — against the resume's own scanned
     `roleTypes` (job-agnostic), not against any posting.
   - *Red flags* — clichés, weak verbs, buzzword stuffing, unexplained
     gaps *as presented* (never speculating about the person).
3. **Honesty boundary — "look like the best professional" ≠ invent facts.**
   The pitch is achieved by *reframing and quantifying what the text
   already supports*, never by fabrication (the same stance as the letter
   gate, ADR 0020/0021). Concretely: advice items may (a) rewrite using
   only facts present in the resume, or (b) carry an explicit
   `ask: "how many users / what % / team size?"` instead of an invented
   number. Example rewrites in advice run through `factCheck` before
   persisting; a blocked rewrite degrades to the ask form.
4. **Prompt discipline**: new `REVIEW_SYSTEM` builder in
   [prompts.ts](../src/resume/prompts.ts) with its own `PROMPT_VERSION`
   stamp; fenced via `fence()` (ADR 0022 — the registry test
   `prompt-fence-registry.test.ts` will fail CI until it is covered).
   Tool-free (ADR 0009). Web-only (ADR 0008) — the worker never imports it.
5. **Storage**: new `ResumeReview` table mirroring `ResumeMatch`
   conventions — `resumeId`, `resumeVersion`, `model`, `promptVersion`,
   `grades Json`, `advice Json`, `strengths Json`, `asks Json`,
   `breakdown Json` (deterministic, from `review-score.ts`), `createdAt`.
   One row per run (keep history) → strength trend across versions comes
   free. Hand-written migration (gotcha 7).
6. **Engine/model**: reuse the `resume` role in the engine chain initially;
   add a per-engine `review` slot only if quality demands it (the
   cover-letter precedent: empty inherits).
7. **Cost honesty in copy**: "one AI call, ~1–2 min"; counted in `aiUsage`.
8. **ADR required at implementation** (adr-writer triggers: new AI call
   site + new table): scope, rubric-caps rationale, the asks-not-inventions
   rule.

### B.4 UX

- **`/resumes/:id` — "Resume strength" card** (the discoverability
  requirement):
  - *Before the first run*: an explainer state, not an `Empty` one-liner —
    what the review checks (the six dimensions, in plain words), what the
    user gets (score + prioritized advice), the cost line, and a violet
    **"Run strength review"** button (violet = AI action, DESIGN.md).
  - *After*: overall score in the `FitBadge` number+meter style;
    per-dimension rows (grade badge + one-line why + evidence quote);
    prioritized advice list (issue → why it matters → how to fix →
    example rewrite *or* metric ask); "strengths to keep" so the user
    doesn't edit away what works; meta "reviewed v3 · 2d ago" + Re-run.
  - *Staleness*: when `resume.version > review.resumeVersion`, a warn
    badge — "review is for v3, resume is at v5 — re-run".
- **Hub surfacing** (`/resumes`): a Strength column — score badge when
  reviewed, otherwise a quiet "not reviewed" link to the detail card. The
  upload success flash gains one sentence pointing at the review. **No
  auto-run anywhere.**
- **Progress** (the visible-steps requirement): the same run registry —
  extend the `RunStep` union with `review`; steps render as
  `Extract ✓ → ATS checks ✓ → Strength review … → Save`, and the violet
  activity line rotates through the rubric dimensions ("checking impact &
  quantification…", "checking seniority signal…") exactly like §6.2's
  prompt-checklist rotation. Terminal state redirects to the detail card
  with a flash.
- **Metric-ask loop** (phase 3): advice asks render the existing
  ask_user-style confirm UI; answers persist (a `CandidateFact` note or a
  review-local answer store — decide at implementation) and a Re-run folds
  them into rewrites. This is how "best professional" is reached honestly:
  the numbers come from the user, the wording from the model.

### B.5 Phasing (one feature = one branch = one PR)

1. **`resumes-page-p0`** — Part A #1–#5: async upload/replace/rescan via
   the run registry, mobile row fix (+ `Table` th-class extension),
   delete-confirm blast radius, `primarySkills` column, Matches column.
   P2/P3 items ride along only where the diff already touches them.
2. **`resume-strength`** — Part B MVP: `REVIEW_SYSTEM` + zod schema + pure
   reply parser + pure `review-score.ts` caps + `ResumeReview` migration +
   run-page step + detail card + hub column + ADR.
3. **`resume-strength-loop`** — metric asks → answers → re-run deltas;
   version-over-version strength trend on the detail page (pairs naturally
   with A.2's grouped score history).

### B.6 Verification matrix (testing-gate)

- **Pure**: reply-parser test; `review-score` cap tests including the
  duties-only guard; fence registry test picks up the new builder
  automatically.
- **Schema**: hand-written migration, reviewed before `migrate dev`.
- **Dashboard**: rebuild; screenshots 375 / 768 / 1200 of hub, detail card
  (both states), run page; a live run against both real resumes — sanity:
  the two should NOT land on the same score if the rubric discriminates.
- **Prompt quality**: one weak-vs-strong gold fixture pair through
  `bench:resume`-style smoke only if prompt iteration proves necessary
  (§F9 reasoning — don't build eval infrastructure ahead of need).

### B.7 Risks / open questions

- **Grade inflation** is the known failure mode of every scoring prompt in
  this repo (gotchas 8, 11) — the caps live in code and get a guard test,
  or the feature ships flattery instead of advice.
- **Advice hallucination**: the asks-not-inventions rule plus `factCheck`
  on example rewrites; manual spot-check on the live resumes before PR.
- **Overlap with the scan's issues card**: resolved by subsumption (B.2) —
  decide the exact rendering when building the card, but never show two
  competing advice lists.
- **In-memory runs**: a web restart forgets an in-flight review (accepted
  behaviour for /target already — ADR 0003 philosophy, no queue).
- **Tone**: advice must stay recruiter-practical ("state the outcome of
  the migration in numbers"), not generic career-coach filler; the
  stop-slop pass applies to the card copy and the prompt's advice style
  rules.
