# 0057 — A model on this machine is an engine of its own, and it is held to its window

**Status:** Accepted (2026-09-28). Stage B of the feature-gap analysis's local-model
proposal (docs/feature-gap-2026-09, not published), after stage A shipped in
v2.28.0: the OpenAI-compatible engine got a server address on the AI tab and
stopped asking a local server for a key. Extends ADR 0013/0014 (the engine
chain); the robots rule it relies on is ADR 0036's addendum of the same day.
Extended by [0060](./0060-an-engine-takes-the-tasks-it-is-given.md) (the
tasks a local model takes are a list on its card).

## Context

Stage A made a local model reachable. It did not make it dependable, for
five reasons that sit in the OpenAI-compatible route itself:

- **The context window.** Ollama's `/v1/chat/completions` runs every request
  at the server's default window and takes no per-request setting. A prompt
  longer than that window is not refused: the server cuts it from the start
  — our system prompt, the rules — and answers anyway. A full resume
  analysis is 7–10k tokens of prompt before the answer.
- **One engine slot.** `openai_api` serves one address. A chain could not
  hold a hosted OpenAI-compatible endpoint and a local server at once.
- **JSON.** Every call ApplyPack makes but the connectivity test parses JSON.
  Frontier models keep to it on instructions alone; small local ones are
  where a server-side constraint pays.
- **Concurrency.** `AI_CONCURRENCY` (3) was sized for hosted APIs. Three
  generations on one consumer GPU each run at a third of the speed, and all
  three meet their timeouts together.
- **Time.** Timeouts are sized for hosted calls, and Node's fetch gives up
  after five minutes without response headers whatever our own timer says —
  which is what a non-streamed reply looks like while a local model writes.

## Decision

- **`local_api` is an engine of its own:** "Local model (Ollama)", beside the
  other five in the chain. It speaks Ollama's native `POST /api/chat`, the one
  route that takes `options.num_ctx`. Its address is `AppSettings.localAiUrl`
  (`OLLAMA_URL` the fallback), and must be on this machine or the user's own
  network (`ai-usage.ts:checkLocalAiUrl`): the engine is called local because
  it is. So it is billed as local, and it binds no robots.txt token.
  LM Studio and the rest stay on the OpenAI-compatible engine.
- **The window is set on every call** (`AppSettings.localContextTokens`,
  8k / 16k / 32k / 64k, 16k by default). **A prompt that does not fit is
  refused before it is sent** (`ai-provider-parse.ts:localBudgetTokens`), with
  a reason, and the chain moves to the engine behind. A refusal costs one
  failover; a truncated prompt answers without its rules and nobody sees it.
  The estimate is cautious on purpose: 3.5 characters a token for Latin
  text, 1.5 for anything else, because a Cyrillic resume is the common case
  it would otherwise wave through.
- **JSON mode** (`format: "json"`) is asked for where the caller parses
  JSON. That is `AiRequest.json`, set by `askForJson`, the classifier, the
  prefilter and the posting extractor. It is ignored by every other engine.
- **The reply is streamed.** Headers arrive at once, so a long generation
  meets only our own timer. The stream is read whole and parsed line by line
  (`parseOllamaStream`): `done_reason: "length"` is a cut-off, an `error`
  line is a failure, and a thinking block a model still inlines is dropped.
- **One call at a time per server** (`LOCAL_CALLS_AT_ONCE`). The rest wait
  their turn inside the provider, so `AI_CONCURRENCY` keeps meaning "calls
  in flight to hosted engines".
- **Three times the clock** (`ai-failover.ts:ENGINE_TIME_FACTOR`). A local
  attempt gets three times the per-attempt budget, including its wait in the
  queue, and the chain's deadline grows with it, so the engine behind still
  has its own.
- The wizard's "A model on this computer" card uses Ollama through this
  engine and LM Studio through the OpenAI-compatible one. The AI tab's card
  carries the address, the window, and the models `/api/tags` lists.

## Consequences

✅ A local model stops failing silently. A prompt larger than the window is a
named failure, and the next engine gets the call.
✅ One chain can hold a local model and a hosted OpenAI-compatible endpoint.
✅ No new dependency. Ollama's API is plain HTTP and NDJSON, parsed by zod
like every other reply.
❌ Ollama only. LM Studio's context is set when the model is loaded, and the
OpenAI-compatible engine does not guard it. Its docs say so.
❌ The estimate is not the tokenizer. It refuses some prompts that would
have fit. A refusal is visible and recoverable, so this is the right side to
err on.
❌ No measured model table yet. Which local models clear the bar on our
schemas is stage C of the same analysis. Until then the docs name no model
as recommended; the setup copy names `llama3.1:8b` only as a command to
paste.
❌ A reply that does not parse is still asked again of the same engine
(`ai-json.ts`), not failed over. That is the same for every engine; a
change there is its own decision.

## When to revisit

When stage C measures the local models: a recommended default and a preset
("the classifier here, resume work on my subscription"). The chain's order
is global today, so such a preset needs a per-role order, and that would be
a new decision. Also revisit when a second local server with its own native
API is asked for.
