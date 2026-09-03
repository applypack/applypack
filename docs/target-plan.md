# /target compare flow: speed (30-40 s target) + keyword-matching accuracy

> **Analysis written 2026-08-31; blocks 1–3 of §7 shipped 2026-09-02 (measured
> numbers in §2.3, §3.4 and §4).** Written from a parallel
> session (full source pass over the compare pipeline: `src/web/routes/target.tsx`,
> `jobs.tsx`, `src/resume/{match,scan,prompts,score}.ts`, `src/web/public/{target,score,target-page}.mjs`,
> `src/ai-{runtime,provider}.ts`, `src/jobs/{manual-job,posting-extract,classify-existing}.ts`)
> while `backlog-triage` was checked out with uncommitted work from other
> sessions. Do not start without checking §10–§12 status in
> [TASKS.md](./TASKS.md) first. Companion TASKS.md section: §13.
>
> All latency numbers below are **starting hypotheses** — the code paths and
> serialization are verified facts, the seconds are estimates to re-measure
> (see §2.3) before and after each change.

Two asks from the owner:

- **A. Speed.** A compare should land in **30-40 s**. Today a fresh-resume
  compare takes ~3 min. Find what can be cached after the first run, what can
  run in parallel, what can be skipped — including a "keywords only, don't
  rewrite my bullets" mode.
- **B. Accuracy.** Some important words from the posting are never
  highlighted. Audit the matcher end-to-end, add keyword prioritization,
  cross-check against current resume-vs-JD best practice.

---

## 1. The pipeline as written (facts established — don't re-derive)

Four entry points share the same building blocks:

| Entry point | Steps (serial, in order) | Where |
| --- | --- | --- |
| `POST /target` (new compare) | resolve resume inline → **[extract] → classify → match** | [routes/target.tsx](../src/web/routes/target.tsx) |
| `POST /jobs/:id/target/reupload`, named resume | **scan → match** | [routes/jobs.tsx](../src/web/routes/jobs.tsx) `reupload` |
| `POST /jobs/:id/target/reupload`, scratch resume · `POST /jobs/:id/match` (Compare / Re-analyze) | **match** only | same file |
| `POST /resumes` (upload on /resumes) | **scan**, fully synchronous — browser sits on the frozen form | [routes/resumes.tsx](../src/web/routes/resumes.tsx); already covered by §12 / [resumes-plan.md](./resumes-plan.md), not re-planned here |

Per-step facts:

| Step | Call | Role → default model | maxTokens (out) | Notes |
| --- | --- | --- | --- | --- |
| extract | `extractPostingFacts` | classifier → **Haiku 4.5** | 250 | Only when company/title/location left empty; reads first 6 000 chars |
| classify | `createManualJob` → `classifyExistingJob` | classifier → Haiku 4.5 | 600 | **Two calls** when `classifierMode = two_stage` (prefilter 100 tok + full 600 tok). Re-pasting the identical posting dedupes → classify skipped |
| scan | `scanResume` | resume → **Opus 5** (`CLAUDE_MODEL_RESUME` default `claude-opus-5`) | 3 000 | 5-min timeout, `PARSE_ATTEMPTS = 2` |
| match | `matchResumeToJob` | resume → **Opus 5** | **8 000** | 5-min timeout, `PARSE_ATTEMPTS = 2`. Input ≈ 30 000 resume chars + 15 000 posting chars + ~2.5 k-token system prompt ≈ **~15 k input tokens**; real output ~2.5-4 k tokens (≤25 keywords × {term, aliases, where, note} + ≤10 actions with ≤200-char quotes + ≤8 removals with quotes + gates + strengths + cautions) |

Independence facts (the levers everything in §3 stands on):

- **`match` never reads the classification.** The fit score feeds the jobs
  list / job card, not the compare result. `createManualJob` already has a
  `{classify: false}` seam — the cover-letter flow uses it (F8.3).
- **`match` never reads the scan.** The scan feeds `/resumes/:id`, `pick.ts`
  preselection, profile drafts, and `listOtherResumeSkills` *for other
  resumes' future matches* — never the match that runs next to it.
- **The keyword frame is already half-cached.** `matchResumeToJob` loads the
  latest match of the same job and passes up to 40 `previousKeywords`
  (term + priority + requirement + primary) so re-runs reuse the frame and
  scores stay comparable. But the model still re-reads the full posting and
  re-emits every keyword row — the cache saves *stability*, not *time*.
- **A parse failure silently doubles a step.** Both scan and match retry the
  identical prompt once on schema mismatch (`PARSE_ATTEMPTS = 2`); on Opus
  that is +1-2.5 min of invisible tail latency.
- **Engine choice dominates constants.** `anthropic_api` is one HTTPS call
  with a prompt-cached system block. `claude_code` spawns a process per call
  with ~5 k tokens of CLI system prompt and no cross-call reuse
  ([ai-provider.ts](../src/ai-provider.ts) docstring) — add ~10-30 s *per
  call*; a two-stage first compare is then **4 serial CLI spawns**
  (extract + prefilter + classify + match).
- The run registry ([target-runs.ts](../src/web/target-runs.ts)) is solid —
  polling page, per-step icons. Its copy undersells reality: `STEP_VIEW`
  promises "about a minute" for scan and match; the reupload menu says
  "about 2 minutes"; on Opus + CLI both are optimistic.

## 2. Where the ~3 minutes go

### 2.1 Latency model

Interactive wall time ≈ Σ over serial calls of
(*provider overhead* + *input processing* + **output tokens ÷ output speed**).
Output tokens dominate: match emits 2.5-4 k tokens and Opus streams roughly
25-50 tok/s, so **the match call alone is ~60-160 s on Opus** regardless of
everything else. Sonnet-class output speed (~2-3×) puts the same call at
~30-70 s; Haiku-class at ~20-40 s.

### 2.2 Scenario estimates (hypotheses; API engine vs claude_code CLI)

| Scenario | Serial chain today | est. API/Opus | est. CLI/Opus |
| --- | --- | --- | --- |
| First compare on /target (fields empty, two-stage on) | extract → prefilter → classify → match | ~90-200 s | **~150-300 s** ← the reported "~3 min" |
| Re-upload new version of a named resume | scan → match | ~100-250 s | ~150-300 s |
| Re-analyze / Compare (match only) | match | ~60-160 s | ~90-200 s |

### 2.3 Measure before optimizing

`resume: matched` already logs `ms`. Add the same `ms` field to the
scan / extract / classify log lines and log a per-stage delta in
`updateRun` (`stageAt` already exists) — one log pass over a week of real
runs replaces every estimate above. No schema change.

**Measured 2026-09-02** (block 1, `claude_code` CLI engine, Opus for the
resume role, Haiku 4.5 single-stage classifier, one run at a time; 12 runs):

| Call | Samples (s) | Note |
| --- | --- | --- |
| match | 78 · 83 · 85 · 94 · 94 · 96 · 109 | p50 ≈ 94, p90 ≈ 109 — the whole critical path after P0 |
| scan | 26 · 33 · 36 | half the "about a minute" the copy promised |
| extract | 12 · 32 · 37 | high variance on the CLI engine |
| classify | 49 · 55 | single-stage; off the critical path since block 1 |

Critical-path wall time, before → after block 1: fresh `/target` compare
158 → 128 s, the same paste again 158 → 38 s (extract, then the stored row),
Compare 109 → 79 s and a repeat 109 → 0 s, re-upload 117 → 95 s and the same
file again 117 → 2 s. §2.2's "~150-300 s" first-compare estimate was right
for the CLI engine; the API-engine column stays unmeasured (not in the
owner's chain).

---

## 3. Speed plan

### 3.1 P0 — same calls, different order (no prompt, no schema changes)

1. **Take classify off the critical path on /target.**
   `createManualJob({ classify: false })`, then run `classifyExistingJob`
   fire-and-forget *in parallel* with `matchResumeToJob`. The compare result
   never shows the fit score; the job card gets it a minute later. The run
   page drops the classify step (or marks it "in background").
   Saves the full classify leg: ~5-40 s API, ~20-90 s CLI/two-stage.
2. **Take scan off the critical path on reupload.** In the named-resume
   branch start `matchResumeToJob` immediately and let `scanResume` finish in
   the background (`void` + logged failure). Known cost: `Resume.skills`
   stays one version stale until the background scan lands (affects only
   *other* resumes' "elsewhere" hints and /resumes display; `scannedAt:
   null` already marks it). Saves ~40-90 s.
3. **Memoize identical work.** Before calling the AI, if the latest
   `ResumeMatch` for (jobId, resumeId) has `resumeText` identical to the
   input text (and the same `PROMPT_VERSION`), return the stored row and
   flash "unchanged since the last analysis" (with a "re-run anyway"
   escape). Kills the double-submit / back-button / re-paste full-price
   re-run. A plain string compare — no schema change.
4. **Honest progress copy.** `STEP_VIEW` durations from measured p50/p90
   (§2.3), per-step elapsed seconds on the run page. Perceived speed counts;
   "about a minute" that takes three reads as broken.

P0 alone turns the first-compare chain into a single match-length wait
(~60-160 s on Opus). Not 30-40 s yet — that needs P1.

### 3.2 P1 — the fast lanes the owner asked for

5. **Instant check, zero AI (the "тільки перевірити ключові слова" mode).**
   Everything needed already exists in the browser: the target editor
   re-scores any text against the stored keyword frame live
   (`target.mjs` + `score.mjs`, same formula as the server). Missing is only
   the entry point: today "Re-upload resume" *forces* a full AI run.
   Add a parse-only path: upload → `extractResumeText` (pure, <1 s) →
   render `/jobs/:id/target` with the new text loaded as a **dirty draft**
   over the previous match's frame — live estimate, missing-keyword chips
   and highlights appear in **~2-5 s**, and "Re-analyze with AI" (already on
   the page) upgrades it to an official score on demand. Also covers
   "new resume vs already-analyzed job" on /target when the posting dedupes
   to an existing job with a match.
   *Limit to be honest about:* textual presence can verify `present`, but
   only the AI can judge `add` / `ask_user` / `cannot_claim` for a *new*
   resume, so the estimate inherits the previous resume's statuses — label
   it "estimate vs the frame from &lt;date&gt;", exactly like the live
   editor does today.
6. **Fast AI mode — keywords-only prompt.** A `MATCH_SYSTEM` variant that
   returns only `summary` (one line), `alignment`, `red_flags`,
   `hard_requirements`, `keywords` — **no actions, no removals, no
   strengths/cautions**. That is the score-complete subset
   (`scoreMatch` needs exactly keywords + alignment + flag count) at ~¼ of
   the output tokens → ~20-40 s even on Opus, ~10-20 s on Sonnet.
   Suggestions become a lazy second call ("Get suggestions" on the target
   page) that reuses the stored keyword frame. Needs: prompt variant +
   schema subset in `prompts.ts`, a `mode` flag on `matchResumeToJob`,
   `PROMPT_VERSION` handling, guard tests (gotcha 11 rules must survive in
   the short prompt verbatim).
7. **Bench Sonnet for the resume role.** ADR 0012 moved all arithmetic into
   `score.ts`; the model only marks facts — precisely the setup where a
   faster model loses least. Run the existing gold bench both ways
   (`CLAUDE_MODEL_RESUME=claude-sonnet-5 npm run bench:resume` vs Opus),
   compare keyword/status/alignment agreement. If it holds: flip the
   default (or document the per-engine "Resume model" select on /settings
   as the speed dial — the UI already exists). Likely the cheapest big win:
   ~2-3× on every scan/match with zero code.

### 3.3 P2 — structural (only if P0+P1 measurements still miss the target)

8. **First-class per-job keyword frame.** Split the mega-call: call A
   (per job, cached until "Rebuild keywords") extracts the frame —
   keywords + requirement/primary + hard gates; call B (per resume ×
   version) judges statuses/aliases/where + alignment against a posting
   *summary* instead of the full text. Smaller input AND output on every
   re-compare; the frame becomes the artifact §4/§5 hang priorities and
   overrides on. Needs an ADR (new AI call site; frame stored either as the
   latest-match JSON formalized, or a `JobKeywordFrame` column/table).
9. **Streaming partial render** (API engine only) — show keywords as they
   arrive. Real work in the run-page plumbing, CLI engines can't join.
   Defer.

Explicit non-goals: no queues/Redis (ADR 0003), no worker involvement, no
second HTTP server.

### 3.4 Does it reach 30-40 s?

| Scenario after the plan | Chain | est. wall time |
| --- | --- | --- |
| Re-upload vs analyzed job, instant check (5) | parse only | **~2-5 s** → measured 2026-09-02: parse 0–2 ms (.docx) / 10–15 ms (.pdf, 64 ms cold), POST → rendered page ~30 ms server-side, ~155 ms to `load` in the browser |
| Quick AI check (6) on Sonnet (7) | match-lite | **~10-25 s** ✅ |
| Quick AI check (6) on Opus | match-lite | ~20-40 s ✅ (borderline) |
| Full analysis, Sonnet, P0 ordering | match | ~30-70 s (close; suggestions arrive with it) |
| Full analysis, Opus, P0 ordering | match | ~60-160 s — becomes the explicit "thorough" tier |

The 30-40 s promise is kept by making **quick check the default reaction**
to "new resume/version" and full analysis an explicit, honestly-labeled
upgrade — not by making Opus emit 4 000 tokens faster.

**Measured 2026-09-02** (block 4, `claude_code` CLI engine, the five gold
fixtures, `npm run bench:resume -- --model <id> --mode <fast|full>`; "before"
is prompt v5, "after" is v6 with the tiered budget):

| Run | p50 | Suite total | Reply chars | Checks failed | Status agreement vs Opus full v6 |
| --- | --- | --- | --- | --- | --- |
| Opus, full, v5 (before) | 22 s | 136 s | 4899 | 0 | — (baseline of the v5 pair) |
| Sonnet, full, v5 (before) | 40 s | 231 s | 3261 | 0 | 95% vs Opus v5, 74% term overlap |
| **Opus, quick check, v6** | **15 s** | **77 s** | **2591** | 0 | 98% (45/46), 88% term overlap |
| Opus, full, v6 | 24 s | 116 s | 4373 | 0 | 100% (52/52) |
| Sonnet, quick check, v6 | 26 s | 161 s | 2126 | 0 | 93% (37/40), 77% term overlap |
| Sonnet, full, v6 | 52 s | 252 s | 3099 | 0 | 95% (38/40), 77% term overlap |

Every one of the four v6 runs passed every gold check (stack mismatch capped
at 30, matching stack ≥75 uncapped, injection ≤45, tailored ≥85 with ≤4
actions, re-run overlap ≥70%), and the quick check passed the added
"returns no actions" check.

Two corrections to the estimates above. **The quick check on Opus is ~15 s on
the fixtures, not 20-40** — the row above was pessimistic for short postings;
on the real posting of job #1393 (4 988 chars, 5 908-char resume, 26 keywords)
it took **40 s**, so 15-40 s is the honest band and the 30-40 s target is met
without changing models. **Sonnet is not the fast lane** on this engine: it was
*slower* than Opus on every full fixture, so the "Quick AI check on Sonnet" row
is not the recommended path — see §8 question 1.

Live on job #1393 (Docker, Opus, a 4 988-character posting, 5 908-character
resume, 26 keywords), all three runs on prompt v6:

| Run | Wall time | Reply chars | Score |
| --- | --- | --- | --- |
| quick check | 39.5 s (a repeat: 40.8 s) | 6 003 | 66 |
| "Get suggestions" on that row | 35.2 s | 6 917 | unchanged (10 actions, 8 removals) |
| full analysis, same pair | 77.1 s | 13 577 | 68 |

The quick check reproduced **66** — the identical number the v5 full analysis
gave for this resume. Both calls together (74.7 s) still land under the 78-109 s
a single v5 full analysis cost, and the score is on screen after the first.

---

## 4. Keyword highlighting audit — why important words are missed

How it works today: the AI emits ≤~25 verbatim keywords with aliases;
[target.mjs](../src/web/public/target.mjs) `findTerm` does literal
whole-token search (lowercase, whitespace-flexible inside a term,
lookarounds so "C" ≠ "C++", "Java" ≠ "JavaScript"); `jobSpans` /
`resumeSpans` paint every occurrence. **Anything not in the keyword list, or
spelled differently than the list says, is invisible.** Failure modes, most
frequent first:

- **F1 — the list is capped, so terms drop out entirely.** `MATCH_SYSTEM`
  says "at most ~25 keywords" (schema allows 80) and NOISE rules skip whole
  sections. A posting with 30+ real terms loses the tail — usually
  `nice`/`context` items like a secondary tool — and the JD pane shows an
  obviously-technical word with no mark, which reads as a bug.
  *Fix:* tiered budget in the prompt — **every** `must` and `preferred`
  term always listed, the ~25 soft cap applies only to `nice`/`context`;
  plus F8 as the safety net.
- **F2 — non-verbatim terms render nowhere.** The VERBATIM rule lives only
  in the prompt; when the model paraphrases ("REST APIs" for a posting that
  says "RESTful services"), `findTerm` finds 0 spans in the posting — row in
  the table, nothing highlighted. *Fix (deterministic, persist-time):* run
  `findTerm(term+aliases, posting)` in `match.ts` after parsing; on 0 hits
  try to anchor (locate the closest verbatim span, à la `locateQuote`) and
  repair the term, else mark the row `unanchored` and log it — that log is
  the regression metric for every future `PROMPT_VERSION` bump.
- **F3 — aliases depend on the model remembering them.** The prompt begs
  for resume-side spellings; when it forgets one, a present skill shows as
  missing (the in-code comment admits this). *Fix:* a deterministic synonym
  table in a pure module (`src/resume/keyword-aliases.ts`), unioned into
  every keyword at persist time next to `applyFacts`: node/node.js/nodejs,
  go/golang, postgres/postgresql, js/javascript, ts/typescript,
  k8s/kubernetes, react/react.js/reactjs, next.js/nextjs, vue/vue.js/vuejs,
  express/express.js, .net/dotnet, aws/amazon web services, gcp/google
  cloud, ci/cd ↔ continuous integration/delivery, docker-compose/docker
  compose, oop, tdd… (~100-200 curated pairs, tested). Bonus: the prompt can
  then ask for *fewer* model-emitted aliases → fewer output tokens (§3
  win from the same change).
- **F4 — zero morphology.** "microservice" ≠ "microservices", "API" ≠
  "APIs". *Fix:* plural tolerance only — optional `(?:e?s)?` suffix in
  `termPattern` for letter-ending terms ≥4 chars. No stemming beyond that
  (false-positive risk); irregular pairs go into the F3 table.
- **F5 — separator variants.** "CI/CD" ≠ "CI / CD" ≠ "CI-CD";
  "front-end" ≠ "front end" ≠ "frontend"; "Node.js" ≠ "NodeJS". *Fix:* in
  `termPattern`, make separators between alphanumeric tokens of a
  multi-token term interchangeable (`[\s/.\-]*`), with table-driven tests
  enumerating each pair (target.mjs is the single implementation — browser
  and node:test share it, nothing to mirror).
- **F6 — granularity mismatch.** Model says "Node", posting says "Node.js":
  the `(?!\.\w)` lookahead (correctly) refuses the partial hit, and with no
  alias the term highlights nowhere. Covered by the F3 table in both
  directions.
- **F7 — a bad frame is sticky.** CONSISTENCY ACROSS RUNS + `previousKeywords`
  deliberately freeze the term list per posting, so a term missed on run 1
  stays missed on every later run. *Fix:* a "Rebuild keywords" action that
  skips `previousKeywords` once, and an automatic skip when the stored
  frame's `PROMPT_VERSION` is older than current.
  **Shipped 2026-09-02** (issue #79, PR #84): the decision is a pure function
  (`keyword-frame.ts:planKeywordFrame`) of the stored frame's prompt version
  and one request flag, and its reason is stored in the `breakdown` JSON so a
  rebuilt row can say why its score stands alone. Measured live on job #1393
  (5 k-char posting, resume 5, quick check on the CLI engine): the carried run
  cost **42.2 s and listed the same 26 terms the frame has carried since
  prompt v5** (5 analyses deep — matches #55…#59), the rebuild cost **41.8 s
  and listed 30**: 23 shared, 3 dropped, **7 new — BullMQ, GCP PubSub, AI
  tools, observability tools, performance monitoring, CI/CD, Microservices**.
  All seven are literally in the posting, so five consecutive runs had been
  reproducing a list that was missing two named technologies the job asks for;
  `unanchored` stayed 0, so nothing new was invented either. Score 67 → 64 —
  which is the point of the "not comparable" line on the card, not a
  regression. A rebuild costs exactly one normal call: it is the same request
  minus one prompt block.
- **F8 (optional safety net) — deterministic lexicon sweep.** A pure module
  with a few hundred known tech terms scans the posting for anything absent
  from the AI list and shows them as neutral **unrated** marks (never
  scored) with one-click "count this keyword" (feeds §5 overrides). This
  makes "an important word was skipped" structurally impossible for known
  tech vocabulary; the cost is curating the lexicon.

Minor/by-design, to document rather than fix: overlapping spans keep the
earlier-starting mark (cosmetic); benefits/EEO/marketing text is *deliberately*
never keyworded (NOISE rule) — worth one line in the pane legend so it stops
looking like a miss.

**Measured 2026-09-02** (block 2, `npm run keywords:audit` over the 15 stored
comparisons — the same `findTerm` the panes use, no AI call):

| Rows | Before | After F3–F5 |
| --- | --- | --- |
| keyword rows with no highlight in the posting (of 305) | 54 (9 title-only) | 53 |
| `present` rows with no highlight in the resume (of 181) | 36 | 35 |

Every remaining miss comes from the seven analyses written before the
VERBATIM rule (prompt v5): slash-joined paraphrases such as "Mentoring / team
lead" or "startup / fast-paced environment" that no matcher can place. On the
current prompt no stored row misses the posting, so F2 acts as the safety net
and the metric (`anchored` / `unanchored` on the `resume: matched` line), not
as a repair of today's output. F1 moved to `match-fast-mode` (block 4) — it is
a prompt change; F7 shipped as `keyword-frame-rebuild` (above); F8 stays open
(§8).

## 5. Keyword priorities — present vs missing

Already there: `priority` 1-4, `requirement` must/preferred/nice/context
with deterministic weights 3/2/1/0, `primary` flag + score cap, chips sorted
by priority, KeywordTable problems-first sorted hardest-requirement-first.

Worth adding (all deterministic, no AI):

- **User overrides per keyword** — the actual "виставляти пріоритет вручну":
  re-level requirement (must ↔ preferred ↔ nice ↔ context), exclude a term
  as noise, add an own term. Stored in the match's `keywords` JSON, score
  recomputed via the existing `updateMatchScoring` path (same machinery as
  ask_user fact flips — instant, free). Overrides carried into the next
  run's `previousKeywords` so they stick per posting.
- **Visual weight in the panes.** Today a missing `must`/`primary` term and
  a missing `nice` term get the same yellow. Encode weight: stronger
  border/intensity for must+primary, muted for nice/context; legend update.
- **Frequency as a tiebreaker.** Count each term's occurrences in the
  posting (`findTerm` already returns spans) — sort equal-weight keywords by
  it and show "×4 in the posting" in the tooltip. Matches the
  "mentioned-multiple-times matters" practice at zero AI cost.

**Shipped 2026-09-02** (block 5, PR #83). All three, all deterministic:

- Overrides live in the comparison's own `keywords` JSON as an `override`
  object beside the model's verdict (`src/resume/keyword-overrides.ts`, pure),
  so nothing is overwritten and "reset" always has somewhere to go back to.
  `effectiveKeywords()` — the user's levels, minus the rows they ignored — is
  what the score, the panes and the live editor read; **`score.ts` did not
  change**, an override is a different input, not a different formula. No
  schema change and no ADR: the JSON absorbed it, exactly as the mode marker
  did (ADR 0029).
- The write path is `POST /jobs/:id/matches/:matchId/keywords` →
  `updateMatchScoring`, the same free path a confirmed fact takes. **Measured
  live on job #1393 (match #59): 2–15 ms per edit, zero `resume:` lines in the
  web log** — must → nice 66 → 67, ignoring a `cannot_claim` nice 67 → 68,
  adding a term the resume already had 68 → 68, adding one it lacked 68 → 67,
  and five resets back to exactly 66. An added term's status is read from the
  resume text (present) or asked (ask_user); one the posting does not contain
  is flagged `unanchored`, the same badge a model paraphrase gets.
- Carrying works: a forced re-run of the quick check on the same posting
  logged `overrides: 3, readded: 1` in 50 s — two re-levelled/ignored rows and
  one hand-added term the model had adopted came back on its fresh reply, and
  the one it did not repeat was put back with its status re-read against the
  current resume. A carried level is kept even when that reply agrees: an
  override exists precisely so the level stops depending on the next one.
  `override` is stripped from every reply on the way in — the field is the
  user's, and a posting cannot talk the model into dropping a must-have.
- Weight and frequency come from `keywordRank()` / `orderKeywords()` in
  `target.mjs` — the module the panes, the chips and the server-rendered table
  all share, so there is nothing to mirror. Marks are graded `kw-w0`…`kw-w4`
  (a primary-stack must), the legend shows three of the tiers, and a tooltip
  reads `system scalability · nice · missing · ×5 in the posting`.

## 6. Best-practice cross-check

Current guidance (Jobscan, uppl.ai, PassTheScan, TailorCV, ResumeAdapter,
2026 editions) vs this codebase:

| Practice | Status here |
| --- | --- |
| Mirror the posting's exact wording (ATS exact-match reality) | ✅ VERBATIM rule + literal matcher — enforce it deterministically (F2) |
| 15-25 targeted keywords, not exhaustive stuffing | ✅ cap exists — tier it so `must`/`preferred` never fall off (F1) |
| Must-have vs nice-to-have weighting | ✅ requirement weights 3/2/1/0 (ADR 0012) |
| Placement/evidence weighting (summary, title, recent role > skills list) | ✅ alignment grades carry 40 pts; `where` per keyword |
| Synonym/semantic tolerance (Workday/Greenhouse-class ATS now match variants) | ⚠️ model-dependent aliases → make deterministic (F3-F5); embedding-based semantic matching noted as a possible future tier, **out of scope** now |
| No invented experience / no stuffing advice | ✅ NO TREADMILL + cannot_claim + fact gate |
| Frequency of a term signals importance | ❌ cheap add (§5) |

Verdict: the architecture already matches best practice; the deltas are
**determinism** (aliases, morphology, verbatim enforcement) and **user
control** (priority overrides) — not a redesign.

Sources: [jobscan.co](https://www.jobscan.co/blog/top-resume-keywords-boost-resume/),
[uppl.ai](https://www.uppl.ai/ats-resume-keywords),
[passthescan.com](https://www.passthescan.com/blog/ats-resume-keywords-2026-complete-guide),
[thetailorcv.com](https://thetailorcv.com/blog/resume-matching-with-job-description-complete-guide),
[resumeadapter.com](https://www.resumeadapter.com/blog/ats-keywords-list).

## 7. Implementation order (one branch = one PR each, per commit-discipline)

1. `target-speed-p0` — §3.1 items 1-4 + §2.3 timing logs. No schema, no
   prompt bump. Verification: measured before/after ms per scenario, run
   page screenshots.
2. `keyword-matcher-v2` — F2 verbatim guard + F3 alias module + F4/F5
   pattern tolerance + tests (table-driven pairs in `target.test.ts`,
   alias-module unit tests). Pure-module work; `PROMPT_VERSION` untouched
   (post-processing). **Shipped 2026-09-02** (PR #80, numbers in §4).
3. `target-instant-check` — §3.2 item 5 (parse-only reupload → dirty draft
   in the editor). UX copy honest about "estimate vs frame". **Shipped
   2026-09-02** (PR #81, numbers in §3.4; §8 question 2 decided: the check is the
   default, the AI never auto-runs, the full run stays an explicit button).
4. `match-fast-mode` — §3.2 items 6-7: keywords-only prompt variant +
   `bench:resume` Sonnet-vs-Opus numbers + default/model-select decision,
   plus the F1 tiered keyword budget (same prompt, same bump).
   `PROMPT_VERSION` bump; gotcha-11 guard tests extended to the short
   prompt. Possibly an ADR (second match mode). **Shipped 2026-09-02**
   (PR #82, [ADR 0029](./adr/0029-quick-check-and-lazy-suggestions.md),
   numbers in §3.4). The suggestions became a lazy second call rather than
   a lost feature, the mode marker rides in the `breakdown` JSON (no schema
   change) and the model default did not move — §8 question 1 is answered
   below.
5. `keyword-priority-ui` — §5 overrides + visual weight + frequency. Reuses
   `updateMatchScoring`; ADR only if overrides outgrow the keywords JSON.
   **Shipped 2026-09-02** (PR #83, numbers in §5). The JSON absorbed them, so
   no ADR and no schema change; `PROMPT_VERSION` untouched — this is
   post-processing. `score.ts` untouched too, so the score.mjs parity test
   stayed green without a mirrored edit.
6. ~~(only if measurements demand) `match-split-frame` — §3.3 item 8 + ADR.~~
   **Not needed — closed 2026-09-02 by the numbers.** The condition was
   "only if measurements demand"; the owner's band is 30-40 s. Where the quick
   check lands after block 4: **p50 15 s** on the gold fixtures (24 s full,
   77 s vs 116 s for the suite) and **40 s / 42.2 s / 41.8 s** on job #1393,
   whose 5 k-char description is at the long end of what we store. So the band
   is met on short postings and missed by ~2 s on a long one. Splitting the
   frame would buy the difference by caching the term list per job and asking
   the model for statuses only — the same saving the fast prompt already
   made (**2591 vs 4373 reply characters**), for a second prompt variant, an
   ADR, and a cached frame to invalidate on every posting edit. Against that:
   block 3 already answers the as-you-type case with **no call at all**
   (0-15 ms), and F7 above exists precisely because a frozen frame goes stale
   — a cache would freeze it harder. Reopen only if a measured compare goes
   back over ~60 s.
7. `keyword-frame-rebuild` — §4 F7 (issue #79): "Rebuild keywords" runs once
   without `previousKeywords`, and a frame written by another `PROMPT_VERSION`
   is never inherited. Pure decision module, no schema change, no prompt
   change, `PROMPT_VERSION` untouched. **Shipped 2026-09-02** (PR #84, numbers
   in §4 F7).

## 8. Open questions for the owner

- ~~After the bench: flip the resume-role default to Sonnet, or keep Opus and
  surface a "fast/thorough" choice per compare?~~ Decided 2026-09-02 (block 4)
  **by the numbers, not by taste**: keep Opus, surface the fast/thorough
  choice. The §3.2 item 7 condition was "the same checks pass and statuses
  agree ≥~85% at 2-3× the speed". Statuses agreed (95%), but Sonnet was
  **slower than Opus on every full fixture** on the `claude_code` engine
  (p50 40 s vs 22 s) and its keyword frame drifted more (74% term overlap
  against Opus, where the fast Opus run keeps 88%) — an unstable frame is
  exactly what CONSISTENCY ACROSS RUNS exists to prevent. So
  `CLAUDE_MODEL_RESUME` stays `claude-opus-5`, the per-engine "Resume model"
  select on `/settings` is documented as the speed dial for anyone whose
  engine says otherwise, and the speed comes from the shorter prompt
  instead.
- ~~Should reupload land on the instant check by default (AI never auto-runs),
  or instant check + full analysis auto-started in the background?~~ Decided
  2026-09-02 (block 3): instant check by default, nothing auto-runs — every
  auto-started analysis is 78–109 s of Opus on the CLI engine and the memo
  only saves repeats. The background variant stays a separate branch if
  ever wanted.
- Is the F8 curated lexicon worth its maintenance, or are F1-F7 enough?
