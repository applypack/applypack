# 0060 — An engine takes the tasks it is given, and the order decides among those that take one

**Status:** Accepted (2026-10-05). Extends [0014](./0014-ai-engine-chain.md)
(the priority chain and its failover) and
[0057](./0057-a-local-model-is-an-engine-of-its-own.md) (a model on this
machine as an engine).

## Context

The chain of ADR 0014 is one order for every AI call. What varies by call is
the model, through three slots per engine (classifier, resume, cover). That
was enough while every engine was a frontier model.

It stopped being enough with ADR 0057. A small model on the user's machine is
a reasonable choice for the hourly scoring and a poor one for a 7–10k-token
resume analysis or a cover letter, and the chain could not say so:

- Put the local engine first and it is asked for everything. The window guard
  refuses the large prompts, and each refusal costs a failover.
- Put it last and it is asked only when the others fail. A letter then falls
  to the weakest model exactly when nobody is watching.

The same holds between two subscriptions: scoring on one plan and letters on
another could not be expressed.

One owner's ledger, eight days of October 2026: 395 of 429 calls were the
classifier. Volume and quality sit in different calls, which is the case for
routing them apart.

Alternatives considered:

- **A task → engine picker** (one select per task). It reads well for one
  task and hides the fallback: the select names a single engine, and what
  happens when it fails needs a second control.
- **"Goes first for" on an engine**, leaving it a fallback for everything
  else. It cannot say "this model never writes a letter", which is the
  restriction a small model needs.

## Decision

- **A task is a group of AI features a person would hand to one model
  together.** Six of them (`src/ai-tasks.ts`): scoring postings, reading a
  resume, resume analysis, cover letters, the web check, screening
  applicants. The ledger keeps its seventeen features; `taskOf(feature)` is a
  closed table, so a new call site does not compile until it names its task.
- **Each engine has a list of the tasks it takes**, stored beside the order
  in `AppSettings.aiEngine` as `tasks: { <engine>: [...] }`. An engine with
  no entry takes every task. A stored chain from before this ADR therefore
  behaves as it did, and no migration runs.
- **A call is run down the engines that take its task, in priority order**
  (`ResolvedAiEngine.chainFor`, used by `ai-failover.ts:runChain`). An engine
  that does not take the task is not asked first and is not its fallback.
  Web-tool preference, cooldowns, the switch limit and the deadline apply to
  that narrower list as they did to the whole one.
- **A task no usable engine takes is answered by the whole chain.** A
  narrowed list never leaves the pipeline without an engine: the hourly tick
  must not stop because a box was unticked. The AI tab says which tasks are
  in that state.
- **Every box ticked is stored as no list.** An engine left on "everything"
  takes a task a later version adds. An engine that cannot search the web is
  not offered the web check.
- **An engine never takes a task it is not offered.** With no list, an engine
  without web search still does not take the web check, so that task cannot
  fall to it alone because the box was unticked elsewhere. A task counts as
  unclaimed only when an engine that could take it stands in the list.
- **Screening has a box only while employer mode is on.** Until then an
  engine's first narrowed list sends it where Resume analysis goes
  (`web/ai-plan.ts:pickedTasks`): the same kind of reading on the same model
  slot, so an engine narrowed to scoring is never handed other people's
  resumes by a box nobody could see. An engine that already has a list keeps
  its choice, which may have been made on purpose.
- **The AI tab shows the result, not the rule**: one row per task with the
  engine and model that answer it first and the ones behind it
  (`ai-engine.ts:taskPlans`). The ledger's `viaFallback` is read against the
  same first engine: the first that takes the call's task and, for a call
  that searches the web, the first of those that can.

## Consequences

✅ "A local model scores, my subscription writes" is two clicks: the local
engine first, with one box left ticked.
✅ A restriction holds under failure. A model unticked for letters does not
write one because the engine above it hit a rate limit.
✅ No schema change and nothing to migrate.
❌ Order and task lists interact. An engine narrowed to one task has to stand
above the general one to be asked first; the table is there so the user reads
the outcome instead of working it out.
❌ The model slots stay three per engine. Two tasks that share a slot (the
web check and the resume analysis) run on the same model of an engine.
❌ Nothing here says which model is good enough for which task. That is a
measurement (ADR 0057, stage C), and the tab makes no recommendation.

## When to revisit

When a task needs a model of its own inside one engine (a slot per task), or
when measured results exist that would justify a default list for a kind of
engine.

## Addendum (2026-10-18): "Use it" gives a local model scoring alone

The wizard's **Use it** on a model found on this computer
(`ai-engine.ts:withEngineFirst`) put it first with its model in every slot
and lifted any list it had, so it answered every task: the analysis, the
letters, screening and the packs prepared with nobody watching. Measured on
`gemma4:e4b` (#411), scoring is the task it suits: the resume scan kept 53
skills of Claude's 73, the shape kept 2 roles of 6, the brief came back with
six keywords and no groups, a full comparison did not fit a 16k window, and
the letter was generic.

**Use it** now stores `tasks: ['scoring']` for that engine
(`LOCAL_MODEL_TASKS`; reading a pasted posting is part of scoring), and the
flash says the other tasks are a tick away on its card. They go to the
engines behind it, which bills them where an API key stands there: a
decision about spend, taken for quality as the default. An install where the
local model stands alone, or where nothing behind it can run, is answered as
before, since a task no usable engine takes goes to the whole chain; the AI
tab names those tasks. Marking on the card a task whose prompt cannot fit the
window is a separate change.

## Addendum (2026-10-18): an engine is tried on the user's own postings

The third ❌ above now has a measurement behind it, for scoring (#412).
**Try it on my postings**, under an engine's tasks, scores up to 20 stored,
scored postings again on that engine and its classifier model and sets the
result beside the scores on record: agreement on each search's threshold as
it stands now, false and missed matches, the mean fit distance, the seconds
per posting, replies that were no score, and how many scores on record
predate the search's last edit.

- **One engine, no fallback.** `AiCallRequest.engine` sends the call to that
  engine alone, whatever the chain and the task lists say: an engine behind
  it that answered would measure the wrong model. Every call is in the
  ledger as `engine-trial`, which belongs to no task, as `engine-test` does;
  the hints leave both out of the usage they read.
- **The record is the reference, not the truth.** The trial compares; it
  never says a model is good enough, and it changes no task list. The AI
  usage hints quote the last trial where they offer a local model the
  scoring, instead of "not measured".
- **The last result per engine and model** is a row in `engine_trial`,
  counts only — no posting, no reply.
- **Scoring only.** Reading a pasted posting, the issue's last bullet, would
  compare the extracted title and company with the stored row; it is not
  built. The other tasks have no answer on record to compare with.

## Addendum (2026-10-19): screening follows Resume analysis on every save

"An engine that already has a list keeps its choice" did not hold up (#551):
unticking Reading a resume, then Resume analysis, then Cover letters, one
save each, left Screening ticked on the local model — the first save, made
while Resume analysis was still ticked, put it there, and every later save
kept it. While employer mode is off, every save now sends Screening where
Resume analysis goes. With employer mode on, its own box decides, as before.
