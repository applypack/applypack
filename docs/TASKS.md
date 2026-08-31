# Claude Code task plan

> Living backlog for Claude Code sessions. Each block is one logical unit of
> work = one or a few commits. Follow the git rules in [CLAUDE.md](../CLAUDE.md)
> ("Git & commits") for every step. Tick items off as they land.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## 0. Process rules (done in CLAUDE.md — 2026-08-27)

- [x] No `Co-Authored-By` trailer. Commits, PRs and MRs are authored by the
  repo owner only.
- [x] Pre-commit review: is every changed line needed? Can it be simplified /
  refactored / deleted? Run `npm run lint:types && npm test` first.
- [x] Commit often, but per logical block. Short subject, short body
  ("added X", "fixed Y", "updated Z") — no essays.

---

## 1. AI provider: subscription-friendly classifier (analysis done, not built)

**Current state.** Two call sites, both `client.messages.create` on
`claude-haiku-4-5-20251001` with a cached system prompt:
`src/classifier.ts` (full classification, 600 tokens) and
`src/classifier-prefilter.ts` (stage-1 yes/no, 100 tokens).
`ANTHROPIC_API_KEY` is required in `src/config.ts`, so the worker cannot boot
without it. This is the pay-per-token Messages API.

**Finding.** A claude.ai Pro/Max subscription cannot be used through
`@anthropic-ai/sdk` — the SDK only accepts API keys / Console OAuth, and both
bill as API usage. The only surface where the subscription is valid
programmatically is Claude Code itself (`claude -p` headless mode). Using it as
a 24/7 backend is a grey area in Anthropic's consumer terms — **verify before
enabling by default**. The Claude Agent SDK is *not* a workaround (documented
as API-key only).

### 1.1 Provider abstraction
- [x] `src/ai-provider.ts`: `interface AiProvider { complete(system, user, maxTokens): Promise<string> }`
- [x] `AnthropicApiProvider` — move the two `messages.create` bodies here
  (keep `cache_control`, retry on 429).
- [x] `classifier.ts` / `classifier-prefilter.ts` become pure prompt-builders +
  zod parsers that call the provider. Extract `buildUserText` into a testable
  pure function.
- [x] `config.ts`: `AI_PROVIDER: z.enum(['anthropic_api','claude_code']).default('anthropic_api')`;
  `ANTHROPIC_API_KEY` becomes optional, validated as required only when
  `AI_PROVIDER=anthropic_api`.
- [x] Optional: expose the choice as an `AppSettings` toggle on `/settings`
  (schema → settings.ts → settings.tsx → routes/settings.tsx) so it is
  switchable at runtime. Worker reads it per tick (gotcha 9). Done
  2026-08-29 as the "AI engine" card — provider + both models, with a
  `gemini_cli` backend (ADR 0013), branch `ai-engine-settings`.

### 1.2 `claude_code` provider (subscription)
- [x] `ClaudeCodeProvider`: `execFile('claude', ['-p', prompt, '--output-format', 'json', '--model', 'haiku'])`
  with 60 s timeout; parse `result` field, hand to existing `extractJson`.
- [x] Rate-limit handling: rate-limited → `classifyFailed` for the tick; the
  job is not persisted so the next tick picks it up again.
- [x] Docker: install `@anthropic-ai/claude-code` in the runtime stage, mount
  `~/.claude` (credentials) as a read-only volume. Document token refresh
  caveat in README.
- [x] Unit test for the CLI-output parser (pure).

### 1.3 Concurrency (done 2026-08-27, PR "parallel-classifier")
- [x] `AI_CONCURRENCY` (default 3, 1–8) in `config.ts`; pure
  `src/concurrency.ts:createLimiter` + unit test.
- [x] `process-jobs.ts`: filter + dedupe first (with in-batch dedupe),
  classify through the limiter, persist + alert in original order.
- [x] `reclassify-job.ts`: same per batch of 50. `classifyJob` never
  rejects (queued promises would otherwise crash on unhandled rejection).
- [x] Verified in Docker with `claude_code`: 3 CLI processes in `ps`,
  web container ~460 MB, per-call latency unchanged (bench: 16 s serial,
  11–14 s each with 3 in flight) → throughput ×3.

### 1.4 Cheaper API path (no grey zone — do this regardless)
- [ ] Batch API mode for `AnthropicApiProvider` (−50 % on tokens). Deferred:
  `process-jobs.ts` classifies one job at a time inside the persist loop, so
  batching needs a collect → submit → poll → persist restructure. Do it as its
  own phase once the provider seam has settled.
- [ ] Default `classifierMode` to `two_stage` in seed (−30–40 %).
- [ ] Tighten `passesBaseFilter` so fewer jobs reach Claude at all.

---

## 2. Design overhaul with UI/UX skills

The dashboard (`src/web/`, ~3.9k lines of Hono JSX + inline CSS in
`layout.tsx` / `ui.tsx`) has no design system. Three candidate skills were
reviewed:

| Skill | What it gives | Verdict |
| --- | --- | --- |
| [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT) | Generates a design system (palette, typography, component rules) per project type; 22 stacks incl. plain HTML/CSS. Needs Python 3 for its search scripts. | **Install.** Use it once to produce `design-system/` for this project, then build against it. |
| [impeccable](https://github.com/pbakaus/impeccable) (Apache-2.0) | 23 commands (`init`, `craft`, `critique`, `audit`, `polish`…) + 59 deterministic anti-slop detectors, no API calls. Creates `PRODUCT.md` + `DESIGN.md`. | **Install.** Complements the above: pro-max defines the system, impeccable enforces it during iteration (`/impeccable audit`, `/impeccable polish`). |
| [marketingskills](https://github.com/coreyhaines31/marketingskills) (MIT) | 60+ marketing skills (CRO, SEO, ads, email…). | **Partial.** Product is a single-user internal tool — SEO/ads/CRO are irrelevant. Only `copywriting` (UI microcopy, empty states, Telegram message wording) and `cold-email` (outreach templates for tracked companies — future feature) are useful. Install the whole pack (it is only prompts) but ignore the rest. |

### 2.1 Install skills (project-scoped, committed)
- [x] ui-ux-pro-max copied from portfolio-ui (§4.1). Python 3 confirmed on PATH.
- [x] `npx impeccable install` (project scope; Copilot artefacts under
  `.github/` removed). `impeccable detect src/web` → 0 anti-patterns after
  fixing the funnel column accent. `/impeccable init` still to run in chat
  (writes PRODUCT.md / DESIGN.md). and review the
  generated `PRODUCT.md` / `DESIGN.md` (audience: one developer hunting jobs;
  dense data tables; dark-mode friendly; no marketing tone).
- [x] marketingskills: copied `copywriting`, `copy-editing`, `cold-email` only
  (evals stripped); the other 57 are marketing-site skills we don't need.
- [x] `.claude/skills/**` committed; `.gitignore` covers `__pycache__`, caches.

### 2.2 Design system
- [x] ui-ux-pro-max recommendation (dark OLED, Fira Sans / Fira Code, status
  colours) — applied directly; no `design-system/` folder needed.
- [x] Tokens as CSS vars in `src/web/layout.tsx`, exposed to Tailwind via
  inline `tailwind.config` (dark-only by design).
- [x] `src/web/ui.tsx`: PageHeader, Flash, Card, Table/Tr/Td, Field/Input/
  Select/Textarea/Checkbox/Radio, Button, ActionForm, ToggleRow, Badge,
  FitBadge (number + 4-step meter). Pages contain no palette classes.

### 2.3 Page-by-page pass (one commit per page)
- [x] `overview.tsx` — stat tiles + recent jobs
- [x] `jobs-list.tsx` — table density, filters, fit-score badge scale
- [x] `job-detail.tsx` — application tracking card, red flags
- [x] `applications.tsx`, `companies.tsx`, `discovery.tsx`, `runs.tsx`,
  `settings.tsx`
- [ ] After each page: `/impeccable audit` → fix → `/impeccable polish`.
- [~] Microcopy pass (done inline: settings hints, empty states) — `copywriting`: empty states, button labels, settings
  help text, Telegram alert wording in `notifier.ts` (keep MarkdownV2 escape).

### 2.4 Verify
- [x] `lint:types` + `npm test` green; web container rebuilt; all 7 pages 200;
  screenshots at 1200px + 375px, no console errors (CSP now allows Google Fonts).

---

## 3. Housekeeping candidates (pick up when convenient)
- [x] `@anthropic-ai/sdk` bumped `^0.39.0` → `^0.121.0`; tests + live smoke OK.
- [x] Model id → `CLAUDE_MODEL` env in `config.ts`.
- [ ] `CronRun` rows stay `RUNNING` forever when a container restarts
  mid-run (seen for `fetch` and `reclassify-all`). On boot, mark stale
  `RUNNING` rows as `FAILED` with `errorMessage='interrupted'`; the web
  `reclassifyInFlight` flag resets anyway.

---

## 4. Reuse skills from other `~/main` projects (inventory 2026-08-27)

Scanned every `.claude/skills`, `.claude/agents`, `.claude/commands`, hooks and
settings under `~/main`. ~80 skills across 9 projects; most are domain-bound
(GOOD DOG game, Museum of Comfort, Go/commercebase, Next.js portfolio, article
pipeline) and useless here. What transfers:

### 4.1 Copy as-is (project-agnostic, proven)
| Source | Skill / file | Why here |
| --- | --- | --- |
| `still-warm` | `.claude/skills/commit-discipline/` | Exact match for the new "Git & commits" rule: 2–5-word verb-first messages, no co-author, pre-commit gate with diff re-read. Copy, drop the museum examples, replace with `add batch classifier`, `fix remoteok meta row`. Then shorten the CLAUDE.md section to a pointer. |
| `still-warm` / `good-dog` | `.claude/settings.json` → `"includeCoAuthoredBy": false` | The real switch that stops the trailer. **Added now.** |
| `good-dog` | `.claude/hooks/commit-guard.sh` + `PreToolUse` hook | Blocks a `git commit` < 120 s after the previous one — enforces "not every minute". Copy verbatim. |
| `commercebase.io` | `code-review-expert/` (+ `references/solid-checklist.md`) | P0–P3 review of the current diff. Fits the "review before commit" rule. Trim Go-specific bits. |
| `commercebase.io` | `requesting-code-review/` | ~~Checklist before merging~~ — skipped: hard dependency on the `superpowers` plugin; `code-review-expert` covers it. |
| `portfolio-ui` | `ui-ux-pro-max/` (703 lines, already installed there) | Same skill as §2.1 — copy the directory instead of re-installing via marketplace. Needs Python 3. |
| `portfolio-ui` | `design-system/` | Three-layer tokens (primitive→semantic→component) as CSS variables — exactly what §2.2 needs for `layout.tsx`. |
| `portfolio-ui` | `stop-slop/` | Strip AI-tells from UI copy, README, Telegram messages. Small (68 lines). |

### 4.2 Adapt (good pattern, wrong domain)
| Source | Skill | Adaptation |
| --- | --- | --- |
| `still-warm` | `testing-gate/` | "Required tests per change type" table → rewrite for this repo: pure mapper → `*.test.ts`; fetcher → smoke `fetch-once`; schema → hand-written migration (gotcha 7); UI → screenshot. |
| `still-warm` | `ui-review/` | Design critique that outputs findings, never code. Use after each §2.3 page. Remove museum references. |
| `still-warm` | `accessible-interactions/` | Keyboard/focus/ARIA rules — tables and forms in the dashboard have none. Keep the rules, drop the animation parts. |
| `tancker` | `adr-writer/` | MADR template + supersede mechanics. We already have `docs/adr/0001–0005`; adopt the template for the AI-provider decision (§1). Drop the Tancker FR/C register. |
| `tancker` | `spec-guardian/` | "Map task → spec section, refuse scope drift". Map to SPEC.md / ARCHITECTURE.md instead of FR numbers. |
| `commercebase.io` | `project-manager/` | Works on `docs/tasks/`; point it at this `docs/TASKS.md` (pick next task, mark done). |

### 4.3 Product ideas (not tooling) — from job-search projects
| Source | What | Fit for job-hunter |
| --- | --- | --- |
| `linkedin-radar` | `job-apply/` skill + `agents/job-verifier.md` (ghost-job / scam checklist, LEGIT / SUSPICIOUS / FAKE verdict) | Strong. Wire the verifier checklist into `/jobs/:id`: a "Verify" action that runs the careers-page cross-check and stores a verdict column. The tailoring half (master resumes → .docx/.pdf) can stay a CLI skill but read jobs from this DB. |

### 4.4 Skip
`golang-*`, `go-coder`, `adapter-builder`, `stage-builder`, `api-and-schema`,
`ui-system` (closed 10-primitive inventory for Tancker), `museum-experience`,
`wow-review`, all `good-dog/*` content skills, `portfolio-component-creator`,
`theme-factory`, `scss-design-system`, `gsap-*`, `algorithmic-art`,
`canvas-design`, `web-artifacts-builder`, `devto*/medium*/linkedin-*`,
`article-pipeline`, `brand`, `design` (logo/Gemini), `ui-styling`
(shadcn/Tailwind — we have no Tailwind), `multi-agent-patterns`,
`context-compression`, `tool-design`, `memory-systems`, `humanizer` (prose;
`stop-slop` covers our need), `skill-creator` (use only if we author a skill).

Global plugins already on: `frontend-design`, `playwright`,
`diagram-animator` (own marketplace `nazboyko/claude-skills`).

### 4.5 Steps
- [x] `.claude/settings.json` with `includeCoAuthoredBy: false`
- [x] Copy `commit-discipline`, `commit-guard.sh` + hook, `code-review-expert`,
  `stop-slop`, `design-system`, `ui-ux-pro-max` into `.claude/`.
- [x] Adapted `testing-gate`, `ui-review`, `accessible-interactions`,
  `adr-writer` for this repo (`.claude/skills/`).
- [x] ADR 0007 "AI provider seam" (docs/adr/0007-ai-provider-seam.md).
- [x] Product: verifier checklist → `JobVerification` + UI action (§5.5).
- [ ] Repost / liveness / follow-up cadence as separate backlog items.

---

## 5. Resume module (phase 8 — started 2026-08-28, branch `resume-match`)

Source: the `job-apply` skill in `~/main/linkedin-radar` (rulebooks +
Python docx scripts). Decision record: [ADR 0008](./adr/0008-resume-module-in-web.md).

- [x] 5.1 Storage + upload: `Resume` model, `src/resume/{zip,docx-text,resume-text}.ts`
  (+tests), `/resumes`, `/resumes/:id`, upload card on `/settings`.
- [x] 5.2 AI scan on upload: headline, seniority, years, skills, role types,
  job-agnostic issues (`src/resume/scan.ts`, `prompts.ts:SCAN_SYSTEM`).
- [x] 5.3 Job ↔ resume comparison: `ResumeMatch` model, `POST /jobs/:id/match`,
  "Resume match" card on `/jobs/:id` — score, strengths, red flags, actions
  (section / where / what / why / priority), keyword coverage
  (present / add / can't claim). Auto-picks the resume by skill overlap
  (`src/resume/pick.ts`).
- [x] 5.4 Manual jobs: `/jobs/new` pastes a posting → `AtsType.MANUAL` company
  (inactive) + `Job` (status SAVED, classified with `keepStatus`).
  `src/jobs/classify-existing.ts` is shared with the per-job Re-classify button.
- [x] 5.5 Ghost-job verification: `JobVerification` model, `src/verification/`
  (checklist prompt + zod, web tools via `AiRequest.webTools`), "Is this job
  real?" card on `/jobs/:id`. ADR 0009.
- [x] 5.6 Iteration loop: `Resume.version` + "Upload a new version" on
  `/resumes/:id`; `ResumeMatch.resumeVersion`; the match card shows the score
  delta vs the previous run of the same resume. Fixed scoring rubric in the
  prompt so runs are comparable.
- [x] 5.7 "What to remove": `ResumeMatch.removals` + section in the match card;
  the match prompt now centres actions on title / summary / most recent role
  (what recruiters actually read).
- [x] 5.8 Targeted view (`/jobs/:id/target`): side-by-side highlights, in-place
  editing, live keyword coverage (`src/web/public/target.mjs`), AI re-analysis
  of the draft (`ResumeMatch.draft`, `resumeText` snapshot), "Save as vN" (text
  version), one-click re-upload + compare. ADR 0010.
- [ ] 5.14 Profile from resumes: propose `stackRequired` (core) /
  `stackNiceToHave` (rest) / roleTypes / seniority from scanned resumes,
  preview diff, "Merge into active profile" + "Create profile per resume".
- [ ] 5.15 Tailored `resume.md` generated by AI (the targeted view now covers
  the manual path): apply the actions under the ats-rules scope
  (title, summary, skills, top-2 roles, max 4 bullets) → diff + download.
- [ ] 5.10 `.docx` export: port `patch_resume_docx`, `check_text_hygiene`,
  `clean_docx_metadata` to TS (needs a zip *writer*; `fflate` or in-house).
- [ ] 5.11 PDF upload (`pdf-parse` or similar).
- [ ] 5.12 Async comparison / verification with a `CronRun` row when the sync
  request gets annoying (see ADR 0008 / 0009 consequences).
- [ ] 5.13 Verdict badge on `/jobs` list rows; "verified" filter.

---

## 6. UI/UX refactor — adopted from the two external audits (2026-08-29)

Sources: [archive/job-hunter-resume-match-ux-refactor.md](./archive/job-hunter-resume-match-ux-refactor.md)
and [archive/job-hunter-ui-ux-refactor-plan.md](./archive/job-hunter-ui-ux-refactor-plan.md); every
claim was verified against the code on `pdf-and-target` before adoption.

Already in place, no action needed: `ui.tsx` primitives, `layout.tsx` tokens (the
palette the docs propose IS the current one), violet = AI-cost semantic (DESIGN.md),
a11y base (skip link, focus-visible, tablist), deterministic score + ceiling +
CandidateFact instant re-score (ADR 0012), per-version history on `/resumes/:id`.

Rejected: semantic resume rendering (breaks "what the ATS sees", ADR 0011), new
`/jobs/:id/resume-match` routes, full `/settings/*` route split, priority-rules
visual builder (the DSL stays, power-user tool), Playwright/axe CI (testing
philosophy: units + smoke + screenshots), dark mode (deferred by DESIGN.md),
removing the violet accent.

### 6.1 Targeted page P0 (this branch — done 2026-08-29)
- [x] Summary first: hard-requirement digest inside the score card + ask_user
      confirms hoisted above the tabs (both were invisible behind the 4th tab)
- [x] History chips capped at 2 (user pref, was 5) + "older runs" disclosure
- [x] One primary score: live estimate hidden until the text is edited, labelled
      "Estimate after your edits", with a ±N delta vs the AI score
- [x] Sticky unsaved-changes bar (Discard / Re-analyze / Save as vN)
- [x] `active="jobs"` + Jobs / {job} / Resume match breadcrumb; h1 "Resume match"
- [x] Tab "Changes" → "Suggestions"
- [x] Version delta on the targeted page (previous was hard-coded `null`)

### 6.2 Targeted page P1 (done 2026-08-29)
- [x] One status vocabulary everywhere: matched / missing / confirm / no evidence
      (was three different sets across table, legend and tooltips)
- [x] Keyword table: needs-attention rows first (must → context), matched rows
      behind a disclosure
- [x] Matched-highlight toggle for both panes — default ON (user pref; audits
      suggested off, user overrode). Legend samples keep their colour
- [x] Suggestions pairs the advice column with the sticky editor; clicking a
      suggestion selects its text in place (no tab throw); live estimate
      mirrored in the sticky bar; "Your resume" tab dropped. Tab order ended
      as Side by side (default) → Suggestions → Job description (user pref)
- [x] Score card as a proportional grid (score | why | actions rail + live
      estimate), resume name deduped out of it, page capped at 1536px
- [x] /target: description-only input — empty company / title / location /
      salary are detected INSIDE the run as a visible "Detect posting facts"
      step (classifier model), so Compare never waits and never errors:
      unfound facts fall back to "Unknown company" / the first line; the run
      header renames live. Paste chrome is trimmed in the textarea
      (posting-clean.mjs keeps the job-header block)
- [x] Progress page: meta-refresh (and its "refreshes every 2 s" note) replaced
      by polled /target/runs/:id/state + target-run.mjs — step icons advance in
      place and a violet activity line rotates through the real prompt
      checklist every 9 s with a fade; terminal states reload into the redirect
- [x] Action row: Re-upload is the one visible button (user pref); Re-analyze
      and Save live in the ⋯ menu, resurfaced by the sticky bar while editing.
      Dropdown panels are in-flow on phones (an absolute panel overflowed 375px)
- [x] Meta reads "analyzed Nh ago"

### 6.3 Settings + shell (branch `ai-engine-settings`, done 2026-08-29)
- [x] AtsType display-name map (LARAJOBS_RSS → Laravel Jobs) on /settings + /discovery
      (`src/web/source-names.ts`, unit-tested)
- [x] Flash `warn` variant; the paused state stops using success green
- [x] `confirm()` on "Save & re-classify" (the sibling button already has one)
- [x] Copy pass: getMe+sendMessage / cron / Docker out of primary UI (keep the
      gotcha-10 aggregator explanation — now a hint under the sources pills)
- [x] De-duplicate: Settings resumes card → list + link (drop the second upload
      form); discovery toggles move to /discovery (routes moved too:
      POST /discovery/toggle, /discovery/hn-parser-toggle, /discovery/hn-run)
- [x] Section order General → Notifications → Advanced; flash texts match option labels
- [x] /settings/sources: stop re-adding MANUAL to disabledSources on every save
- [x] `maskToken` → last-4 only
- [x] AI provider selection UI (§1.1 leftover) extended to other AI subscriptions —
      "AI engine" card: anthropic_api / claude_code / gemini_cli radios with
      availability probe, classifier + resume model slots (ADR 0013)
- [x] Tabs on /settings (user request, later same day): link-based `?tab=`
      sub-nav — General (fetching, tracking, resumes) / Profile / AI engine
      (+classifier mode) / Notifications / Sources. Single route kept, every
      POST redirects back to its tab; the audit's full route split stays
      rejected
- [x] AI engine improvements P1–P2 integrated (2026-08-30): CLI child-process
      env allowlist (ANTHROPIC_API_KEY precedence trap), per-engine cooldown +
      chain deadline, "pay per token" badges + paid-fallback warn, cross-engine
      bench flags, `model · fallback` marker on match/verify, aiUsage counters
      (7-day summary on the AI tab, 60-day trim in cleanup), classifier prompt
      version stamp. Status ticks in docs/ai-engine-improvements.md
- [x] AI engine CHAIN (2026-08-30, ADR 0014):
      ordered multi-engine config in `AppSettings.aiEngine` (JSON), automatic
      per-call failover, + `openai_api` (base-URL compatible: OpenAI /
      OpenRouter / Groq / local) and `codex_cli` (ChatGPT subscription)
      backends, per-engine model dropdowns (no wrong-family saves), per-engine
      live Test buttons, setup guide docs/ai-engines.md (local + Docker)

### 6.4 Later (P2)
- [ ] Apply-suggestion buttons on action cards — do together with 5.15
- [ ] Linked compare: requirement ↔ evidence scrolling (`locateQuote` is half of it)
- [ ] "Ready to apply" state at ≥85 instead of endless optimization
- [ ] Section-heading emphasis inside the plain-text editor (keep the ATS honesty)
- [ ] Rename the Target nav item (both audits misread it — Compare / Match?)

### 6.5 Code health (found while verifying the audits)
- [x] TARGET_JS (~140 inline untestable lines in target.tsx) → served ES module
      (`src/web/public/target-page.mjs`, import-smoke-tested)
- [ ] `take` cap on listMatchesForJob / listMatchesForResume
- [ ] Screenshot checklist gains 768 × 1024 between the existing 375 / 1200

---

## 7. Feature expansion plan (2026-08-30)

Full plan with per-feature design, re-analysis checklists, test matrices and
release tags: [docs/feature-expansion-plan.md](./feature-expansion-plan.md).
Process: one feature = one branch = one annotated tag; mandatory
re-analysis + improvement pass before implementing; testing-gate before
every commit; independent implementation only — no code copied from any
external project, copy-check before merge.

- [x] F1 liveness ladder (free ATS-API checks before AI verify) — v0.3.0
      (branch `liveness-ladder`, ADR 0016; board-feed-vanish cleanup signal
      deferred to F4)
- [x] F2 fetchers wave 1 — v0.4.0 (branch `fetchers-wave-1`): Recruitee,
      Breezy, BambooHR, Pinpoint, Rippling + 4dayweek (via the
      robots-allowed `/api/v2`). NoDesk, JustJoin, NoFluffJobs rejected
      at re-analysis on robots grounds → ADR 0005 addendum. Salary
      decision: v1 folds salary into description text (F19 revisits)
- [x] F3 SimHash cross-source dedup + URL-key discipline — v0.6.0
      (branch `simhash-dedup`, ADR 0018): measuring the plan's constants on
      our 731 jobs moved the guard from 200 to 400 normalized chars (Jobicy
      teasers are byte-identical across different roles) and the threshold
      from Hamming 5 to 7 (9/9 cross-company matches genuine; first false
      positive at 10). The plan's "skip same-company matches" was dropped —
      27% of them are genuinely different roles. Annotation only; skipping
      the duplicate's paid classification stays deferred
- [x] F4 source health monitoring (quiet-source card) — v0.7.0
      (branch `source-health`, ADR 0019). Tag is v0.7.0, not the plan's
      v0.6.0: numbers follow actual integration order and F3 took v0.6.0.
      Re-analysis on live data found two dead slugs already failing
      silently (`GREENHOUSE:pleo`, `LEVER:plaid`) and killed the plan's
      "empty is healthy" as a sufficient rule — SmartRecruiters returns
      200 + `totalFound:0` for every id including Bosch and IKEA, and 7 of
      10 vendors swallow a malformed payload into `[]`. So health carries
      two signals (failure streak + `lastOkAt` silence) and the vocabulary
      gained `rate_limit` and `bad_payload` (both observed live). Streak
      >= 3 kept: fetch is hourly and the transient-failure base rate across
      71 sources measured zero. ADR 0016's feed-vanish item: deferred
      again, gate written down (list-completeness assertion).
      Correction 2026-08-31: the two dead slugs are migrations, not
      shutdowns — Plaid now lives at `ASHBY:plaid` (101 open jobs,
      `<title>Plaid Jobs</title>`, offices SF/NYC/London/Seattle/Raleigh)
      and Pleo at `ASHBY:pleo` (37 jobs), both identity-verified live;
      company rows re-pointed by hand via /companies
- [ ] F5 status-transition ledger + funnel/calibration stats — v0.7.0
- [ ] F6 follow-up cadence with pin/retire/auto-seed in the stale digest — v0.8.0
- [x] F7 fact gate (anti-hallucination pure module) — no tag of its own
      (branch `fact-gate`, ADR 0020). Ships untagged with F8 per
      release-discipline's pure-module rule: no route, no column, no toggle,
      nothing a user can observe. Re-analysis on live data changed the
      design: all 4 confirmed `CandidateFact` rows are bare tool terms, so
      the metric side is sourced entirely from resume text and facts can only
      support a *tool* claim — while the 4 `denied` rows became a hard block
      the plan never proposed. The plan's headline `16,181` separator case has
      zero occurrences in our corpus; the 7 spelled-out numerals it never
      mentions do, so priority inverted. NFKC measured insufficient (it leaves
      `–`, `—`, `’` — the only non-ASCII we have). Zero Cyrillic in 3 resumes
      and 771 job descriptions, so "EN + UA" narrowed to: percent/currency
      script-agnostic, count nouns and history triggers EN-only, non-Latin
      sentences degrade `pass → warn`. Measured 0.75ms median on a 285-word
      letter vs the real 6004-char resume — the 50ms budget is 66x over
- [ ] F8 cover letter generation (job + company analysis, gated by F7) — v0.10.0
- [ ] F9 golden-eval harness for the AI engine chain — v0.11.0
- [ ] F10 fetchers wave 2: Getro/Consider/a16z, Arbeitsagentur, Teamtailor,
      Personio, Jobvite, Gem, join.com — v0.12.0
- [ ] F11 repost / ghost-job signal for classifier + verify — v0.13.0
- [ ] F12 untrusted-content fences in every prompt builder — v0.14.0
- [ ] F13 job trust score (flags, never drops) — v0.15.0
- [x] F14 company starter packs — v0.5.0 (branch `starter-packs`, ADR 0017):
      86 companies in 5 segments, each board identity-checked live.
      Re-analysis killed the name-guessing design: `GREENHOUSE:aha` is a
      vet practice, `GREENHOUSE:wise` is a field-sales firm, and Pinpoint
      serves one shared demo board to unconfigured tenants — so entries pin
      a verified (atsType, atsToken) and resolve needs >= 1 open job.
      Follow-ups: `probeAts` still accepts any SmartRecruiters token and
      cannot spot a Pinpoint demo board (both pre-existing, on /companies
      and /discovery)
- [ ] F15 fetch-run observability + filter reason codes — v0.17.0
- [ ] F16 application email drafts (rides on F8) — v0.18.0
- [ ] F17 reply classification: paste → classify → stage suggestion — v0.19.0
- [ ] F18 interview story bank + deterministic question matcher — v0.20.0
- [ ] F19 salary observations + gap analytics — v0.21.0
- [x] ADR 0005 addendum: "Evaluated, not supported" sources table
      (done with F2, 2026-08-31)
