# 0008 — Resume module lives in the web process, files in Postgres

**Status:** Accepted (2026-08-28)

## Context

The owner keeps a resume-tailoring workflow as a Claude Code skill
(`linkedin-radar/.claude/skills/job-apply`): Markdown rulebooks plus nine
Python scripts that patch a `.docx`. It is interactive (asks mid-run,
uses WebSearch, renders through Pages/Word on macOS) and has no UI. The
ask was to get the "compare my resume with this posting and tell me what
to change" half into the dashboard.

Constraints that shaped the decision:

- The worker must stay an HTTP-free cron process ([ADR 0002](./0002-worker-and-web-as-separate-processes.md)).
- The two containers share nothing but Postgres — no shared volume.
- `AiProvider.complete(system, user)` is the only Claude surface; no tools,
  no mid-run dialogue ([ADR 0007](./0007-ai-provider-seam.md)).
- The runtime image is `node:24-alpine` — no Python.

## Decision

- **Where it runs:** on demand in the web process, synchronously inside the
  request (`POST /resumes`, `POST /resumes/:id/rescan`, `POST /jobs/:id/match`).
  A comparison is one call, ~1 min, a few times a day; no cron, no queue.
- **Where files live:** `Resume.original` (`Bytes`) and `Resume.text` in
  Postgres. Both containers already reach it, `pg_dump` covers it, and
  resumes are ~50 KB each.
- **Text extraction in-house:** `src/resume/zip.ts` (60-line zip reader over
  `node:zlib`) + `src/resume/docx-text.ts` (regex over WordprocessingML).
  `.docx`, `.md`, `.txt` only — PDF needs a parser dependency and is deferred.
- **AI shape:** the skill's rulebook became one system prompt
  (`src/resume/prompts.ts:MATCH_SYSTEM`) that returns JSON: keywords with
  `present | add | cannot_claim`, an `actions` list (section, where, what,
  why, priority), strengths, red flags, score. `cannot_claim` replaces the
  skill's "ask Nazar mid-run" — the truthfulness rule is enforced by the
  schema, and the user sees what was not claimed.
- **Model:** `CLAUDE_MODEL_RESUME` (default `claude-opus-5`), passed per
  request through a new optional `AiRequest.model`. The classifier keeps
  Haiku; resume work is low-volume and judgment-heavy.
- **Out of scope for now:** editing or generating the resume (`.docx`
  patching, PDF), ghost-job verification (needs web tools), profile
  bootstrap from resumes.

## Consequences

✅ Zero new dependencies; the pure pieces (zip, docx text, prompts, pick)
are unit-tested like the fetcher mappers.
✅ The dashboard shows the whole to-do list per job: what to add, where,
why, and what it must not claim.
❌ The web process now makes multi-minute AI calls inside a request; a
browser tab has to stay open. Acceptable for one user; an async run with
`/runs` tracking is the upgrade path if it becomes annoying.
❌ Resumes (PII) are in the database dump. The dashboard is bound to
`127.0.0.1`; anyone sharing `pgdata` shares the resumes.
❌ Python `.docx` patching stays in the CLI skill until it is ported to
TypeScript (only three of the nine scripts are generic).
