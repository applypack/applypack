# 0007 — One AI provider seam: Messages API or Claude Code CLI

**Status:** Accepted (2026-08-27)

## Context

Both classifier stages called `@anthropic-ai/sdk` directly and
`ANTHROPIC_API_KEY` was mandatory, so every classified job was billed per
token to the API account. The owner has a Claude.ai subscription and wanted
to run the pipeline on it instead.

Facts that shaped the decision:

- The Messages API only accepts API keys / Console OAuth. A consumer
  subscription cannot be used through the SDK.
- The only programmatic surface where the subscription is valid is Claude
  Code itself (`claude -p`, headless). Its JSON output (`--output-format
  json`) carries `result`, `is_error`, `subtype`, `api_error_status`.
- Each headless call spawns a process and carries Claude Code's own system
  prompt (~5k tokens). Measured: ~7 s per classification vs. <1 s on the
  API. The subscription also has a rolling usage window.
- Anthropic's consumer terms do not explicitly cover running a background
  service on a subscription — a grey area the owner accepts for a personal
  tool, but not something to make the default.

## Decision

Introduce `src/ai-provider.ts` with one interface:

```ts
interface AiProvider { complete(req: { system, user, maxTokens, label }): Promise<string | null> }
```

Two implementations, selected by `AI_PROVIDER` in `.env`:

| `AI_PROVIDER` | Implementation | Billing |
| --- | --- | --- |
| `anthropic_api` (default) | SDK `messages.create`, cached system prompt, one 429 retry | per token |
| `claude_code` | `execFile(claude, ['--print', '--output-format', 'json', '--model', …, '--system-prompt', …, '--tools', '', '--no-session-persistence', user])`, 90 s timeout, one retry on rate limit | subscription |

`classifier.ts` and `classifier-prefilter.ts` keep building prompts and
validating JSON with zod; they no longer import the SDK. `ANTHROPIC_API_KEY`
is required only when `AI_PROVIDER=anthropic_api`. The CLI output parser is
pure (`ai-provider-parse.ts`) and unit-tested.

On rate limit the provider returns `null`; `process-jobs` counts the job as
`classifyFailed` and does not persist it, so the next hourly tick retries.

## Consequences

✅ Switching backends is one env var; nothing else in the worker knows which
one is active.
✅ The model id moved to `CLAUDE_MODEL`, changed in one place.
✅ Docker runtime image ships the Claude Code CLI; mount `~/.claude` to use
the subscription inside the container.

❌ `claude_code` is slow: ~7 s per job on the host, 15–30 s in Docker. Since
2026-08-27 `process-jobs` and `reclassify-job` classify `AI_CONCURRENCY`
jobs at once (default 3, `src/concurrency.ts`) and persist in the original
order. Measured in Docker: per-call latency is unchanged with three
concurrent `claude` processes (16 s serial vs 11–14 s each in parallel),
~460 MB for the web container, throughput ×3. "Re-classify all" on ~750
jobs still takes over an hour.
❌ Subscription usage window can leave a tick partially classified. Jobs are
retried next tick, but alerts for them arrive late.
❌ No prompt cache on the CLI path — the ~5k-token CLI system prompt is
re-sent every call (cached server-side by Claude Code, but it still counts
toward the subscription window).

## When to revisit

- If Anthropic clarifies that headless Claude Code on a consumer plan may
  not back a background service → drop `claude_code`, keep the seam.
- If the Batch API path lands (docs/TASKS.md §1.3), it becomes a third
  implementation behind the same interface.
