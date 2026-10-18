# 0055 — Every AI attempt is a ledger row, and a bill, a plan and a local model are never added together

**Status:** Accepted (2026-09-28) — owner decisions recorded in the 2026-09 plan (Q28: a labelled estimate never summed with billed money; the admin key stays outside the database; a budget line with an alert)

## Context

Until 2.21.0 ApplyPack counted **runs**: `AppSettings.aiUsage` held a
number per day, engine and role, incremented only when an engine answered,
and the AI engine tab showed seven days of it. Nothing was priced and
nothing was per feature. The token counts most engines report were read at
the provider boundary and dropped one layer up; a failed attempt (a
timeout, a cut-off reply) left no trace at all, although a cut-off reply is
billed in full.

Three facts decided the shape, each read on the vendors' own pages on
2026-09-28:

- **There are three kinds of money.** An API key is billed per token. A
  subscription CLI (Claude Code, Codex, the Gemini CLI on a Google login)
  is covered by a flat plan — the only honest dollar figure is what the call
  would cost on the API. A local model behind the OpenAI-compatible engine
  costs nothing per call. A user who pays a flat $20 plan and sees
  "$14.20 this month" will rightly call the number wrong.
- **The vendors report usage on failures too.** The Messages API's `usage`
  arrives with `stop_reason: max_tokens` and `refusal`; the Claude Code
  CLI's result message carries `usage`, `total_cost_usd` and `modelUsage`
  on success and error results alike; chat completions carry `usage` with
  `finish_reason: length`. The CLI's `total_cost_usd` is its own
  client-side estimate from a bundled price table — useful, not a bill.
- **Prices move and differ per model**, and not only in the headline
  rates: a cache read is 0.1× input, 0.05× on Opus 5.5 and 0.025× on
  Fable 5.1; a one-hour cache write is 2× input, and the Claude Code CLI on
  a plan writes for an hour; web search is $10 per 1,000 searches, web
  fetch is free; Gemini Pro charges more for a prompt over 200k tokens.

## Decision

- **One `ai_call` row per attempt**, written by the runtime seam
  (`ai-runtime.ts`) for every engine the chain tries — the failed ones too —
  and by the engine Test button. Metadata only: the engine, the model asked
  for and the one the vendor says ran, the feature, how it ended
  (`ok · rate_limited · timeout · cut_off · refused · empty · error`), the
  tokens by kind, the searches, the posting and the resume it served where
  the caller knows. Never a prompt, never a reply.
  *Amended 2026-10-11 (v2.55.33, #413).* Two failures that never reach a
  model were both `error`, and the advice for either was "try another
  model": no server answering at the address is `unreachable` now, and a
  prompt larger than the local model's context window — refused before it
  is sent — is `too_large`. Rows written before keep `error`. And the
  ledger is read for one thing more than money: each engine's last attempts
  (`ai-ledger.ts:loadRecentAttempts`, a week back, twenty an engine) say
  whether it is failing *now* — one refused sign-in, or three failures in a
  row with no answer between (`ai-health.ts`, pure). The engine's card and
  the AI usage page say so before anything else; the probe behind
  "available" reads what is on disk and cannot. A reply that does not parse
  is still `ok` here (#463) — until the 2026-10-18 addendum.
- **What the vendor did not report is NULL, never 0.** A timeout has no
  usage; a local server has usage and no price. `AiProvider.complete()`
  returns an attempt `{ text, outcome, spend }` instead of a string, and
  each parser declares the usage fields it can see.
- **The feature is a closed set** (`ai-usage.ts`): the label every call
  site already passed for its log line, typed, so a new call site does not
  compile until it is named — the fence registry's pattern (ADR 0022).
- **Money is ours, from a dated table, beside the vendor's own figure.**
  `src/ai-prices.ts` holds USD per million tokens — which is micro-dollars
  per token, so a cost is an integer sum — with `PRICES_AS_OF` on the table
  and on every row it priced, so a price change never re-prices history. A
  model the table does not know is **not priced**, never $0, and the page
  says so. The vendor's figure (OpenRouter's `usage.cost`, the CLI's
  `total_cost_usd`) is stored as `reportedMicroUsd`; where we have no price
  and the vendor sent one, the page reads theirs.
- **Whose money a row spends is decided per call** (`billingOf`): the
  Anthropic API and an OpenAI-compatible server on the internet are
  `billed`, the Gemini CLI is `billed` with a key and `plan` without one,
  Claude Code and Codex are `plan`, and an OpenAI-compatible server on this
  machine or a private network is `local`. The page shows three totals and
  **never adds them**; the "where the money goes" sentence is computed
  inside one kind. This replaces the static `PROVIDER_PAID` flag, which
  called a keyed Gemini free and a local server paid.
- **A monthly budget warns and never stops.** `AppSettings.aiBudgetCents`
  is a ceiling on billed money in the UTC month; at 80 % and at 100 % one
  line goes to the alert chats, once each a month — the worker and the
  dashboard both spend, so a conditional update on
  `AppSettings.aiBudgetAlerted` decides which of them sends. A missed match
  costs more than a cent, so nothing is ever refused.
- **The admin key never enters ApplyPack.** It reads a whole organisation's
  usage, it is needed only to compare, and a fourth secrets carve-out for a
  hand-run check is not worth it. `npm run spend:report` prints the ledger
  per UTC day, engine and model, tab-separated, for a comparison with the
  vendor's own report by hand; the aborted calls are its first explanation
  of any difference.
- **The ledger answers where the user decides.** The per-posting row
  ("AI spent") and the estimate under Compare, Verify and Generate letter
  (the middle of the last twenty calls of that feature that answered, on
  the money they spent) read the same rows — no call is spent to show them.
- **Retention: 400 days** in `cleanup-job.ts`, long enough for "this year".
  `AppSettings.aiUsage` is retired: nothing reads or writes it; the column
  is dropped in a later release, so a rollback to 2.20 still finds it.

## Consequences

- ✅ "How much did cover letters cost me this week?" is one period and one
  row; the three kinds of money cannot be mistaken for one bill.
- ✅ A cut-off reply, a refusal and a timeout are on the record, so a
  difference from the vendor's dashboard has somewhere to start.
- ✅ The Test button's calls count: they are real calls on real money.
- ✅ The estimate before an expensive button turns spend into a choice made
  before the click.
- ⚠️ Our price is only as current as the table. A stale table shows as
  "not priced" for a new model, not as a wrong number for an old one; a
  changed rate needs a new dated row, by hand.
- ⚠️ A call the runtime timed out may still have completed and been billed;
  the ledger cannot know. The page and the report count those calls
  separately rather than pretend.
- ⚠️ The classifier's calls for new postings carry no posting id — the
  posting does not exist yet when it is scored — so the per-posting row
  counts the analyses of that posting, not its first scoring. *(Lifted by
  the 2026-10-18 addendum.)*
- ⚠️ Codex names no model in its events: a Codex call on the CLI's own
  default model is "not priced".
- The comparison with a vendor's report through its admin API is not built:
  it needs an organisation admin key to verify against, and the hand-run
  report covers the question until one is at hand.

## Addendum (2026-10-18): two updates, for what is known only after the row

The ledger was append-only. Two facts arrive after an attempt's row is
written, and each now updates that row; nothing else ever does
(`ai-ledger.ts:markUnparsed`, `attributeCalls`). The runtime hands every
caller the ids of the rows its call wrote (`AiCallResult.ledgerIds`: the
failed attempts, then the answer's), which is how the caller finds them.

- **A reply the caller could not read is `unparsed`** (#463). The row is
  still written when the transport answers, so a crash before the caller
  has read the reply still leaves it on the record — the reason the row is
  not written after the caller's verdict instead. `askForJson`, the
  classifier, the prefilter and the posting extract call
  `AiRuntime.unparsed`, which turns the answer's row from `ok` to
  `unparsed` (an `ok` row only). It is a failure wherever failures are
  counted: the AI usage table, the failure hint, and an engine's trouble on
  its card (`ai-health.ts`), whose advice for it is another model — the one
  ending where that advice is right, and one Test cannot show, since it
  asks for a single word. A retry after a bad reply is a row of its own, as
  before.
- **The posting a tick scored is named on its calls afterwards** (#483). A
  re-classify knows its posting and passes it as the call's subject. The
  tick scores a posting before its row exists: the classifier returns the
  ids of every call it made with its verdicts, and `process-jobs.ts`
  stamps them with the job once the row is inserted (rows with no job
  only). The job page's **AI spent** counts the scoring now. Not named: the
  attempts of a chain in which no engine answered (a posting whose scoring
  failed is not stored, and a failed prefilter falls open to a classifier
  call that is named), and the posting extract before a pasted or saved
  posting is stored.
