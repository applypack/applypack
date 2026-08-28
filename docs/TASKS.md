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
- [ ] Optional: expose the choice as an `AppSettings` toggle on `/settings`
  (schema → settings.ts → settings.tsx → routes/settings.tsx) so it is
  switchable at runtime. Worker reads it per tick (gotcha 9).

### 1.2 `claude_code` provider (subscription)
- [x] `ClaudeCodeProvider`: `execFile('claude', ['-p', prompt, '--output-format', 'json', '--model', 'haiku'])`
  with 60 s timeout; parse `result` field, hand to existing `extractJson`.
- [x] Rate-limit handling: rate-limited → `classifyFailed` for the tick; the
  job is not persisted so the next tick picks it up again.
- [x] Docker: install `@anthropic-ai/claude-code` in the runtime stage, mount
  `~/.claude` (credentials) as a read-only volume. Document token refresh
  caveat in README.
- [x] Unit test for the CLI-output parser (pure).

### 1.3 Cheaper API path (no grey zone — do this regardless)
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
- [ ] 5.8 Profile from resumes: propose `stackRequired` (core) /
  `stackNiceToHave` (rest) / roleTypes / seniority from scanned resumes,
  preview diff, "Merge into active profile" + "Create profile per resume".
- [ ] 5.9 Tailored `resume.md`: apply the actions under the ats-rules scope
  (title, summary, skills, top-2 roles, max 4 bullets) → diff + download.
- [ ] 5.10 `.docx` export: port `patch_resume_docx`, `check_text_hygiene`,
  `clean_docx_metadata` to TS (needs a zip *writer*; `fflate` or in-house).
- [ ] 5.11 PDF upload (`pdf-parse` or similar).
- [ ] 5.12 Async comparison / verification with a `CronRun` row when the sync
  request gets annoying (see ADR 0008 / 0009 consequences).
- [ ] 5.13 Verdict badge on `/jobs` list rows; "verified" filter.
