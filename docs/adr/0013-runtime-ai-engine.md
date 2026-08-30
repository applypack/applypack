# 0013 — AI engine is chosen at runtime from AppSettings, with a Gemini CLI backend

**Status:** Accepted (2026-08-29). Extends 0007 — the seam is unchanged, the
selection mechanism moves from `.env`-only to DB-with-`.env`-fallback.

## Context

ADR 0007's seam was selected once per process by `AI_PROVIDER` in `.env`, so
changing the engine or a model id meant editing `.env` and restarting
containers — against the dashboard rule that toggles live in Postgres and
apply on the next tick (CLAUDE.md gotcha 9). The owner also wants non-Claude
subscriptions selectable. The Gemini CLI is the same headless pattern as
Claude Code: JSON on stdout, one process per call, billed to a Google
subscription or `GEMINI_API_KEY`. Model needs differ per task: cheap,
frequent classifier calls vs a few judgment-heavy resume calls.

## Decision

- Three nullable `AppSettings` columns: `aiProvider`, `aiModelClassifier`,
  `aiModelResume`. NULL = follow `.env` (`AI_PROVIDER`, `CLAUDE_MODEL`,
  `CLAUDE_MODEL_RESUME`).
- `src/ai-engine.ts:resolveAiEngine` merges row + env, pure and unit-tested:
  unknown provider, blank/wrong-family model, or `anthropic_api` without a
  key fall back — a stale row can never leave the pipeline engineless.
- `src/ai-runtime.ts:getAiRuntime` reads the row per call and hands callers
  `{ provider, classifierModel, resumeModel }`. Worker follows on the next
  tick; dashboard actions immediately.
- `gemini_cli` joins as a third backend via a generic `CliProvider`:
  `gemini --output-format json -m <model> -p "<system>\n\n<user>"`, cwd set
  to tmpdir so it cannot ingest workspace context, tools denied by default,
  `--allowed-tools google_web_search web_fetch` only when `webTools`.
- `/settings → AI engine`: provider radios with availability badges from
  `probeAiProviders()` (API key present / CLI on PATH / gemini auth
  configured), two model inputs with suggestions. The POST validates the
  model family; a not-yet-usable engine still saves (warn flash + card
  banner) — `resolveAiEngine` keeps the pipeline on a usable fallback and
  switches over the moment auth appears.

## Consequences

✅ Engine and model switch without restarts; resolution is one indexed read
per call against multi-second AI calls.
✅ A future backend is one `CliProvider` spec + enum value + probe entry
(e.g. the Batch API from TASKS §1.4, or Codex CLI).
❌ Prompts are tuned against Claude (gotchas 8 and 11); another engine may
score or parse worse. Zod validation + one retry contain that, not prevent it.
❌ Gemini's success path is not yet live-verified here (CLI installed but
never logged in); its error path is verified against the real binary.
❌ Runtime image grows by the Gemini CLI install.

## When to revisit

- Batch API path lands → fourth implementation behind the same seam.
- A third per-task model split (e.g. a dedicated verification model) →
  another column, not another env var.
