# Architecture Decision Records

Each ADR is one screen of "we made decision X because Y, here are the
tradeoffs we accepted". They exist so future-us doesn't waste an
afternoon re-litigating a settled decision.

Format: title, status, context (what problem), decision (what we did),
consequences (what we accept). Aim for 15–30 lines each.

## Index

- [0001 — Hono not Express](./0001-hono-not-express.md)
- [0002 — Worker and web as separate processes](./0002-worker-and-web-as-separate-processes.md)
- [0003 — No queue, just node-cron](./0003-no-queue-just-node-cron.md)
- [0004 — One active profile, not multi-tenant](./0004-single-active-profile.md)
- [0005 — No LinkedIn / Indeed / Workday](./0005-no-linkedin-indeed-workday.md)
- [0006 — Discovery via HN parser, not ATS-vendor lists](./0006-discovery-via-hn-parser.md)
- [0007 — One AI provider seam: Messages API or Claude Code CLI](./0007-ai-provider-seam.md)
- [0008 — Resume module lives in the web process, files in Postgres](./0008-resume-module-in-web.md)
- [0009 — Web tools through the AI seam, for job verification only](./0009-web-tools-for-job-verification.md)
- [0010 — Two scores: live keyword coverage in the browser, AI match on demand](./0010-two-scores-live-keywords-vs-ai-match.md)
- [0011 — PDF resume text comes from unpdf, not a hand-rolled parser](./0011-pdf-extraction-via-unpdf.md)
- [0012 — The resume-match score is computed by application code, not by the model](./0012-deterministic-match-score.md)
- [0013 — AI engine is chosen at runtime from AppSettings, with a Gemini CLI backend](./0013-runtime-ai-engine.md)
- [0014 — AI engines form a priority chain with automatic failover](./0014-ai-engine-chain.md)
- [0015 — The profile is drafted from the resume scan, never written by AI](./0015-profile-draft-from-resume-scan.md)
- [0016 — Job liveness via a free three-rung ladder before AI verify](./0016-liveness-ladder.md)
- [0017 — Starter-pack entries pin a hand-verified board](./0017-starter-packs-pin-verified-boards.md)
- [0018 — Cross-listing is annotated, never merged](./0018-simhash-annotates-never-merges.md)
- [0019 — Source health is a per-company streak; `empty` resets it but does not prove health](./0019-source-health-streaks.md)
- [0020 — The fact gate blocks fabrication, not imprecision](./0020-fact-gate-blocks-fabrication-not-imprecision.md)
- [0021 — Cover letters generate from stored inputs only](./0021-cover-letters-stored-inputs-only.md)

## When to write a new one

Add an ADR when:
- The decision is non-obvious from the code alone
- A future contributor (or you, in 6 months) might reasonably want to undo it
- You can articulate at least two alternatives you considered

Skip an ADR for: dependency picks (zod, pino — obvious), code style
choices (covered in CLAUDE.md), trivial naming.
