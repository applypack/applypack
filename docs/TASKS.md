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

Full plan: [docs/resumes-plan.md](./resumes-plan.md). **In progress —
Part A's P0/P1 findings shipped in v1.12.0**; Part B (the strength
review) is still analysis only. Original audit: browser pass over the
live page at desktop + 375px, plus code verification.

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
- [ ] `resume-strength` — fenced `REVIEW_SYSTEM` (grades only — the model
      never outputs the score; pure `review-score.ts` applies hard caps,
      gotcha-11 guard test) + `ResumeReview` table + detail card + hub
      column + run-page `review` step (**ADR**: new AI call site + table)
- [ ] `resume-strength-loop` — metric asks → user answers → re-run
      deltas; version-over-version strength trend
- [ ] quick wins ride along where touched: facts add/flip on `/resumes`
      (existing `POST /facts` covers it), rename route, version badge in
      hub, grouped per-job score history (`diff.ts`)

## 13. /target compare speed (30-40 s) + keyword-matcher accuracy (analysis 2026-08-31)

Full plan: [docs/target-plan.md](./target-plan.md). **Block 1 shipped
2026-09-02 (measured numbers in the plan's §2.3); blocks 2–6 open.** §12's
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
- [ ] `keyword-matcher-v2` — persist-time verbatim guard, deterministic
      alias table (`keyword-aliases.ts`, pure), plural + separator
      tolerance in `termPattern`, tiered keyword budget (all must/
      preferred always listed); table-driven tests
- [ ] `target-instant-check` — reupload → parse-only dirty draft in the
      target editor (~2-5 s, zero AI), "Re-analyze" upgrades on demand
- [ ] `match-fast-mode` — keywords-only prompt variant (score-complete
      subset, ~¼ output tokens) + `bench:resume` Sonnet-vs-Opus decision
      (**PROMPT_VERSION bump**; possibly ADR)
- [ ] `keyword-priority-ui` — per-keyword user overrides (re-level /
      exclude / add own term) via existing `updateMatchScoring`, visual
      weight for must+primary misses, posting-frequency tiebreaker
- [ ] (only if still short of target) `match-split-frame` — per-job cached
      keyword frame + statuses-only judge call (**ADR**)
