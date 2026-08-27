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
- [ ] `src/ai-provider.ts`: `interface AiProvider { complete(system, user, maxTokens): Promise<string> }`
- [ ] `AnthropicApiProvider` — move the two `messages.create` bodies here
  (keep `cache_control`, retry on 429).
- [ ] `classifier.ts` / `classifier-prefilter.ts` become pure prompt-builders +
  zod parsers that call the provider. Extract `buildUserText` into a testable
  pure function.
- [ ] `config.ts`: `AI_PROVIDER: z.enum(['anthropic_api','claude_code']).default('anthropic_api')`;
  `ANTHROPIC_API_KEY` becomes optional, validated as required only when
  `AI_PROVIDER=anthropic_api`.
- [ ] Optional: expose the choice as an `AppSettings` toggle on `/settings`
  (schema → settings.ts → settings.tsx → routes/settings.tsx) so it is
  switchable at runtime. Worker reads it per tick (gotcha 9).

### 1.2 `claude_code` provider (subscription)
- [ ] `ClaudeCodeProvider`: `execFile('claude', ['-p', prompt, '--output-format', 'json', '--model', 'haiku'])`
  with 60 s timeout; parse `result` field, hand to existing `extractJson`.
- [ ] Rate-limit handling: on the 5-hour window error, mark the job
  `classification: pending` and let the next tick retry — never drop it.
- [ ] Docker: install `@anthropic-ai/claude-code` in the runtime stage, mount
  `~/.claude` (credentials) as a read-only volume. Document token refresh
  caveat in README.
- [ ] Unit test for the CLI-output parser (pure).

### 1.3 Cheaper API path (no grey zone — do this regardless)
- [ ] Batch API mode for `AnthropicApiProvider`: collect all jobs of a tick,
  submit one batch, poll until `ended`, persist. −50 % on tokens. The tick is
  hourly, so minutes of latency are fine.
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
- [ ] `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` →
  `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill`
  (or `npx ui-ux-pro-max-cli init --ai claude`). Confirm Python 3 is on PATH.
- [ ] `npx impeccable install` → then `/impeccable init` and review the
  generated `PRODUCT.md` / `DESIGN.md` (audience: one developer hunting jobs;
  dense data tables; dark-mode friendly; no marketing tone).
- [ ] `npx skills add coreyhaines31/marketingskills` (or the plugin route).
- [ ] Commit `.claude/skills/**`, `PRODUCT.md`, `DESIGN.md`. Add generated
  caches / `design-system/*.tmp` to `.gitignore` if the tools create them.

### 2.2 Design system
- [ ] Run ui-ux-pro-max for "internal analytics dashboard / job tracker,
  HTML + plain CSS, server-rendered". Persist to `design-system/`.
- [ ] Extract tokens (colors, spacing, type scale) into one CSS block in
  `src/web/layout.tsx` (`:root` vars + `prefers-color-scheme: dark`).
- [ ] `src/web/ui.tsx`: refactor shared primitives (Card, Badge, Table,
  Button, Form field) to use tokens only — no ad-hoc hex values in pages.

### 2.3 Page-by-page pass (one commit per page)
- [ ] `overview.tsx` — stat tiles + recent jobs
- [ ] `jobs-list.tsx` — table density, filters, fit-score badge scale
- [ ] `job-detail.tsx` — application tracking card, red flags
- [ ] `applications.tsx`, `companies.tsx`, `discovery.tsx`, `runs.tsx`,
  `settings.tsx`
- [ ] After each page: `/impeccable audit` → fix → `/impeccable polish`.
- [ ] Microcopy pass with `copywriting`: empty states, button labels, settings
  help text, Telegram alert wording in `notifier.ts` (keep MarkdownV2 escape).

### 2.4 Verify
- [ ] `npm run lint:types && npm test`; smoke `npm run dev:web` and screenshot
  every page (light + dark) via the playwright plugin before/after.

---

## 3. Housekeeping candidates (pick up when convenient)
- [ ] `@anthropic-ai/sdk` is pinned to `^0.39.0` — bump to current 0.x after
  §1.1 lands (provider file is the only import site).
- [ ] Model id `claude-haiku-4-5-20251001` → move to `config.ts` constant so
  it is changed in one place.

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
| `commercebase.io` | `requesting-code-review/` | Checklist before merging a phase branch. |
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
- [ ] Copy `commit-discipline`, `commit-guard.sh` + hook, `code-review-expert`,
  `requesting-code-review`, `stop-slop`, `design-system`, `ui-ux-pro-max`
  into `.claude/`. One commit: `add project skills`.
- [ ] Adapt `testing-gate`, `ui-review`, `accessible-interactions`,
  `adr-writer` (one commit each, short).
- [ ] Write ADR 0006 "AI provider abstraction" with the adapted template.
- [ ] Product: verifier checklist → `Job.verification` column + UI action;
  repost / liveness / follow-up cadence as separate backlog items.
