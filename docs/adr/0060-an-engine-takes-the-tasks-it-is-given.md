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
