# 0014 — AI engines form a priority chain with automatic failover

**Status:** Accepted (2026-08-30). Extends 0013 (runtime selection stays in
AppSettings; a single choice becomes an ordered chain).

## Context

One selected engine (0013) means one subscription's rate limit or outage
stalls the pipeline until someone flips a switch. The owner has several
subscriptions and wants all of them attached, ordered, and switched
automatically. GPT access was missing entirely, in both its forms
(ChatGPT subscription via Codex CLI, API key via chat completions). The
0013 UI also allowed typing a wrong-family model id and rejected the save —
a dead end the UI itself created.

## Decision

- `AppSettings.aiEngine` (JSONB): `{ order: [provider ids], models:
  { <id>: { classifier, resume } } }`, replacing the three 0013 columns
  (migration backfills). NULL = one-engine chain seeded from `AI_PROVIDER`.
- Five backends behind the same `AiProvider` seam: + `openai_api`
  (native-fetch `POST /chat/completions` against `OPENAI_BASE_URL` — covers
  OpenAI, OpenRouter, Groq, local servers; no SDK) and + `codex_cli`
  (`codex exec --json`, JSONL parsed defensively).
- `src/ai-runtime.ts:getAiRuntime()` returns a chain runner:
  `complete({role, ...})` tries usable engines in order, picks the
  per-engine model for the role, and moves to the next on any null
  (error / quota / rate limit), logging each hop. Callers get
  `{text, providerId, model}`. Recovery is per call — the primary serves
  again as soon as it works. `webTools` calls prefer engines that have web
  tools (all but `openai_api`).
- Per-engine UI cards on `/settings → AI engine`: Enable/Disable, ↑
  priority, per-family model dropdowns (wrong ids unpickable; `openai_api`
  stays free-text for base-URL setups) and a live **Test** button per
  engine. Unusable-but-enabled engines are shown as "skipped".
- Setup documented per engine × (local, Docker) in `docs/ai-engines.md`.

## Consequences

✅ One dead subscription no longer stalls classification — the next engine
takes over mid-tick, automatically, and hands back when the primary recovers.
✅ Any OpenAI-compatible endpoint works without new code (base URL + key).
❌ `codex_cli` and `openai_api` could not be live-verified on this machine
(no ChatGPT login, no key) — parsers are unit-tested against documented
shapes and the per-engine Test button verifies a real setup end-to-end.
❌ Mixed-engine scoring is less comparable (prompts tuned on Claude,
gotchas 8/11); fit scores from a fallback engine may drift.
❌ One chain for both roles — a per-role order (classifier on X, resume on
Y) was deliberately left out to keep failover semantics simple.

## When to revisit

- If per-role chains are actually wanted → second `order` list, same shape.
- If a sixth backend appears (Batch API from TASKS §1.4) → one `CliSpec` /
  provider class + enum entry + probe, per 0013's extension path.
