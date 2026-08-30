# AI engine — future improvements (backlog, not scheduled)

> Distilled 2026-08-30 from the multi-provider research doc
> ([job-hunter-multi-provider-ai-architecture.md](./job-hunter-multi-provider-ai-architecture.md),
> § numbers below refer to it) reviewed against what ADR 0013/0014 already
> shipped. ~70% of that doc is implemented; this file keeps only the delta
> worth doing — and the explicitly rejected parts, so future sessions don't
> re-adopt them. **Status 2026-08-30:** items 1–6 plus two P3 notes are
> integrated (commits `add cli env allowlist` … `update docs for integrated
> improvements`); what remains open is marked below.

## Already covered — do not rebuild

DB-backed engine config with `.env` as seed (§3–5) · adapter seam + probe
(§10–14) · ordered fallback on operational failures only (§30, §39) ·
CLI-owned subscription credentials, no OAuth copying (§9, §166) · argument
arrays, never shell strings (§90) · zod-validated structured output (§49–50)
· deterministic scoring — model marks facts, code computes the number
(§161–162 = ADR 0012) · tool-less CLI runs in tmp workspaces (§128–129) ·
Codex-subscription vs OpenAI-API separation (§17–18) · empty slot = engine
default model (§46) · cheap classifier / strong resume model split (§113) ·
per-engine live Test buttons (§76).

---

## P1 — real gaps, cheap fixes

### 1. Env allowlist for CLI child processes (§16, §91) — ✅ done 2026-08-30

> `buildCliEnv` + `CLI_PROVIDER_ENV_KEYS` in `ai-provider-parse.ts` (unit-tested), wired into `CliProvider`.

Claude Code documents that `ANTHROPIC_API_KEY` **takes precedence over
subscription login**. The moment that key lands in `.env` (for the
`anthropic_api` engine), the `claude_code` engine starts silently billing
the API while the user believes the subscription is working. CLI children
also inherit the whole process env today — a gemini process does not need
`TELEGRAM_BOT_TOKEN` or `DATABASE_URL`.

*Apply:* `CliProvider` passes an explicit `env` to `execFile`: `PATH`,
`HOME`, locale + only the variables of its own provider; strip
`ANTHROPIC_API_KEY` from the `claude_code` child (keep
`CLAUDE_CODE_OAUTH_TOKEN`), keep `GEMINI_API_KEY` only for `gemini_cli`,
OpenAI vars only for `codex_cli`. One spec field + unit test.
**Trigger:** before the Anthropic API key is ever added to `.env`.

### 2. Cooldown / circuit breaker per engine (§41–43) — ✅ done 2026-08-30

> `src/ai-cooldown.ts` (3 fails → 60 s skip, unit-tested) + `MAX_ENGINE_SWITCHES`/deadline in the chain runner.

Failover is resolved per call with no memory: during a 750-job
re-classify, a dead engine #1 burns its retries + timeout on **every job**
before yielding. Add an in-process map `engineId → cooldownUntil` — after
N consecutive failures, skip the engine for ~60 s (log once). Plus an
overall deadline per logical call: verify's 10-min timeout across a 3-CLI
chain is a potential 30-minute wait today (`maxSwitches` /
`overallDeadlineMs` in the chain runner).
**Trigger:** first bulk run on a chain with a flaky primary.

### 3. Honest "paid" marking in the chain UI (§31–32) — ✅ done 2026-08-30 (badge + enable-warn; budget caps still open)

> `PROVIDER_PAID`, "pay per token" badge, warn flash when a paid engine is enabled behind subscriptions.

API engines (`anthropic_api`, `openai_api`) look identical to subscription
engines in the chain. Minimum: a "pay per token" badge on their cards and a
`warn` flash when one is enabled *behind* subscription engines ("fallback
will spend money"). Daily/monthly API budget caps (§66–67) only once real
keys exist — start with the badge, not the accounting.
**Trigger:** first API key in `.env`.

---

## P2 — useful, moderate effort

### 4. Cross-engine bench (§116, §164) — ✅ done 2026-08-30

> `npm run bench:resume -- --engine <id>|all` and `--list-engines`.

`npm run bench:resume` already has gold fixtures — loop it over every
enabled engine and print accuracy / schema-validity / latency per task.
This turns "can the Gemini classifier be trusted?" (ADR 0014 warns about
drift but doesn't measure it) into a table instead of an impression.
**Trigger:** the first non-Claude engine goes live.

### 5. Fallback visible to the user, not only in logs (§122–123) — ✅ done 2026-08-30

> `viaFallback` on every call; match/verification store and show `model · fallback`.

Every call already returns `providerId` — surface it: a line on the
match/verify card like "completed by Gemini — Claude was unavailable", and
a clearer all-engines-failed flash (§157). Builds trust, speeds diagnosis.

### 6. Lightweight usage counters (§98–100, light) — ✅ done 2026-08-30

> `AppSettings.aiUsage` (atomic jsonb increment per call), 60-day trim in cleanup, 7-day summary on the AI tab.

Runs per engine × role per day — no prices, no new tables (`CronRun.stats`
or a tiny JSON on AppSettings). Full cost tracking with versioned pricing
snapshots (§56–57) is deliberately deferred until API keys are in use —
and if built later: integer micro-USD, never floats (§150).

---

## P3 — later / conditional

- **Gemini API key without the CLI — zero code** (§22): ✅ documented in
  [ai-engines.md](./ai-engines.md) (2026-08-30) — the `openai_api` engine
  covers it via `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`.
- **Model discovery** (§45): populate the `openai_api` free-text slot from
  the endpoint's `/models`; cached, manual refresh.
- **Per-provider prompt overrides** (§48): only if the bench (item 4)
  shows real scoring drift — small, tested deltas on top of the shared
  prompt, never a fork.
- **PII in warn logs** (§102): parse-failure logs include
  `raw.slice(0, 500)` of model output, which can carry resume content.
  Acceptable for a local single-user install; mask if the deployment story
  ever changes.
- **Classifier prompt version stamp** (§119): ✅ done 2026-08-30 —
  `CLASSIFIER_PROMPT_VERSION` in `classifier.ts`, logged on schema misses.

---

## Rejected — with reasons (do not re-adopt without a new decision)

| Doc proposal | Why not here |
| --- | --- |
| Secret store / keychain / API keys entered in UI (§8, §140) | CLAUDE.md: secrets live in `.env` only; the UI never touches them. For a localhost single-user tool this is stricter *and* simpler than the doc's assumption. |
| 6+ new tables: `ai_connections`, `ai_routing_policies`, `ai_task_routes`, `ai_pricing_snapshots`, `ai_runs`, `ai_attempts` (§7, §53–57, §110–111) | The `aiEngine` JSON column delivers ~80% of the value at ~5% of the schema — ADR 0003's "minimum moving parts" ethos. |
| Host-side Local AI Runner daemon (§86–89) | Justified for SaaS / multi-user; we are localhost single-user and official env tokens already solve Docker auth. Revisit only if the deployment model changes. |
| Per-task routing across 7+ task types (§26–27, §80) | Two roles (classifier / resume) *are* the real cost split for one user; finer routing is config for config's sake. ADR 0014 records this as a deliberate simplification (revisit = second `order` list, same shape). |
| Playwright / e2e suite (§179) | Already rejected in the §6 audits — testing philosophy is units + smoke runs + screenshots. |
| Compare / parallel mode now (§34–38) | The doc itself says Phase 4. If ever built: explicit opt-in, never average scores across engines, side effects committed once. |
