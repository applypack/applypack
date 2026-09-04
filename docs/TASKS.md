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

### 1.4 Cheaper API path — CLOSED 2026-09-01, measured out of existence

Live `CronRun.stats` (fetch ticks, 2026-09-01): **fetched 5,494 →
filterRejected 5,182 (94.3%) → duplicate ~310 → classified 0–4 per tick**.
There is nothing left to make cheaper — the AI sees at most a handful of
jobs an hour, and the engine chain (ADR 0014) runs subscription CLIs at
zero marginal token cost anyway. All three issues closed with these
numbers; reopen only if the classified-per-tick count grows by two orders
of magnitude (a broader profile, many more sources).

- [x] ~~Batch API mode~~ — issue #22 closed won't-fix: −50% of ~4 calls/tick
  saves pennies; batch polling also doesn't fit the per-call
  `AiProvider.complete` seam the chain failover depends on.
- [x] ~~Default `classifierMode` to `two_stage` in seed~~ — issue #19 closed
  won't-fix: the −30–40% estimate presumed a fat stream; at 0–4 calls/tick
  the prefilter only adds a second failure surface. The toggle stays for
  users who want it.
- [x] ~~Tighten `passesBaseFilter`~~ — issue #20 closed as done-by-reality:
  94.3% rejection is the filter working; tightening the surviving trickle
  risks false negatives, not savings.

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
- [x] Superseded: the impeccable hook now audits every write (per-page manual runs obsolete).
- [x] Microcopy pass — done inline over 2026-08-29..31 (settings hints,
  empty states, F8.1 letter copy). Final sweep 2026-09-01: `notifier.ts`
  alert wording reviewed, no changes needed.

### 2.4 Verify
- [x] `lint:types` + `npm test` green; web container rebuilt; all 7 pages 200;
  screenshots at 1200px + 375px, no console errors (CSP now allows Google Fonts).

---

## 3. Housekeeping candidates (pick up when convenient)
- [x] `@anthropic-ai/sdk` bumped `^0.39.0` → `^0.121.0`; tests + live smoke OK.
- [x] Model id → `CLAUDE_MODEL` env in `config.ts`.
- [x] Issue #18: stale `RUNNING` `CronRun` rows → `FAILED` with
  `errorMessage='interrupted'` on worker boot — shipped in `src/init.ts`
  (issue closed; box unticked until 2026-09-01 audit).

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
| Source | What | Fit for ApplyPack |
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
- [x] Repost / liveness / follow-up cadence written up as F11 / F1 / F6 in §7.

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
- [x] 5.14 Profile from resumes — done 2026-08-29 as "Fill from a resume"
  (ADR 0015, `src/resume/profile-draft.ts`, branch `profile-from-resume`):
  scan → unsaved draft on the Profile tab, review before save. The
  multi-resume merge / per-resume-profile variants were not needed.
- [x] ~~5.15 Tailored `resume.md` generated by AI~~ — closed 2026-09-01:
  superseded by the shipped targeted view (5.8): manual edit + live score +
  AI re-analysis + Save as vN covers the loop, and auto-rewriting prose
  reopens the hallucination surface the fact gate (F7) exists to close.
  Reopen trigger: a real application round proves manual tailoring too slow.
- [x] ~~5.10 `.docx` export of the tailored resume~~ — closed 2026-09-01:
  a plaintext-to-.docx dump saves one paste over copy-from-targeted-view
  and loses the original design anyway; the genuinely useful version is
  format-preserving `.docx` patching, which is big-ticket XML surgery.
  Reopen trigger: same as 5.15 (the paste workflow hurting in practice).
- [x] 5.11 PDF upload — done 2026-08-28 via unpdf (ADR 0011, `src/resume/pdf-text.ts`).
- [x] 5.12 Async comparison — done via the in-memory run registry
  (`src/web/target-runs.ts` + polled progress pages), not the planned
  `CronRun` row; started by /target, /jobs/:id/match and target re-upload.
- [x] 5.13 Verdict badge on `/jobs` list rows + "verified" filter — shipped
  in `jobs-list.tsx` (issue #21 closed; box unticked until 2026-09-01 audit).

---

## 6. UI/UX refactor — adopted from the two external audits (2026-08-29)

Sources: [archive/applypack-resume-match-ux-refactor.md](./archive/applypack-resume-match-ux-refactor.md)
and [archive/applypack-ui-ux-refactor-plan.md](./archive/applypack-ui-ux-refactor-plan.md); every
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

### 6.4 Later (P2) — resolved 2026-09-01
- [x] ~~Apply-suggestion buttons on action cards~~ — closed with 5.15 (same
  auto-rewrite surface, same fact-gate reasoning, same reopen trigger).
- [x] ~~Linked compare: requirement ↔ evidence scrolling~~ — closed: polish
  on a flow that shipped and is in daily use without it; zero measured pain.
- [x] "Ready to apply" state at ≥85 instead of endless optimization —
  done 2026-09-01 (branch `backlog-triage`): ok-tone line in the targeted
  score card at ≥85.
- [x] ~~Section-heading emphasis inside the plain-text editor~~ — closed:
  needs a textarea overlay trick; complexity outweighs zero measured pain.
- [x] Rename the Target nav item → **Compare** — done 2026-09-01 (branch
  `backlog-triage`); route stays `/target`.

### 6.5 Code health (found while verifying the audits)
- [x] TARGET_JS (~140 inline untestable lines in target.tsx) → served ES module
      (`src/web/public/target-page.mjs`, import-smoke-tested)
- [x] `take` cap on listMatchesForJob / listMatchesForResume — done
  2026-09-01 (branch `backlog-triage`)
- [x] Screenshot checklist gains 768 × 1024 between the existing 375 / 1200 —
  added to the `testing-gate` skill 2026-09-01

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
- [x] F5 status-transition ledger + funnel/calibration stats — v1.1.0
      (branch `stage-ledger`, ADR 0024). Tag is v1.1.0, not the plan's
      v0.7.0 (post-1.0 numbering). Re-analysis corrected the plan: the
      "single write path" is really TWO web routes (the tracking-card
      POST and the pipelineStage='applied' seeding inside the status
      route) and the worker never writes stages — inbox status churn
      (762 of 834 rows are DISMISSED) stays out of the ledger;
      `JobStatusEvent` renamed `JobStageEvent` (collides with the
      orthogonal JobStatus enum); backfill measured tiny and clean —
      exactly 3 funnel rows, all 'applied', with real user-entered
      appliedAt dates, done as SQL inside the migration; with 3
      applications every rate sits under the n=5 floor, so the honest
      empty state ("— (n=0, need 5)") is the whole launch experience,
      not an edge case; cleanup-job could cascade-delete the funnel
      history of an applied-then-DISMISSED job — it now skips jobs with
      a pipelineStage. Fit bands kept as planned (live inbox:
      12/15/13/29 per band). Deferred: assessment event type (0 data),
      per-source channel yield (today Greenhouse×2 + Jobicy×1, floor
      n≥8), per-hop occurredOn date picker (stage hops date to the
      write day; appliedAt edits write correction events)
- [x] ~~F6 follow-up cadence with pin/retire/auto-seed in the stale digest~~ —
      closed 2026-09-01: at 3 tracked applications a cadence state machine
      (urgent/overdue/cold/retire) is machinery without a workload; the
      age-based stale digest already nags. The genuinely useful slice —
      time-in-stage on cards + stale highlighting — moved into the
      /applications board redesign (§10.2), where it lands next to the
      quick-move control that makes acting on it one click. Reopen trigger:
      applications flowing weekly AND the §10 board shipped.
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
- [x] F8 cover letter generation (gated by F7) — v0.8.0 (branch
      `cover-letters`, ADR 0021). Tag is v0.8.0, not the plan's v0.10.0
      (actual integration order), and it also covers the still-untagged F7
      gate. Re-analysis inverted the plan's design: ResumeMatch covers 10
      of 807 jobs (1.2%) and JobVerification 4 (0.5%), so match and
      verification became optional enrichers instead of prerequisites —
      the plain resume+posting path is the primary scenario. Length
      120-180/cap 200 words per the real sent letter (~120), not the
      plan's 250-350; en-only (0 Cyrillic in the corpus) instead of the
      untestable auto|en|uk switch; angle inputs steer but are not gate
      sources, so a metric typed into them is dropped by the quoted-reasons
      regeneration, never laundered. Blocked-twice letters are never
      persisted; manual edits re-gate warn-only. F8.1 (same branch, user
      feedback on the first build): a fourth standing-notes angle field;
      all four angle values persist in AppSettings.coverAngles (typed
      once, prefilled everywhere); recruiter-readability rules (max 3
      tech names per sentence, about-them balance, sharper hook) and a
      deterministic plain-punctuation pass (toPlainPunctuation) so no em
      dash / curly quote / bullet / emoji ever reaches a stored letter.
      F8.2 (same branch): Regenerate per letter; .pdf/.docx export via
      in-house zip/docx/pdf writers (seeds 5.10's zip-writer need);
      /letter menu page — job by picker / one-page URL fetch (ADR 0005
      blocklist, honest bot-check failures) / paste + resume resolve +
      optional match and verify steps in one run.
      F8.3 (same branch, user feedback round 2): the default run is ONE
      model call — no fit-score call on the letter path, match/verify
      moved behind a disclosure and off by default (~26s submit→letter,
      measured, vs ~100s before); URL and paste merged into one box (a
      failed fetch returns to the form with the URL kept); searchable
      job picker over the newest jobs clearing the fit threshold;
      clicking any field selects its mode; per-engine "Cover letter
      model" slot (role `cover`, empty inherits resume); edits autosave
      (Save button becomes the no-JS fallback); PDF/DOCX became labelled
      "Save as" buttons
- [x] F13 job trust score — v0.11.0 (branch `trust-score`, ADR 0023).
      Re-analysis killed the score: measured on all 814 stored jobs, three of
      the plan's four penalties are wrong for our data. `http://` marks 22.7%
      of the corpus and all 185 rows are one host, `block.xyz`, whose
      `absolute_url` Greenhouse itself serves and which 301s to https; the
      missing-URL penalty hits only `MANUAL` rows (all 13, pasted by hand, 0
      fetched); the company↔apply-domain mismatch yields 0 / 26 / 302 (37%)
      depending on a string-matching detail, the 26 being 100% `HN_HIRING`
      and false by construction — an HN posting's company row IS the
      aggregator, the same trap ADR 0018 named. The non-Latin exemption
      protects 0 rows: the only non-ASCII company names are our own
      `WeWorkRemotely ·` rows and the character is a middle dot. Underneath,
      the premise fails too — every classic scam marker (Telegram/WhatsApp
      apply, application fee, crypto, "no experience needed", free-email
      contact) returns 0/814, because ADR 0005 keeps us out of the venues
      where those postings live. So F13 ships as four apply-link flags in
      `Job.redFlags` (no score, no schema, no badge, no migration), each true
      by definition rather than tuned — which is what makes a 0 firing rate
      acceptable here. Fires on 2/814: a YouTube video and a LinkedIn company
      page, both from HN comments, both true positives for what the flag
      claims. `forms.gle` deliberately excluded — it announces its
      destination, and our single occurrence is a legitimate HN posting
- [x] ~~F9 golden-eval harness for the AI engine chain~~ — closed 2026-09-01:
      for a single user the operational need is covered by `bench:resume`
      (3 gold fixtures, live), per-engine Test buttons and `aiUsage`
      counters; a frozen replay eval set is team infrastructure. Reopen
      trigger: an engine swap that needs an objective side-by-side, or a
      second maintainer touching prompts (extend `bench:resume` first —
      the plan's design in feature-expansion-plan.md §10 still stands).
- [x] ~~F10 fetchers wave 2~~ — closed 2026-09-01: two-tier coverage
      (gotcha 10) means new per-company vendors only pay off when the user
      actually meets a company on one; none of the 5 tracked-company ATS
      gaps has occurred yet, aggregators + discovery carry the long tail,
      and F2 measured that robots/ToS analysis kills half of every wave.
      Reopen trigger: a real company the user wants lands on Teamtailor /
      Personio / Getro-class board and the /companies paste fails — add
      THAT vendor then (endpoint table preserved in
      feature-expansion-plan.md §11).
- [x] ~~F11 repost / ghost-job signal~~ — closed 2026-09-01, measured out of
      existence F13-style: the plan's cluster rule (same company + same
      title word-set, ≥2 URLs, ≥2 first-seen days, span ≥1d) fires on
      **1 cluster / 2 jobs out of 669 direct-board rows** over 4 months of
      data. Caveat recorded: the corpus spans only 20 distinct fetch days,
      so this partly measures our own bursty uptime. Reopen trigger:
      ~90 days of continuous hourly fetching, then re-run the query
      (kept in feature-expansion-plan.md §12) and reconsider at ≥10 clusters.
- [x] F12 untrusted-content fences in every prompt builder — v0.9.0
      (branch `prompt-fences`, ADR 0022): one shared `src/prompt-fence.ts`
      (marker pair + directive + forged-marker sanitiser) across all 7
      builders, with `buildClassifyPrompt` / `buildPrefilterPrompt`
      extracted so the derived registry guard can reach them. An attempt
      lands as a `prompt-injection-attempt` red flag — no schema change.
      Re-analysis findings: zero real injection attempts in 814 jobs and 4
      resumes (every fixture is synthetic); the prefilter gets a fence but
      no evidence channel (it has run 0 times, and can only drop a job, so
      it fails open to stage 2 instead); the `---` marker shape broke the
      claude_code CLI and exposed a pre-existing flag-injection hole in
      `buildClaudeCodeArgs` (gotcha 14). Follow-ups: unify
      `isPrivateHost` / `isFetchableJobUrl`; blind SSRF still open (the
      request is made before the post-redirect guard refuses the body)
- [x] F14 company starter packs — v0.5.0 (branch `starter-packs`, ADR 0017):
      86 companies in 5 segments, each board identity-checked live.
      Re-analysis killed the name-guessing design: `GREENHOUSE:aha` is a
      vet practice, `GREENHOUSE:wise` is a field-sales firm, and Pinpoint
      serves one shared demo board to unconfigured tenants — so entries pin
      a verified (atsType, atsToken) and resolve needs >= 1 open job.
      Follow-ups: `probeAts` still accepts any SmartRecruiters token and
      cannot spot a Pinpoint demo board (both pre-existing, on /companies
      and /discovery)
- [x] ~~F15 fetch-run observability + filter reason codes~~ — closed
      2026-09-01: the plan's core ("one summary row per tick") already
      exists — `CronRun.stats` records fetched / filterRejected / duplicate /
      classified / persisted / alerted per tick and renders on `/runs`.
      What remains (per-reason codes, per-source breakdown, token counts)
      answers a support question nobody has asked yet. Reopen trigger: the
      first real post-launch "why did job X never alert me?" that the
      existing stats + F4 quiet-source card can't answer.
- [x] ~~F16 application email drafts~~ — closed 2026-09-01: the letter card
      + copy button covers the body, the subject is one manual line, and
      recruiter/referral/cold variants presume an outreach volume that
      doesn't exist. Reopen trigger: a real application round where
      pasting letters into emails proves structurally wrong.
- [x] ~~F17 reply classification~~ — closed 2026-09-01: a single user reads
      their own replies; at 3 tracked applications the AI would classify
      roughly one email a month, and the stage change it saves becomes one
      click once §10's quick-move ships. Reopen trigger: reply volume that
      makes manual staging a real cost (dozens of active applications).
- [x] ~~F18 interview story bank + question matcher~~ — closed 2026-09-01:
      the F5 funnel records **0 interviews ever reached** — building prep
      tooling ahead of the first screen is the n=0 trap F5's own "need 5"
      floor exists to name. Reopen trigger: the funnel showing real
      interview flow (the design in feature-expansion-plan.md §19 stands).
- [x] ~~F19 salary observations + gap analytics~~ — closed 2026-09-01: F2
      already folded salary into description text after finding structured
      fields too rare; analytics over n≈3 applications is noise, and
      free-text salary parsing is the build-for-unmeasured-need trap F13
      documented. Reopen trigger: an actual comp negotiation needing data,
      or wave-2-class sources with structured salary fields being added.
- [x] ADR 0005 addendum: "Evaluated, not supported" sources table
      (done with F2, 2026-08-31)

## 8. Design-library analysis (2026-08-31 — owner asked about MUI / Radix / shadcn)

Verdict: **no component library.** The dashboard stays server-rendered Hono
JSX with no client framework (PRODUCT.md constraint) — MUI, Radix Primitives
and shadcn/ui are all React-runtime. What we lift instead:

- **Radix Colors** [P2] — framework-agnostic CSS scales (12 steps, paired
  dark scales, contrast-tested). The ready path for the deferred dark theme:
  swap the token values in `src/web/layout.tsx`, zero component changes.
- **Radix Icons** [P3] — 15×15 SVGs, inline-able in Hono JSX by copying the
  path data (no React). Candidate when we next touch dashboard glyphs.
- **shadcn/ui as a taste reference** [P3] — the 2026-08 redesign already
  lives in the same visual world (slate neutrals, hairline borders, quiet
  focus states). Do a token audit against ui.shadcn.com defaults (radius
  scale, ring styles) instead of adopting the library.
- **MUI / Material** — rejected: React runtime, and the Material design
  language conflicts with the pinned "quiet precision" brand (DESIGN.md).
- Caution: **shadcn.io is a third-party registry**, not the official site
  (that is ui.shadcn.com — the .io site says so itself); its paid React
  blocks don't fit this stack.
- Landing patterns already applied on applypack.dev: terminal install block
  (shadcn), real product screenshots instead of mock UI (Radix). A stats
  strip (MUI-style social proof) is deferred until the numbers earn it.

## 9. Launch & distribution — owner actions only (not session backlog)

Everything below is Nazar's calendar, not Claude-session work; sessions
only help when asked (e.g. drafting a measurement post).

- [x] Draft the launch pack — [docs/launch/](./launch/) (2026-08-31): Show HN
  title + first comment, r/selfhosted post, awesome-selfhosted YAML entry.
  Demo link (applypack.dev/demo/) leads every text. awesome-selfhosted's
  4-month rule sets the earliest submission at 2026-12-28.
- Owner: pick the day (Tue–Thu, US-morning), submit, stay in the comments ~6h.
- Owner: `www.applypack.dev` custom domain in Cloudflare Pages (one click).
- Owner (post-launch, ~biweekly): measurement posts, each from a paid-for
  gotcha: SmartRecruiters `totalFound:0` for every slug (gotcha 13); the
  82→10 resume-score inflation fix (gotcha 11 / ADR 0012); "empty is not
  alive" source health (ADR 0019); the trust-score that measured itself out
  of existence (ADR 0023).
- Owner (after first traffic): revisit the MUI-style stats strip on the
  landing (§8) once the numbers earn it.

Community-facing roadmap lives in GitHub issues, deliberately open for
contributors — currently #24 (Discord notification channel behind a
`NotificationChannel` seam). Issues #18–#22 were audited 2026-09-01:
#18/#21 shipped, #19/#20/#22 closed with measurements (§1.4).

---

## 10. /applications board redesign (analysis 2026-09-01 — SHIPPED 2026-09-01)

Items 1–6 shipped on branch `applications-board` → v1.3.0: stage-only
quick-move endpoint (`POST /jobs/:id/stage`, ledger row in the same
transaction, board fields untouched), 70dvh column cap (verified again by
the 100-card DOM simulation: ~1,100 px page vs ~13,000 before), Closed
disclosure, time-in-stage (`src/web/stage-time.ts`, pure + tested) with
"· stalled" past 14d, mobile stage-grouped stack with jump chips, polish.
Item 7 (drag-and-drop) shipped in the same branch after Nazar asked for
it (2026-09-01): `src/web/public/board.mjs` over the same stage-only
endpoint, fine-pointer devices only, quick-move form kept as the
keyboard / no-JS / touch fallback (collapsed until hover or focus on
desktop). The stale ui-review "dark-only" note below is fixed too.

Follow-up the same day (branch `custom-stages` → v1.4.0, ADR 0025):
Nazar reversed the §10.1 stage freeze from the owner seat — work columns
are now user-defined (`AppSettings.pipelineStages`, editor on /settings
General → "Board columns"; Applied + Rejected/Ghosted stay fixed, a
column with jobs can't be deleted, keys are immutable slugs). The funnel
/ velocity / calibration cards he called noise were removed with their
math (`stats.ts`, `funnel-stats.tsx`) — the ledger keeps recording;
resurrect the cards from tag v1.3.0 if ~50 real applications ever
accumulate. The §10.1 text below predates this and stays for history.

Original analysis kept for reference — one branch, one PR, ordered:

### 10.1 Facts established (don't re-derive)

- Cards are plain links; the only stage write path is the tracking card on
  `/jobs/:id` → `POST /jobs/:id/application`.
- That POST **rewrites `appliedAt` / `recruiterContact` /
  `applicationNotes` to null when absent** (routes/applications.tsx) — a
  board quick-move MUST NOT reuse it naively or it wipes data. Add a
  stage-only endpoint (writes the same `JobStageEvent` ledger row, same
  transaction pattern, redirects back to `/applications`).
- Columns have `min-h-[320px]` but no height cap: at 100 cards in one
  stage the page measures **~13,000 px tall**, per-column
  `overflow-y-auto` never engages (`items-stretch` drags every column to
  the tallest), funnel stats land at the very bottom.
- Board is 7 × 288px = **2088 px wide** — horizontal scroll even at 1440;
  at 375px exactly 1.2 columns visible with no hint of the other five.
- Stage vocabulary is hardcoded in 4 files (applications page/route,
  job-detail select, stats.ts) — it is the *analytics vocabulary*
  (STAGE_ORDER ranks, INTERVIEW_RANK=1, TERMINAL_STAGES), stored forever
  in `JobStageEvent` rows. Renaming labels is cheap (UI map); adding /
  removing / reordering stages breaks funnel math and history — decided
  AGAINST custom stages at n=3 applications (F5 re-analysis logic). If
  label customization is ever wanted: display-name map in `AppSettings`,
  canonical keys untouched.

### 10.2 Implementation order (P0 → P3)

1. **Stage-only endpoint + quick-move on cards** — compact per-card select
   or ‹ › control, plain POST form (no JS required), ledger event written,
   redirect to `/applications`. Kills the "kanban that isn't" gap.
2. **Cap board height** so per-column scroll finally works (Layout `fill`
   or `max-h` on the board section); funnel stats visible without a
   13,000px journey.
3. **Rejected/Ghosted out of the board** into a "Closed" disclosure below
   (they're archives, not work columns) → 5 columns = 1488px, fits a
   laptop with no horizontal scroll.
4. **Time-in-stage on cards** ("in screen 12d" from `JobStageEvent`,
   fallback "applied Nd ago" in the Applied column) + warn-tone text at
   >14d without movement — the useful slice of closed F6.
5. Mobile: vertical stage-grouped list under `md:` (board stays at
   desktop), or minimum a stage-jump chip row (`Applied 3 · Screen 0 · …`).
6. Polish: absolute date in a `title` on relative dates; `onsite` dot
   stops sharing `bg-warn` with `tech`; calibration cells shorten
   `— (n=0, need 5)` to `— (0/5)` (the explainer line already exists);
   drop the "Move jobs between stages from their detail page" subtitle
   once quick-move exists.
7. (Optional, last) Drag-and-drop as progressive enhancement over the
   same endpoint — dependency-free ES module in `src/web/public/`,
   select fallback stays for keyboard/no-JS (accessible-interactions).

Also: `.claude/skills/ui-review/SKILL.md` still says "dark-only" — stale
since the 2026-08-28 light redesign (PR #12); fix the skill context line
when next touching it.

## 11. Onboarding wizard + profile simplification + multi-resume search (analysis 2026-08-31)

Full plan: [docs/onboarding-plan.md](./onboarding-plan.md). **Done —
all 7 stages shipped** (v1.5.0–v1.11.0); the checklist below is the
status of record.

Driver: users don't find where to create a profile or upload a resume;
no way to verify the pipeline works from the UI; target persona for
first-run is a non-technical user. Critical path decided by owner:
connect AI → prove search works → build profile from a resume;
Telegram explicitly optional.

- [x] `profile-tab-quickwins` — reorder Profile tab around the journey,
      kill top "Re-classify all", placeholders, conditional rules hint,
      `advancedOpen` fix, inline upload in the Fill card — done 2026-09-01,
      branch `profile-tab-quickwins`
- [x] `fetch-now` — "Fetch now" button + `{classify: false}` seam +
      background run (reclassify pattern) + progress page — done 2026-09-01,
      branch `fetch-now`; lives on Overview AND `/runs` (one shared button)
- [x] `welcome-wizard` — `/welcome` 4-step first-run flow
      (AI → test search → resume → first matches), redirect while
      `AppSettings.setupCompletedAt` null, skip link, Overview chip;
      ~4 clicks + one file pick end-to-end — done 2026-09-01, branch
      `welcome-wizard`; step 4 scores the best 10 per press ("Score 10 more")
- [x] `ai-key-in-db` — paste API key in UI, DB-stored, masked — done
      2026-09-02, branch `ai-key-in-db` (ADR 0027: `AppSettings.aiKeys`,
      four key-bearing engines, `.env` stays the fallback)
- [x] `profile-resume-link` — `Profile.resumeId` + one-click "Create a
      search from this resume" on `/resumes/:id` and in step 3 for a
      second resume; job pages preselect the linked resume — done
      2026-09-02, branch `profile-resume-link`; new profiles born
      inactive, `SetNull` on resume delete
- [x] `multi-profile-search` — multiple active profiles, union base
      filter, **one** classifier call returning per-profile scores,
      `JobScore` table, per-profile alert routing — done 2026-09-02,
      branch `multi-profile-search` (ADR 0028, supersedes 0004; the
      ceiling is 8, not the hypothesised 5)
- [x] `applied-resume` — record which resume (+ text snapshot) a job was
      applied with; surface in stale digest — done 2026-09-02, branch
      `applied-resume`; **§11 closed**

## 12. /resumes overhaul + on-demand resume strength review (analysis 2026-08-31)

Full plan: [docs/resumes-plan.md](./resumes-plan.md). **Section closed
2026-09-02**: Part A shipped in v1.12.0, Part B's review the same day, and the
metric-ask loop plus the quick wins in `resume-strength-loop`. Original audit:
browser pass over the live page at desktop + 375px, plus code verification.

Driver: `/resumes` shows inventory, not effectiveness — no per-resume
match signal, upload & scan freezes the browser ~60 s (double-submit
creates duplicates), and at 375px the action buttons sit behind
horizontal scroll. New feature (owner request): an **on-demand** "is this
resume strong?" review — per-dimension grades with evidence, prioritized
make-it-stronger advice so the candidate reads like a top professional,
metric *asks* instead of invented numbers (ADR 0020 stance). Never
auto-run on upload; discoverable as a real card with an explainer, not an
icon; progress visible step-by-step via the target-run registry pattern.

- [x] `resumes-page-p0` — async upload/replace/rescan **and "Save as vN"**
      via the run registry (+ a `SUBMIT_ONCE` guard on the forms that start
      one), mobile row fix (Delete off hub rows, columns drop out by width
      over the new `Table` `thClasses`), delete-confirm counts comparisons
      AND cover letters, `primarySkills` column, Matches/`FitBadge` column,
      version badge (#6 rode along) — done 2026-09-02, branch
      `resumes-page-p0`. Findings #7 (facts add/flip), #8 (rename) and #9
      (polish) stay open in the quick-wins bullet below.
- [x] `resume-strength` — fenced `REVIEW_SYSTEM` (grades only — the model
      never outputs the score; pure `review-score.ts` applies hard caps,
      gotcha-11 guard test) + `ResumeReview` table + detail card + hub
      column + run-page `review` step — done 2026-09-02, branch
      `resume-strength` ([ADR 0030](./adr/0030-resume-strength-review.md)).
      Six dimensions graded `strong | ok | weak` with verbatim evidence,
      weights 30/20/20/15/10/5 and two caps in code: weak `impact` caps at
      55, two weak dimensions cap at 45. Advice either rewrites with facts
      already in the resume or ASKS for the number it would need — the
      ADR 0020/0021 stance on a new surface. Departures from the plan:
      the sixth dimension is `polish` (positively phrased, so `strong`
      always means good) and asks live inside their advice rows rather than
      in a column of their own. Measured live
      on the three stored resumes (Opus, CLI engine): **45 / 78 / 78** — the
      45 is a raw 70 pulled down by the two-weak cap (a KEY SKILLS block whose
      labels and values collapse into two unreadable lines, plus a typo and a
      product version that did not exist when the role ended); the two 78s are
      two variants of the same CV and drew an identical grade vector, which is
      the right answer rather than a miss. First run 72.6 s / 12 110 reply
      characters, 8 advice items, 4 asks. **Zero invented facts across 23
      advice items** — several rewrites removed unsupportable percentages
      instead of adding numbers.
- [x] `resume-strength-loop` — metric asks → user answers → re-run deltas,
      done 2026-09-02, branch `resume-strength-loop`. One column
      (`Resume.answers`, hand-written migration) rather than a table or a
      `CandidateFact` row: an answer belongs to the DOCUMENT, has to outlive
      the run that asked, and "1.2M requests/day" would poison the skill
      vocabulary that feeds the match prompt. `REVIEW_PROMPT_VERSION` 1 → 2.
      **Measured live on resume 1** (Opus, CLI engine): 4 asks → answered 2 →
      re-run in 69.3 s with `answersUsed: 2` and **asks 4 → 2**, and both
      figures were written into the rewrites verbatim ("Consolidated 3
      microservices into 1 and retired 2 paid SaaS licences, cutting cloud
      spend by ~$40k/year"). The score stayed 45, which is correct: the prompt
      forbids a supplied metric from moving a grade on its own, because the
      resume is graded as WRITTEN. The delta against the earlier run said so
      out loud — *"2 dimensions moved — but the two runs used different rubric
      versions, so the difference is not a measurement"* — which is the whole
      point of storing the prompt version. Test rows removed afterwards.
      **Not built:** the version-over-version trend. Two reviews exist on two
      different resumes and no resume has two comparable runs — n = 0, the
      same trap the repo closed F18 with.
- [x] quick wins: facts add/flip on `/resumes` (the existing `POST /facts`
      took any term; only the form was missing), a rename route + header
      form, and comparisons grouped per job — 14 flat rows became 10, with
      the five-run posting reading **5 runs · 62 → 70 → 64 → 66 → 68**, every
      score still its own link. The plan's fourth item, "version badge in
      hub", shipped with `resumes-page-p0`; removed from the list rather than
      built twice.

## 13. /target compare speed (30-40 s) + keyword-matcher accuracy (analysis 2026-08-31)

Full plan: [docs/target-plan.md](./target-plan.md). **Section closed
2026-09-02: blocks 1–5 plus `keyword-frame-rebuild` shipped (measured numbers
in the plan's §2.3, §3.4, §4 and §5), block 6 closed by the numbers rather
than built.** §12's
async-upload item overlaps the `/resumes`
sync-scan finding, planned there, referenced here.

Driver: a fresh-resume compare takes ~3 min (owner target: 30-40 s), and
the JD pane skips important posting words. Verified causes: one
2.5-4 k-token Opus match call dominates; classify and scan sit on the
critical path although match reads neither (`{classify:false}` seam
already exists); parse-retry silently doubles a step; highlights show
ONLY AI-listed keywords through a literal matcher (soft cap ~25,
non-verbatim terms render nowhere, aliases model-dependent, no
plural/separator tolerance, `previousKeywords` makes a missed term
sticky). Speed strategy: instant no-AI check against the stored frame
(the live-editor machinery already does it), keywords-only fast AI mode,
Sonnet bench for the resume role — not "make Opus stream faster".

- [x] `target-speed-p0` — classify off the critical path (background,
      `{classify:false}`), scan → background on reupload, memoize
      identical (job, resumeText, prompt version) re-runs with a "Re-run
      anyway" escape, per-step times on the run page, `STEP_VIEW` copy from
      measured runs + per-step ms logging — done 2026-09-02, branch
      `target-speed-p0` (PR #78). Measured on the CLI engine: a fresh
      `/target` compare 158 → 128 s, a repeat 158 → 38 s, Compare repeat
      109 → 0 s, re-upload 117 → 95 s; the match call itself is 78–109 s
      (p50 ≈ 94 s) — 30–40 s needs blocks 3–4.
- [x] `keyword-matcher-v2` — persist-time verbatim guard
      (`keyword-anchor.ts`: a paraphrased term is re-anchored to the longest
      verbatim phrase of itself the posting contains, else flagged
      `unanchored` — "not in posting" in the keyword table, counted on the
      `resume: matched` log line), deterministic alias table
      (`keyword-aliases.ts`, 170 spelling groups, applied at persist time
      and when a stored match loads), plural + separator tolerance in
      `termPattern`; table-driven tests — done 2026-09-02, branch
      `keyword-matcher-v2` (PR #80). Measured on the 15 stored comparisons
      (`npm run keywords:audit`, no AI): rows with no highlight in the
      posting 54 → 53 of 305, `present` rows with no highlight in the
      resume 36 → 35 of 181; what remains are paraphrases from pre-v5
      analyses — on the current prompt no stored row misses the posting.
      The tiered keyword budget (F1) is a prompt change and moved to
      `match-fast-mode` below; "Rebuild keywords" (F7) is issue #79.
- [x] `target-instant-check` — reupload → parse-only dirty draft in the
      target editor, "Re-analyze" upgrades on demand — done 2026-09-02,
      branch `target-instant-check` (PR #81). "Upload & check" is the default of
      "Re-upload resume" on `/jobs/:id/target` (no AI, no new version,
      nothing written; the draft lives in the tab and survives a reload);
      the full run stays as "Upload as vN & analyze with AI". `/target`
      answers the same way when the posting dedupes to a job this resume
      was analysed against and its text changed since. Measured on the
      stored originals: parse 0–2 ms (.docx) / 10–15 ms (.pdf, 64 ms
      cold); POST → rendered page ~30 ms server-side, ~155 ms to `load`
      in the browser — the plan's "~2–5 s" was two orders too pessimistic,
      the AI upgrade stays the 78–109 s of block 1. Known cost, stated on
      the page: "Save as vN" after a check keeps the text, not the file.
- [x] `match-fast-mode` — keywords-only prompt variant (the score-complete
      subset), the lazy "Get suggestions" second call, the tiered keyword
      budget from §4 F1 and the Sonnet-vs-Opus bench — one **PROMPT_VERSION
      bump (5 → 6)** for all three prompt changes, ADR 0029 — done
      2026-09-02, branch `match-fast-mode` (PR #82). Both match prompts are
      assembled from the same rule constants, so the guard tests run every
      gotcha-11 rule against both; the mode marker rides in the `breakdown`
      JSON (no schema change) and the reuse memo learned it, so a full
      analysis over a stored quick check pays for the suggestions alone.
      Measured on the gold fixtures (CLI engine, Opus): quick check p50
      **15 s vs 24 s** full, 77 s vs 116 s for the suite, **2591 vs 4373
      reply characters**, all checks green, statuses agreeing 98%. Live on
      job #1393: the quick check scored **66 — the same number the v5 full
      analysis gave** in 40 s, and "Get suggestions" completed the row
      afterwards. Sonnet is NOT the faster resume model on this engine
      (v5: p50 40 s vs Opus 22 s, 95% status agreement, 74% term overlap),
      so `CLAUDE_MODEL_RESUME` stays `claude-opus-5` and §8 question 1 is
      answered by the numbers.
- [x] `keyword-priority-ui` — per-keyword user overrides (re-level /
      ignore / add own term) through the existing `updateMatchScoring` path,
      visual weight for must+primary misses, posting-frequency tiebreaker —
      done 2026-09-02, branch `keyword-priority-ui` (PR #83). The override
      rides beside the model's verdict in the comparison's own `keywords`
      JSON (no schema change, no ADR, `PROMPT_VERSION` untouched);
      `effectiveKeywords()` is what the score, the panes and the live editor
      read, so **`score.ts` never changed** and the score.mjs parity test
      stayed green on its own. Weight and frequency come from
      `keywordRank()` / `orderKeywords()` in `target.mjs` — one
      implementation for the panes, the chips and the server-rendered table.
      Measured live on job #1393: **2–15 ms per edit, no `resume:` line in
      the web log** (must → nice 66 → 67, ignore 67 → 68, add-and-present
      68 → 68, add-and-missing 68 → 67, five resets back to 66); a forced
      re-run logged `overrides: 3, readded: 1`, so the edits survived into
      the fresh reply. An added term's status is read from the resume, and
      the `override` field is stripped from every model reply on the way in.
- [x] `keyword-frame-rebuild` — "Rebuild keywords" runs the analysis once
      without `previousKeywords`, and a frame written under another
      `PROMPT_VERSION` is never inherited (§4 F7, issue #79) — done
      2026-09-02, branch `keyword-frame-rebuild` (PR #84). The decision is a
      pure function of (stored prompt version, request flag) in
      `keyword-frame.ts`; its reason rides in the `breakdown` JSON, so a
      rebuilt row replaces the version delta with *"not comparable"* instead
      of inviting a comparison between two different term lists. A rebuild
      bypasses the reuse memo (it would otherwise hand back the very frame it
      was asked to replace) and keeps every user override — `carryOverrides`
      reads the full stored row, not the withheld frame. Measured live on job
      #1393 (quick check, CLI engine): carried **42.2 s / 26 terms**, the same
      list the frame had carried through five analyses since prompt v5;
      rebuilt **41.8 s / 30 terms** — 23 shared, 3 dropped, **7 new (BullMQ,
      GCP PubSub, AI tools, observability tools, performance monitoring,
      CI/CD, Microservices)**, every one of them literally in the posting,
      `unanchored` still 0. Score 67 → 64, which is what the card now says
      out loud. The must → nice override set before the rebuild survived it.
- [x] `match-split-frame` — per-job cached keyword frame + statuses-only judge
      call (**ADR**). **Not built: closed 2026-09-02 by the numbers, not by
      taste.** The gate was "only if still short of target" (30-40 s). After
      block 4 the quick check is **p50 15 s** on the gold fixtures and
      **40 / 42.2 / 41.8 s** on job #1393, one of the longest descriptions we
      store — inside the band on short postings, ~2 s over on a long one. The
      split would buy those seconds with a second prompt variant, an ADR and a
      per-job cache to invalidate, while block 3 already answers the
      as-you-type case with no call at all (0-15 ms) and F7 shows that a
      frozen frame is a liability, not an asset. Reopen only if a measured
      compare goes back over ~60 s.

## 14. Pre-public hardening (2026-09-02)

Not a feature: the class of bug a stranger meets first. Ordered by damage,
not by issue number — #72 loses a pasted AI key, which is worth fixing
before anyone else installs this.

- [x] `pre-public-hardening` A+B — the read-modify-write races and the
      cross-origin write guard, branch `pre-public-hardening`.
      **Measured on a throwaway database** (`race_test`, all 47 migrations
      applied from empty), each race run twice: once through the old code
      path re-created inline, once through the shipped function.
      - **#72** two tabs save a key for two engines: before → `[gemini_cli]`
        (one key lost), after → `[gemini_cli, openai_api]`. The merge moved
        into one `jsonb_set` statement; a transaction would not have helped,
        because at Read Committed the read inside it still returns the
        version current when it started.
      - **#70** seven searches running, two activations in flight: before →
        **2 accepted, 9 running**; after → **1 accepted, 8 running**. The
        count and the write now share one lock on the singleton settings
        row — locking the rows counted cannot see a row that became active
        during the wait.
      - **#76** three POSTs to `POST /resumes/8/review`, two of them
        concurrent: **one run** (`abbe4376…`), two `run: joined a run
        already in flight` lines, one review row. Every POST that starts an
        AI run now names its work; a repeat after the answer still starts a
        fresh run. The wizard's bespoke `scoreRunId` singleton was deleted
        in favour of it.
      - **PR #83's follow-up** — the keyword override and the `ask_user`
        answer shared a read-modify-write of the same JSON. Two edits in
        flight: before → one survived (`[postgres]`), after → both
        (`[node.js, postgres]`). One locked function now serves both, which
        also fixed a real bug: `/facts` re-scored without
        `effectiveKeywords`, so answering a question on a comparison you had
        re-levelled silently recomputed the number as if you never had.
        Repeated live on job #1393 / match #59: two simultaneous edits →
        3 overrides stored, five resets → back to **66** with 0 overrides,
        the state PR #83 left behind.
      - **#69** cross-origin POST → **403** from the middleware
        (`Cross-origin request refused.` + a `web: cross-origin write
        refused` log line); same-origin POST and header-less `curl` reach
        their routes unchanged; GET is never checked. 11 unit tests on the
        pure `sameOriginPost`.
      - Five follow-ups that had only ever lived in PR bodies became issues
        #88-#92; three of the same class were fixed here instead.
- [x] `pre-public-hardening` C — #73, #74, #75, branch
      `applied-resume-truth` (stacked on the above).
      - **#75 measured in the live database first**: 8 rows with a pipeline
        stage or `APPLIED` status, **0** of them recording a resume. The
        application form now asks; the board's drag deliberately does not
        guess (a drag carries no picker, and a guess written into the record
        is worse than a blank), so the job page shows the gap and offers the
        answer instead.
      - **#74** the snapshot is rendered as a disclosure — it had been
        written since v1.11.0 and read by nothing.
      - **#73** verified live: a `resumeId` that no longer exists flashes
        *"That resume no longer exists — reload the page and pick another
        one. Nothing was saved."* and `profile.updatedAt` does not move.
- [x] `pre-public-check` — the six-point audit, done 2026-09-02, branch
      `pre-public-check`. Six checks, each with its evidence; **two P1s found
      and fixed here**, two findings filed as issues.

      1. **Clean install from nothing** — the check nobody had ever run. The
         real stack down, `cp .env.example .env` (no keys of any kind), a
         separate compose project on a fresh volume. `/` redirected to
         `/welcome`, step 1 reported each engine honestly ("2.1.251 installed,
         but not logged in"), step 2 fetched **2 633 jobs from 32/32 sources in
         93 s with no AI**, step 3's no-resume fallback saved a profile, and
         "Start the hourly watch" set `setupCompletedAt` and stopped the
         redirect. **P1 found:** step 4 ran a full scoring pass with no engine
         connected — ten failing calls and a minute of progress bar to be told
         nothing could be scored. It now checks `facts.aiReady` (which the
         wizard already computed) and sends the user back to step 1. The
         missing *reason* on every other failure path is issue #97.
      2. **Migrations** — all **47** applied to the empty database in order,
         16 tables, `0` rows left unfinished in `_prisma_migrations`.
      3. **Secrets** — `.env` is gitignored and untracked (only `.env.example`
         is in the tree), a regex sweep for key shapes over the tracked files
         found nothing, and `.env` has never been committed. Every variable
         `config.ts` reads is present in `.env.example`; the two extras there
         (`CLAUDE_CODE_OAUTH_TOKEN`, `GEMINI_API_KEY`) are the CLI credentials
         `ai-keys.ts` reads, and both key paths (`.env` and
         `AppSettings.aiKeys`) are documented.
      4. **Exposure — P1, the worst finding.** The dashboard was carefully
         bound to loopback while compose published **Postgres on
         `0.0.0.0:5432` with the password in the compose file**. Demonstrated,
         not theorised: `psql -h <LAN ip> -U jobhunter` from another address
         connected and read the database — every job, resume, letter and
         application, plus `app_settings.aiKeys`, where a pasted AI key lives
         in plaintext (ADR 0027). Now `127.0.0.1:5433:5432`: loopback only, and
         5433 because a host Postgres on 5432 would otherwise shadow it — the
         gotcha this repo had been working around by hand. Re-checked after the
         change: both LAN ports refused, host tools work on 5433, the app
         (which uses the compose network, never this port) unaffected.
      5. **README against the live UI** — text accurate: "22 sources" is
         exactly the `AtsType` count minus `MANUAL`, "five AI backends" is
         exactly `AI_PROVIDER_IDS`, and the page table already calls `/target`
         "Compare". `overview.png` and `jobs.png` are current;
         `target.png` is four releases stale (its nav still says "Target") →
         issue #96, because re-shooting it needs the demo fixture that is not
         in the repo.
      6. **Data — P1.** There were **no backup instructions anywhere**, in a
         project whose pitch is "your data in your own Postgres". The README
         now carries a verified recipe: the documented `pg_dump` produced an
         **8.7 MB dump of all 16 tables**, and the documented restore loaded it
         into an empty database with **0 errors** (1 016 jobs, 4 resumes, 17
         letters). Delete confirmations were re-checked against the schema's
         cascades: the resume one was fixed in v1.19.0, but "Delete "Reddit"
         and all its 73 jobs?" was hiding **6 tracked applications and a cover
         letter**. Company deletes now name them.

---

## 14. applypack.dev + README refresh (analysis 2026-09-02 — built on `site-refresh`)

Analysis and the build log: [docs/site-refresh-plan.md](./site-refresh-plan.md).
The landing was rewritten around the live demo (hero within a 45-word
budget, three pillars, story, open-source and install sections), the demo
page hardened, README and the launch drafts aligned, the social card
regenerated. Docs/site PR, no version tag.

Owner items left open by the branch:

- [ ] Story facts for the `#story` section: month, employer if named,
      2–3 counters from the Overview (the section ships number-free).
- [x] Label 3–5 issues `good first issue` — done 2026-09-04: #90, #92, #96,
      #100, each scoped with file pointers. (the site and README link there;
      the label is empty).
- [ ] Cloudflare: Always Use HTTPS, HSTS, redirect www → apex
      (`http://applypack.dev/` answers 200 over plain HTTP today).
- [ ] GitHub About text and social preview from the new
      `docs/brand/social-card.png`.
- [ ] Read Cloudflare Web Analytics for a before/after baseline.

---

## 15. Country-aware search: Europe + Ukraine (SHIPPED 2026-09-04, v1.24.0–v1.44.0)

Full plan with the facts, the target model, a mandatory pre-work analysis
checklist per stage, step lists, verification matrices and the verified
source register: [docs/country-search-plan.md](./country-search-plan.md).
Every stage starts with its analysis note in the PR body — no branch before
the note.

**Facts established (don't re-derive):** 949 of 1 035 verdicts are
`location mismatch` because both profiles are US / Americas; 151 European
rows are already stored; `Job.location` is one string; the profile knows six
regions and no country; the classifier's location rules are written for a
"US-based search"; WWR's ISO `<country>` list is thrown away; Arbeitnow is
seeded inactive. Sources verified 2026-09-03 with robots.txt are in the plan
(§0.5) and the ADR 0005 register.

- [x] **Stage 1 `location-model`** — shipped on the `location-model` branch, PR #111
      (ADR 0031): gazetteer + parser with the §7.1 trap tests and the 250-string
      corpus, the four Job columns, hints from 14 fetchers, the backfill (1 021
      of 1 038 rows filled, no verdict moved), `/jobs` place / workplace /
      posted facets, `q` on location, chips on the job page. Plan corrections
      recorded in §0.2 (Workable `locations[]`, Lever `onsite`, Ashby `AMER`).
- [x] **Stage 2 `profile-countries`** — shipped on the `profile-countries`
      branch (ADR 0032): `Profile.countries / regions / workplace`, one
      migration that maps and drops the three pill fields (`US` / `UK` →
      countries, amended from the plan), the chip picker over
      `/countries.json`, `filter.ts` on sets with group expansion, the prompt
      without "US-based" and with the shared `location` block, the merge
      that lets the model narrow the parser, the mismatch reason on the job
      page. The wizard's step 3 and "Fill from a resume" reuse the editor
      unchanged — neither speaks for location.
- [x] **Stage 3 sources** — one PR + tag per source, acceptance checklist in
      feature-expansion-plan §0.3. All five sub-stages shipped:
      - 3a, existing geodata: WWR (in stage 1), Jobicy `geo` v1.26.0,
        Himalayas search v1.27.0, 4dayweek `country` v1.28.0, Arbeitnow
        paginated + visa row v1.29.0. The installed aggregators follow the
        searches through the `FetchContext`, so §4.3's card is for new
        sources only.
      - 3b Ukraine: DOU RSS v1.30.0, Djinni RSS v1.31.0, UA-friendly pack
        refreshed v1.32.0 (+ N-iX / Ajax / Genesis, `sigmasoftware` dropped).
      - §4.3 "Sources for your searches" card: v1.33.0.
      - 3c EU boards: solid.jobs v1.34.0, DevITjobs v1.35.0,
        Landing.jobs v1.36.0, JobTech v1.37.0.
      - 3d EU ATS types: Personio v1.38.0, Teamtailor v1.39.0. Homerun and
        d.vinci were left for later, deliberately.
      - 3e keyed, after the robots-vs-licence decision (ADR 0034): Adzuna
        v1.42.0 with the keys on the Sources tab, France Travail v1.43.0,
        both hidden until their credential exists v1.44.0. Neither has been
        run live — that needs the owner's own credentials.
- [x] **Stage 4 `eligibility`** — `residence` + `relocation` and the prompt's
      ELIGIBILITY block v1.40.0 (ADR 0033); the red flags
      `no-visa-sponsorship` / `work-permit-required` are in the classifier's
      vocabulary and the model decides them (the sponsorship wordlist was
      measured 14/24 noise, so no code gate); "Open to me" on `/jobs` reads
      each search's own location verdict. Salary currencies shipped as their
      own PR, v1.41.0 (`src/currency.ts`).
- [x] **Owner decisions** (plan §6), all answered: countries + groups →
      ADR 0032; `remoteRegions` deleted in the stage-2 migration; `residence`
      went into stage 4, not 2; robots vs licence → ADR 0034 rule 1; source
      keys in the database → ADR 0034 rule 2; JOIN's undocumented endpoint →
      not used; salary currency → the model reports the posting's own money
      and `currency.ts` converts.

---

## 16. Schedule: when the search runs and when alerts arrive (SHIPPED 2026-09-04, v1.47.0)

Owner's ask: let the user choose *when* jobs are fetched (hours, days) and
*when* notifications arrive, in a way that is obviously simple. The rule
from [country-search-plan.md](./country-search-plan.md) applies: a written
analysis note in the PR body before the branch exists; every step below has
its own "analyse first" line.

### 16.1 Facts established (don't re-derive)

- The worker has six fixed crons in `src/index.ts:registerCron`: fetch
  `5 * * * *`, digest `0 9 * * *`, stale-applications `0 8 * * *`, cleanup
  `0 3 * * 0`, discovery `0 4 * * 0`, hn-hiring `0 6 1 * *` — all in
  `config.TZ` from `.env` (default `UTC`, ADR 0003).
- The only time control today is the pause flag `AppSettings.fetchingEnabled`
  (`/settings` General → "Job fetching"; Overview shows "Pipeline
  running / paused"). A paused tick still writes a `CronRun` row with
  `{ skipped: 1, reason: 'fetching-paused' }` — the precedent for a
  "skipped" tick. Manual "Fetch now" ignores the pause.
- Alerts are sent per job right after classification
  (`jobs/process-jobs.ts` → `notifier.sendTelegramAlert`), then the row
  becomes `ALERTED` with `alertedAt`. There is no "held" state.
- The 09:00 digest (`jobs/digest-job.ts` → `sendDigest`) re-sends the last
  24 h of matches as one message plus the quiet-sources line; it is a recap,
  not a delivery channel. Chunking under Telegram's 4 096-char limit already
  exists in `sendDigest`.
- Settings are read at the start of every tick (gotcha 9) — a schedule
  stored in `AppSettings` is live within an hour with no worker restart.
- Source health counts ticks (`QUIET_STREAK = 3`) and days
  (`SILENT_DAYS = 14`, ADR 0019): a daily schedule needs three days to mark a
  board quiet — acceptable, but the copy on `/companies` must not promise
  "three hours".

### 16.2 Options considered

| Option | Verdict | Why |
|---|---|---|
| Let the user type cron expressions | no | powerful, not simple; timezone confusion; unreadable errors. Keep at most as a future "Advanced" field |
| Re-register node-cron with a user-chosen expression | no | web writes, worker must notice and re-schedule; cross-process coordination for nothing |
| **Fixed hourly heartbeat + a pure `isDue` gate read from settings** | **yes** | the cron never changes; the decision is one tested pure function over `now`, the schedule and the last run; same shape as the pause flag |
| Alerts: only instant (today) | no | the owner's ask is exactly "not at night, not on weekends" |
| Alerts: per-search or per-Telegram-target windows | later, if ever | one global window covers the need; two levels double the UI |
| Notifications as push at the window start vs. one grouped message | **grouped** | 12 separate messages at 07:00 are noise; `sendDigest` already renders a group |

### 16.3 Recommended design

**One setting object, two schedules, one timezone.**

```ts
// AppSettings.schedule (Json, zod-validated in src/schedule.ts)
{
  timezone: 'Europe/Kyiv',                 // IANA; default = config.TZ
  fetch:  { every: 'hour' | '2h' | '4h' | 'day', from: 7, to: 23, days: [1,2,3,4,5,6,7] },
  alerts: { mode: 'instant' | 'window' | 'digest', from: 8, to: 22, days: [...], digestAt: [9] }
}
```

- **Fetch.** The cron stays `5 * * * *`. Each tick, `runFetchJob` asks
  `isFetchDue(now, schedule, lastFetchRunAt)` (pure, `src/schedule.ts`);
  `lastFetchRunAt` is the newest finished `CronRun` of kind `fetch` — no new
  column. Not due → `{ skipped: 1, reason: 'outside-schedule' }`, exactly
  like a paused tick. Whole hours only (07:00–23:00, "daily at 09:00"):
  minute precision has no value for job fetching and would force a
  15-minute heartbeat that writes 96 run rows a day. Manual "Fetch now"
  ignores the schedule, as it ignores the pause.
- **Alerts.** `process-jobs` asks `canAlertNow(now, schedule)`. Yes → send
  as today. No → set `Job.alertHeldAt = now` (one nullable column; the row
  stays `NEW`, the verdicts are already in `job_score`). Delivery: every
  hourly tick that is inside the window (or equals a digest hour) runs
  `deliverHeldAlerts()` — one grouped message per Telegram target
  ("7 matches while you were away", via `sendDigest`'s chunking), rows
  become `ALERTED`, `alertHeldAt` cleared. Routing per search
  (`profile.telegramTargetId`) is recomputed from the stored winner, so a
  held job goes where an instant one would have gone. `mode: 'digest'` holds
  everything and delivers only at `digestAt` hours; the existing 09:00 recap
  becomes that delivery (no double sends: a recap lists only rows alerted
  since the last recap, a delivery lists held rows).
- **Timezone.** One `Intl.DateTimeFormat(..., { timeZone }).formatToParts`
  helper gives weekday/hour in the user's zone — no date library. The
  setting defaults to `config.TZ`; the settings page pre-fills it from the
  browser once (`Intl.DateTimeFormat().resolvedOptions().timeZone`) and asks
  the user to confirm. The fixed crons for cleanup / discovery / HN keep
  `config.TZ`; they are not user-facing. The digest hour moves to the
  schedule so that ONE timezone rules everything the user sees.
- **What the user sees.** `/settings` General → one "Schedule" card:

  ```
  Time zone        [Europe/Kyiv ▾]   used for everything below
  Check for jobs   [Every hour ▾] from [07:00 ▾] to [23:00 ▾]  Mon Tue Wed Thu Fri Sat Sun (pills)
                   Next check: today at 14:05
  Send alerts      (•) Right away
                   ( ) Only between [08:00] and [22:00] on [days] — matches found outside arrive at 08:00 in one message
                   ( ) As a digest at [09:00] [+ add a time]
                   3 matches are waiting for 08:00
  ```

  Overview: the status pill gains a third state — "Running", "Paused",
  "Sleeping until Mon 07:05" — and the alert line "3 held until 08:00".
  Both sentences come from one pure `describeSchedule()` so the settings
  card, the overview and the Telegram digest header say the same thing.
- **Not built:** per-search schedules, per-target windows, minute
  precision, custom cron, scheduling of cleanup / discovery / HN.

### 16.4 Implementation order (one branch `fetch-schedule`) — done

- [x] **Analyse first:** read `src/index.ts`, `jobs/cron-run.ts`,
      `jobs/fetch-job.ts`, `jobs/process-jobs.ts` (alert block),
      `jobs/digest-job.ts`, `notifier.ts` (`sendDigest`, `broadcast`),
      `jobs/reclassify-job.ts` (does a re-classify alert? if yes it needs
      the same gate); confirm Node's ICU handles `Europe/Kyiv` and DST in
      `formatToParts`; write the analysis note.
- [x] `add schedule module` — `src/schedule.ts` (types, zod schema,
      defaults = today's behaviour, `isFetchDue`, `canAlertNow`,
      `nextFetchAt`, `nextAlertAt`, `describeSchedule`) + `schedule.test.ts`
      with fixed instants: window edges, Sunday→Monday wrap, DST day, "every
      4h" against a last run 3 h 59 min ago, invalid timezone rejected.
- [x] `store schedule in settings` — `AppSettings.schedule Json?` +
      `Job.alertHeldAt DateTime?` (hand-written migration), getter/setter in
      `settings.ts` (null = defaults).
- [x] `gate the fetch tick` — `runFetchJob` skips with reason
      `outside-schedule`; `/runs` shows it like `fetching-paused`.
- [x] `hold alerts outside the window` — the gate in `process-jobs`,
      `deliverHeldAlerts()` in `jobs/alert-delivery.ts`, called from the
      fetch tick and from the digest path; `sendDigest` header text
      parameterised ("Daily digest" / "While you were away").
- [x] `add schedule card` — `pages/settings.tsx` + `routes/settings.tsx`
      (`parseBody({ all: true })` for the day pills — gotcha 1); Overview
      pill + held-count line.
- [x] `document schedule` — CLAUDE.md "Where to look" + "how does the user
      toggle" rows, SPEC.md, README one line, CHANGELOG + bump.

**Verification.** Pure tests above; `npm run test:telegram` for the grouped
message; a scratch run with `from: 7, to: 23` at a fake `now` outside the
window shows `outside-schedule` on `/runs`; a held job appears in the
Overview count and is delivered by the next in-window tick; light + dark
screenshots of the card; keyboard walk of the pills and selects.

**Decisions, as answered 2026-09-04.** (1) Whole hours only — yes.
(2) A manual "Fetch now" sends instantly — yes. (3) The stale-applications
nudge follows `digestAt` too — yes, one digest time for everything.

**What the plan got wrong** (it was written before v1.45.0):
- `src/schedule.ts` already existed — it holds this install's cron MINUTE
  (ADR 0035). The gate went into a new `src/user-schedule.ts`; the two answer
  different questions and share nothing.
- "fetch `5 * * * *`" is no longer true: the minute comes from
  `AppSettings.instanceId`. The gate sits on top of the heartbeat, not
  instead of it, so this made no difference to the design.
- `lastFetchRunAt` cannot be "the newest finished CronRun of kind fetch" —
  a skipped tick is also a finished run row, and counting it would hold a
  4-hour cadence off forever. The pure `lastRealFetch` reads the newest run
  whose stats carry a `fetched` count.
- The digest and the stale nudge could not simply gain a gate: their crons
  fired once a day, so a user picking 19:00 would have got nothing. They beat
  hourly now, and a beat that is not a digest hour writes no run row — 23
  skipped rows a day would be noise, and CronRun rows are never trimmed.

---

## 17. Company watchlist: "check these 20 companies for new jobs" (analysis 2026-09-03, nothing built)

Owner's ask: paste a list of companies (site or job-list URLs), have them
checked at a chosen interval, show their postings apart from the rest, and
do it without fragile HTML parsing — "maybe Playwright".

### 17.1 Facts established (don't re-derive)

- A watched company already has a home: `Company` rows are the unit the
  hourly tick iterates (`fetchers/index.ts:runAllFetchers`, sequential with
  a polite delay, health per row per ADR 0019). `Company.careerUrl` exists
  in the schema and the add form, is stored — and never read by any fetcher.
- The add form on `/companies` makes the user pick the ATS from a select
  and type the slug; the URL → token resolver `text-utils.ts:extractAtsToken`
  (ten vendors' URL shapes) is used only by discovery (HN comments), not by
  the form. Starter packs already have the preview → confirm → "added
  disabled" → "Enable all" flow (ADR 0017) that a bulk import can reuse.
- `jobs/posting-url.ts` is the honest single-page fetch: SSRF guard
  (private ranges, checked again after redirects), ADR 0005 host blocklist,
  bot-check markers that fail instead of being worked around, 12 s timeout,
  30 k chars. It is the only place that fetches an arbitrary user URL.
- No HTML parser and no browser in the dependencies; the runtime image is
  `node:24-alpine`. Nothing in `src/` reads JSON-LD or sitemaps yet.
- Ground rules that bind this feature: ADR 0005 ("scrapers of any kind"
  are out; the listed platforms are never fetched), the feature-expansion
  ground rules ("no bot-protection bypass, ever"; robots.txt that names AI
  bots is binding because every description goes to the classifier).

### 17.2 Why not Playwright — and what actually makes checks stable

A headless browser does not remove parsing; it renders JavaScript and then
you still read a DOM whose classes change with every redesign. It adds
Chromium to the image (hundreds of MB, awkward on alpine), CPU and memory on
every tick, and it is exactly the class of tool the project promises not to
run: career sites behind Cloudflare Turnstile block headless clients, and
"getting past that" is the bypass the ground rules forbid. What is stable is
**data a site publishes for machines on purpose**, in this order:

1. **The ATS behind the page.** Most career pages are a Greenhouse / Lever /
   Ashby / Workable / SmartRecruiters / Recruitee / Breezy / BambooHR /
   Pinpoint / Rippling board (all supported), or Personio / Teamtailor /
   Homerun / d.vinci (verified public feeds, §15 plan). The board API is
   the vendor's contract — it does not change with the site's CSS.
2. **Feeds.** `<link rel="alternate" type="application/rss+xml|atom+xml">`
   on the careers page, or well-known paths (`/jobs.rss`, `/feed`,
   `/careers/feed`). `rss-parser` is already a dependency.
3. **Sitemaps + JSON-LD `JobPosting`.** `robots.txt` names the sitemap;
   the sitemap lists job URLs with `lastmod`; each job page carries
   `<script type="application/ld+json">` with a schema.org `JobPosting`
   (title, description, hiringOrganization, jobLocation,
   `jobLocationType: TELECOMMUTE`, `applicantLocationRequirements`,
   datePosted, validThrough) — the format Google for Jobs requires, so
   custom career sites ship it. New URL in the sitemap → fetch that one
   page → read the JSON block. No layout parsing at all, and the location
   arrives structured (feeds `locationHints` from the country plan).
4. **Change watch (last resort).** When a site offers none of the above:
   hash the page's plain text (`stripHtml`, whitespace and digits
   normalised) and alert "Careers page changed — have a look" with the
   link, at most once a day. It never claims to know the jobs; it tells the
   user when to look. Honest, cheap, and it is what a person checking daily
   actually does.
5. **Refused, with the reason on screen:** LinkedIn / Workday / Indeed /
   Glassdoor / Wellfound hosts (ADR 0005), a `robots.txt` that disallows the
   path or bans AI bots, a page that answers with a bot check. The message
   suggests the alternative: find the company's board on a supported ATS.

Every rung fetches only at the user's request or on the company's own
interval, with the project's honest User-Agent and a polite delay, and
checks `robots.txt` first — a small pure `src/robots.ts` (user-agent groups,
longest-match Allow/Disallow, our token and `*`, the AI-bot names) does
automatically what the ADR 0005 addendum has been doing by hand.

### 17.3 Recommended design

**Data.** No new table — the watchlist is `Company` with four small fields:

```prisma
model Company {
  watched      Boolean  @default(false)   // ★ on /jobs, own section on /companies
  checkEvery   String   @default("hour")  // hour | day | week — the user's interval
  nextCheckAt  DateTime?                  // set after each check; NULL = due now
  alertPolicy  String   @default("matches") // matches | all — watched rows default to "all"
  lastContentHash String?                 // change-watch rung only
}
enum AtsType { … FEED CAREER_PAGE }        // atsToken = the feed URL / the careers URL
```

- `runAllFetchers` selects `active AND (nextCheckAt IS NULL OR nextCheckAt <= now)`
  and writes `nextCheckAt` afterwards — the per-company interval rides on
  the hourly tick, no new cron (ADR 0003). "Check now" on a row clears
  `nextCheckAt` and runs the tick for that company only (reuse the
  fetch-runs progress registry).
- `alertPolicy = 'all'` on a watched company: the base filter is bypassed
  (the user wants to *see* every posting there), the job is classified as
  usual so it carries a fit score, and it alerts on arrival with a ★
  prefix whatever the threshold says. `'matches'` = the normal pipeline.
  Held-alert rules from §16 apply unchanged.
- Two new fetchers, one ladder resolver:
  - `fetchers/feed.ts` — generic RSS/Atom (title, link, description, date;
    `feedItemKey` for ids).
  - `fetchers/career-page.ts` — sitemap + JSON-LD rung, with the
    change-watch rung as its fallback status. Pure pieces next to it:
    `jsonld.ts` (`extractJobPostings(html)` → typed objects, tolerant of
    `@graph` and arrays), `sitemap.ts` (urlset / sitemapindex, `lastmod`,
    bounded to the careers path prefix), `page-hash.ts`. Per tick at most
    `MAX_NEW_PAGES_PER_TICK` (20) job pages are fetched per company.
  - `watchlist/resolve.ts` — `resolveCompanyUrl(url)`: direct board URL →
    `extractAtsToken`; else one page fetch through the `posting-url` guards
    and a scan of the HTML for ATS links / iframes / scripts, feed links,
    JSON-LD, then `robots.txt` for the sitemap; then the common career
    paths (`/careers`, `/jobs`, `/karriere`, `/vacancies`, ≤ 5 requests per
    company, only at add time). Returns one of: `ats(type, token, jobs)`,
    `feed(url)`, `careerPage(url, postings)`, `watchOnly(url)`,
    `refused(reason)`.
- **UX.**
  - `/companies` → "Add companies": a textarea, one URL per line (optionally
    `Name — URL`), or a `.txt` / `.csv` upload. Resolve runs as a progress
    page (one line per URL), then a preview table: URL → what was found
    ("Greenhouse `acme` · 34 jobs", "Teamtailor jobs.acme.com", "RSS feed",
    "Careers site · 12 postings in the sitemap", "Change watch only",
    "Refused: robots.txt asks not to fetch /careers") → the user edits names,
    unticks rows, picks the interval once for the batch → Confirm → rows
    created with `watched = true`, first check runs in the background.
  - `/companies` → a "Watchlist" section on top: name, how it is checked,
    last check, next check, new postings since your last visit, ★ toggle,
    "Check now". Aggregators stay in their own section as today.
  - `/jobs`: ★ before the company name, a "Watched" chip that filters to
    watched companies, sort "watched first" when the chip is on. Job page:
    "★ Watched company · checked daily". Overview: "Watched companies: 3
    new postings today".
  - Telegram: watched alerts start with "★ Acme" and say "new posting"
    rather than "match" when the policy is `all`.
- **Not built:** a headless browser, screenshot diffing, a crawler beyond
  one careers path prefix, per-company custom cron, price/keyword rules on
  the change watch, LinkedIn company pages.

### 17.4 Implementation order (three branches, each its own PR + tag)

**Stage A — `company-watchlist` — SHIPPED v1.48.0 (ADR 0036)**
- [x] **Analyse first:** read `routes/companies.tsx` (new / reprobe /
      starter-pack flows), `pages/companies.tsx`, `starter-packs/resolve.ts`
      + `probe.ts`, `text-utils.ts:extractAtsToken`, `jobs/posting-url.ts`,
      `fetchers/index.ts:runAllFetchers`, `web/fetch-runs.ts`; take the
      owner's real list of 20 companies and resolve each by hand (which rung
      would catch it?) — that table is the analysis note and the fixture.
- [x] `add watchlist fields` — the four `Company` columns + `FEED` type,
      hand-written migration, `nextCheckAt` honoured by `runAllFetchers`.
- [x] `add robots parser` — `src/robots.ts` + tests (RFC 9309 basics, AI-bot
      group, longest match, missing file = allowed).
- [x] `add feed fetcher` — `fetchers/feed.ts` + mapper test; `probeAts` for
      `FEED`; `extractAtsToken` learns Personio / Teamtailor / Homerun /
      d.vinci URL shapes as those types land (§15 stage 3d).
- [x] `resolve company urls` — `watchlist/resolve.ts` (ATS + feed rungs only
      in this stage; `careerPage` returns `watchOnly` for now) + tests on
      recorded HTML fixtures.
- [x] `bulk add companies` — textarea/upload → progress → preview →
      confirm; interval picker for the batch; `watched = true`.
- [x] `show watched jobs` — ★ on `/jobs`, "Watched" chip, job page line,
      Overview count; `alertPolicy = 'all'` bypasses the base filter and the
      threshold; Telegram prefix.
- [x] `document watchlist` — ADR **0036** (not 0034: that one is about keyed
      sources), CLAUDE.md rows, SPEC, README, CHANGELOG + bump, and the
      measurement note `docs/company-watchlist.md`.

**Stage B — `career-page-fetcher` — NOT BUILT, measured 2026-09-04**
- [x] **Analyse first** — done, and it killed the stage. Full note:
      [company-watchlist.md](./company-watchlist.md) §5–§6.
- [x] The premise is false. The stage rests on *"each job page carries
      `JobPosting` JSON-LD — the format Google for Jobs requires, so custom
      career sites ship it."* Across **21 sites on two continents** (the 13
      the owner's list left as `watchOnly`, plus 16 European mid-size
      companies): **0** carry usable `JobPosting`. The only hit in a wider
      sample of 6 detail pages was euremotejobs.com, a WordPress **job
      board**, which the stage A `FEED` rung already serves.
- [x] The redesigned version does not pay either. "New URL under the careers
      prefix = new posting" needs the sitemap to list one URL per posting:
      true for **2 of 21** (Shopify 114, Fly.io 5), and **0 of 8** European
      `watchOnly` sites list anything under their careers path at all.
- [x] Two traps recorded so nobody re-derives them: schema.org microdata is
      the other half of the format and a JSON-LD-only check reports a false
      negative (Shopify); and a path containing `job`/`career` is not a
      posting — Remote's sitemap has 767 marketing templates that look more
      like postings than the real ones do.
- **Superseded by stage C**, which is the honest offer for every one of these
  sites and costs a hash. Revisit only if a future owner list is made of
  WordPress/plugin-driven career sites, where the rung does fire.

**Stage C — `change-watch` — SHIPPED v1.50.0 (ADR 0036)**
- [x] **Analyse first** — done differently and better: rather than one sample
      a day for two days, the same ten careers pages were fetched three times
      ninety seconds apart, so every difference was certainly noise. Raw HTML
      changed on **4 of 10**; `stripHtml` on **0 of 10**. Then their text was
      scanned for anything time-dependent: no dates, no relative timestamps,
      no countdowns — the only digits were Datadog's "92 positions", PostHog's
      "0 Job" and Doist's "2024 Open roles", every one of them the signal.
      **So the plan's digit masking was dropped**: it would have hashed "92
      positions" and "93 positions" to the same string.
      ([company-watchlist.md](./company-watchlist.md) stage C section.)
- [x] `add change watch` — `page-hash.ts` (pure, 13 tests) + `CAREER_PAGE` +
      `lastContentHash` / `lastContentAlertAt`; `fetchers/career-page.ts`
      returns `[]` forever and stages through `watchlist/page-changes.ts`;
      `jobs/page-change-alerts.ts` sends one grouped message after the walk
      and only then advances the hash. `/companies` says *Page changes* and
      *watching* instead of a count.
- [x] The resolver's last rung is now `changeWatch` rather than a dead end, so
      a page with prose is addable; one with almost no text stays `watchOnly`
      (hashing a loading shell reports the shell).

**Verification (all stages).** Pure modules unit-tested next to the file;
each fetcher smoke-run on the owner's list with fixtures recorded; a refused
URL shows its reason in the preview; the SSRF guard is exercised with a
private-IP URL in a test; `/companies` and `/jobs` screenshots (**light only**
— the dashboard has no dark theme: zero `dark:` classes in `ui.tsx` and
`layout.tsx`, corrected 2026-09-04); keyboard walk of the preview table; a
full tick with the watched companies stays under the polite-delay budget
(note the measured duration).

**Decisions for the owner — answered 2026-09-04.** (1) Watched companies
default to "alert on every new posting" — **yes**, the companies were chosen
deliberately. (2) `hour / day / week` presets only, no cron expressions —
**yes**, the same philosophy as §16. (3) The change-watch rung is **deferred
to stage C**; stage A returns `watchOnly` for those sites. (4) "No headless
browser" is **confirmed as policy**, written as its own
[ADR 0036](./adr/0036-watchlist-reads-published-data-only.md) rather than
appended to 0034 (which is about keyed sources).

**What stage A actually measured (2026-09-04).** Twenty JavaScript-heavy
companies: 5 resolve to a board, 13 publish nothing machine-readable, 2
answered an HTTP error, 0 had a job feed
([docs/company-watchlist.md](./company-watchlist.md)). A full tick with 76
active sources including the five watched took **180 s of fetching** against
a 159 s baseline on 70 — the extra is the polite second per new source, not
the due filter. One thing the §17 plan could not know: since v1.47.0 the tick
is gated by the user's schedule, so watched companies inherit its quiet hours.
That is accepted as one intent, and both the UI and ADR 0036 say so.

---

## 18. Tailoring loop: apply, copy, save, export (analysis 2026-09-03, nothing built)

Owner's ask: after a resume-vs-posting comparison, let the user take the
AI's edit suggestions in a few clicks (apply, add missing keywords, reorder)
or copy them comfortably and edit by hand, then save the tailored resume as
a real file; check whether the linkedin-radar "resume regeneration" service
is worth reusing; make sure nothing ApplyPack writes gets a resume flagged
as "AI-generated"; use libraries where they exist; handle every user's own
template. Analysis: [tailoring-loop-plan.md](./tailoring-loop-plan.md).
Build guide, file by file, with the session model and effort per stage:
[tailoring-loop-integration.md](./tailoring-loop-integration.md).

### 18.1 Facts established (don't re-derive)

- `/jobs/:id/target` already has the editor, the live score, the
  quote-to-editor jump, the draft in localStorage and Save as vN (a `.md`
  text version). Missing: copying a proposal, applying one, adding a
  keyword to the text, a file after Save. §5.10 (.docx export) and §5.15
  (AI-tailored resume) were closed with reopen triggers; this ask is the
  trigger, in a narrower form: the user picks each edit, the model only
  proposes wording, the file keeps the user's design.
- The stored suggestion shape is `actions[] {section, where, what, why,
  priority, quote}`; 16 of the 18 actions on the two stored full analyses
  (matches 59, 68) carry the proposal as a quoted string inside `what`.
  Removals carry the exact quote to delete; the card does not show it.
- Live corpus: resume 1 is the only `.docx` (89 paragraphs, 527 runs, 31 of
  65 non-empty paragraphs fragmented into 4+ runs, one 1×2 skills table,
  2 OMML objects, 100 tabs, junk third-party template properties in
  `core.xml`, mime stored as `application/octet-stream`); resumes 4
  (scratch), 5 and 8 are PDFs from macOS Quartz. Our own writers
  (`pdf-write.ts`, `docx-write.ts`) emit no `/Info` and no `docProps`.
- The linkedin-radar "service" is the `job-apply` Claude Code skill: two
  rulebooks + nine stdlib-Python scripts that patch one person's .docx in
  place (run-mapped replacement, byte-identical style parts, text round
  trip, hygiene, metadata cleaning) and render the PDF through Pages / Word
  on macOS. Take the gates and the idea; the code is tuned to one template
  and one Mac.
- No major ATS detects AI authorship (Jobscan, Enhancv, 2026). What is
  flagged: hidden white text (Greenhouse: ~1% of ~300 M resumes in H1 2025),
  unparseable layout. Library fingerprints in metadata (`python-docx`,
  `pdf-lib`, `docx` "Un-named", pdfkit "PDFKit") are visible to a human
  opening File → Properties, not a rejection rule. linkedin-radar's
  rulebook claim about "vendor AI-content classifiers since late 2025" is
  unsupported.
- No Node library replaces arbitrary text inside an existing .docx with
  formatting intact (`docx.patchDocument` wants `{{placeholders}}`;
  docxtemplater's search-and-replace is a paid module). Generation has
  libraries: `docx` (dolanmiu), `pdfkit`, Typst via WASM; `@xmldom/xmldom`
  + `jszip` for the patcher; LibreOffice (~240 MB image) only as an
  optional profile. OpenResume's parser is AGPL. JSON Resume is the model.
- Templates are three populations: flow `.docx` (patch fully), structural
  `.docx` with tables / text boxes / columns (patch partly), PDF-only
  (nothing to patch). A deterministic check at upload sorts them.
- Page review (live, 800 px and 375 px): clicking a suggestion focuses the
  editor and scrolls the page away from the proposal; the wording is buried
  in "Reword as: "…"" sentences; cards are clickable `<li>` elements; the
  selection is invisible; chips only navigate. Hierarchy 7, consistency 8,
  accessibility 5, polish 6.

### 18.2 Decisions

Copy and Locate as separate controls (Locate never moves the page); every
card shows Now / Proposed; a Markdown change sheet ("Copy all suggestions",
"Copy my changes") ships first as the universal manual path; Apply, Remove,
Add to Skills, Undo are client-side text operations; the model returns
`replacement` / `insert_after` and `fact-check.ts` decides at persist time
what is applicable (blocked proposals become questions); keyword additions
stay deterministic (`add` and confirmed terms only); Save patches the
user's `.docx` in place when the template check allows it, else a text
version with the reason; the patcher is in-house over xmldom + jszip,
generation uses `docx` + pdfkit, JSON Resume is the structured model; the
metadata policy binds every writer (no tool name, no hidden text); for
PDF-only and structural files the product offers a clean single-column
re-render in the user's typography, labelled as such; no external service.

### 18.3 Session model and effort per stage

| Stage | Session model | Effort |
|---|---|---|
| Pre-work notes, `code-review-expert` passes | Fable 5.1 | high |
| 1 `target-copy-locate` | Opus 5 (`/fast` for markup) | medium |
| 2 `target-apply-edits` | Opus 5 | high |
| 3 `suggestion-replacements` | Fable 5.1 | high |
| 4 `docx-patch` | Fable 5.1 for the patcher, check and fixtures; Opus 5 for wiring | max / medium |
| 5 `resume-render` | Opus 5 for libraries and pages; Fable 5.1 for the `structure` prompt | high |

Product engine unchanged: the resume role stays `claude-opus-5` (ADR 0029
bench); re-run `bench:resume` after stages 3 and 5.

### 18.4 Implementation order (five branches, each its own PR; tags from stage 3 on)

**Stage 1 — `target-copy-locate` — SHIPPED v1.51.0 (no schema, no prompt)**
- [x] **Analyse first:** read the page and card sources; pull every stored
      `actions[].what` and write the proposal extractor against the real
      shapes; one 375 px screenshot of the Suggestions tab in the note.
- [x] `add proposal extractor` — `resume/change-sheet.ts:proposalOf` + tests
      (NOT `target.mjs`: the card renders it server-side, and `target.mjs` is a
      byte copy in the landing demo — a new import there 404s on applypack.dev).
      Measured 167/209 on the live corpus; single quotes are 131 of them.
- [x] `add line diff` — `public/line-diff.mjs:diffLines` + tests.
- [x] `add change sheet` — two, not one: `resume/change-sheet.ts:suggestionSheet`
      is rendered server-side into the button ("Copy all suggestions" therefore
      works on `/jobs/:id`, which carries no editor), `public/change-sheet.mjs:formatEditSheet`
      builds "Copy my changes" from the live editor.
- [x] `add copy and locate` — `copy.mjs:wireCopy` (clipboard + fallback,
      aria-live "Copied"); Locate outlines the span (`.located`), scrolls
      the editor only, `focus({ preventScroll: true })` on wide screens;
      "Couldn't find this text" inline instead of the pulse.
- [x] `restructure suggestion cards` — `SuggestionCard` with Now / Proposed,
      `<button>` controls, removal quote shown, badge inline; Copy also on
      `/jobs/:id`.
- [x] `fix narrow layout` — editor first and collapsed at ≤ 1023 px, keyword
      table behind a disclosure, and `#panes > * { min-width: 0 }`: the real
      bug was a grid track widened to 499 px by the keyword table inside a
      375 px column. The "show matched" toggle stayed where it is — the editor
      card is `display:none` in the job-only view, which would take the job
      pane's own control with it.
- [x] `document copy path` — CLAUDE.md rows, SPEC, CHANGELOG + bump.

**Stage 2 — `target-apply-edits` — SHIPPED v1.52.0 (no schema, no prompt)**
- [x] **Analyse first:** read `keyword-overrides.ts` and `facts.ts`; count
      quotes `locateQuote` finds and multi-line removal quotes.
- [x] `add text operations` — `applyReplacement`, `removeSpan` (contact line
      protected), `insertIntoSkills` + tests, in a new `public/text-edits.mjs`
      (not `target.mjs`: the landing demo ships a byte copy of that file).
      `moveLineToBlockTop` was built, measured at 4 of 24 move-worded actions,
      and dropped — the model means "make the first bullet say this", which is
      a replacement. `insertIntoSkills` gained a shape test: on all six stored
      resumes the skills section is bare labels with the values stacked below,
      and the first live walk appended a keyword to the contact line.
- [x] `add apply state` — Apply / Edit & apply / Skip / Remove / Undo;
      `target-edits:<matchId>` in localStorage beside the draft, holding the
      *inverse* edit per card (598 bytes for three) rather than a copy of the
      resume, so Undo is exact and survives a reload.
- [x] `add keyword insert` — "+ add" on `add` chips (a confirmed CandidateFact
      is already flipped to `add` by `applyFacts` before the page renders, so
      that is one condition, not two); `cannot_claim` never gets a button, and
      neither does a resume with no skills list to write to.
- [x] `document apply` — CLAUDE.md rows, SPEC, CHANGELOG + bump.

**Stage 3 — `suggestion-replacements` (PROMPT_VERSION 7, ADR 0035; ~1 session)**
- [ ] **Analyse first:** read `prompts.ts`, `match.ts`, `suggestions.ts`,
      `cover-letter.ts` (the `factCheck` call), `prompts.test.ts`; run
      `bench:resume --mode full` before the change and keep the file.
- [ ] `add replacement fields` — `replacement`, `insert_after` in
      `MatchSchema`; `RULE_BULLET_STYLE` shared with the review's example
      rule; `OUTPUT_ACTIONS`; `PROMPT_VERSION = 7`.
- [ ] `add replacement gate` — `replacement-gate.ts:gateActions` (plain
      punctuation, `factCheck`, KEEP WANTED KEYWORDS in code); wired before
      `createMatch` and `updateMatchSuggestions`.
- [ ] `test both variants` — guard tests: rule present in full, fast and
      suggestions prompts; a reply without the fields parses; the gate
      blocks an invented figure and keeps a real one.
- [ ] `write adr 0035` — "suggestions carry replacement text; the fact gate
      decides what is applicable"; bench after-table in the PR; CHANGELOG +
      bump + tag.

**Stage 4 — `docx-patch` (deps xmldom + jszip, ADR 0036; ~2 sessions)**
- [ ] **Analyse first:** prove xmldom fidelity on resume 1's `document.xml`
      (DOM for `document.xml`, raw bytes for every other part); build the
      three fixtures (`flow-fragmented`, `structural-table-layout`,
      `flow-simple`); run the parser-disagreement check by hand.
- [ ] `add template check` — `docx-structure.ts:docxStructure` (kind, lines,
      counts, notes) + tests; shown on `/resumes/:id` and above the editor.
- [ ] `expose document blocks` — `docx-text.ts:walkDocument` with a parity
      test against the old text output on every fixture.
- [ ] `share line diff` — `resume/line-diff.ts` bridging to the `.mjs`.
- [ ] `add docx patcher` — `docx-patch.ts:patchDocx` (change / delete /
      insert, tabbed headers, cell text, hygiene on new text, gates) +
      `docx-props.ts` + tests.
- [ ] `save patched versions` — `POST /resumes/:id/draft` branches on
      `.docx` + check; `replaceResumeFile` with the patched bytes; text
      fallback with the reason; "Save as a tailored copy" (owner decides the
      default); Download reflects the new file; export report line.
- [ ] `fix document properties` — the opt-in POST; current values shown.
- [ ] `write adr 0036` — supersedes ADR 0010's text-only consequence;
      CLAUDE.md rows; CHANGELOG + bump + tag; screenshots of the patched
      file in Word, Pages, LibreOffice in the PR.

**Stage 5 — `resume-render` (deps docx + pdfkit + one OFL font, ADR 0037; ~2 sessions)**
- [ ] **Analyse first:** render one JSON Resume sample through `docx` +
      pdfkit and through Typst; compare output, size, producer strings
      (owner question 3); pick the bundled font family.
- [ ] `add json resume model` — `json-resume.ts` (zod subset).
- [ ] `add scan structure` — `structure` block in `SCAN_SYSTEM` +
      `ScanSchema`; `structure-anchor.ts` verbatim guard;
      `Resume.structure Json?` with a hand-written migration;
      `structure-from-text.ts` fallback.
- [ ] `add style inference` — `style-infer.ts` from docx styles / pdf.js
      fonts + tests.
- [ ] `add clean renderers` — `render/clean-docx.ts`, `render/clean-pdf.ts`
      (metadata per library, Cyrillic-capable font, fonts copied in the
      Dockerfile).
- [ ] `add render page` — `/resumes/:id/render`: knobs prefilled, structure
      editable, "what the ATS sees" preview, download or save as a new
      resume; links from `/resumes/:id` and the target page for PDF-only and
      structural files.
- [ ] `write adr 0037` — JSON Resume as the model, the dependencies, the
      font, the label; CHANGELOG + bump + tag.

**Optional — LibreOffice profile.** Only if the owner reports the "export
the PDF from Word or Pages" step as friction after stage 4.

**Verification (all stages).** Pure modules unit-tested next to the file;
`npm run lint:types && npm test` every commit; `docker compose build web`
and a curl of every touched route; screenshots at 1200 / 768 / 375 with
keyboard walks; stage 3 benched before and after; stage 4's patched file
opened in Word, Pages and LibreOffice; stage 5's outputs round-tripped
through our own extractors and `parse-warnings`; `code-review-expert` over
`git diff main...HEAD` before every PR.

**Decisions for the owner.** (1) Tailored edits save as a copy per posting
(recommended) or as a version of the master? (2) Fix junk document
properties on click (recommended) or on the first patched save? (3) pdfkit
(recommended) or Typst for stage 5? (4) Is "export the PDF from Word or
Pages" acceptable for v1, or is the LibreOffice profile required? (5)
Tables in the patcher's v1: cell text edits or refuse? (6) Reordering:
"make this the first bullet" only, or free line moves? (7) Ship stages 1
and 2 as one branch or two?
