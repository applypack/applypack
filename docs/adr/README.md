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
- [0004 — One active profile, not multi-tenant](./0004-single-active-profile.md) — *superseded by 0028*
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
- [0022 — Fences make untrusted text data, and an attempt evidence](./0022-prompt-fences-for-untrusted-text.md)
- [0023 — Trust is apply-link flags, not a score](./0023-apply-link-flags-not-a-trust-score.md)
- [0024 — Funnel history is an append-only stage ledger](./0024-append-only-stage-ledger.md)
- [0025 — Work columns are user-defined; fixed entry and exits](./0025-custom-work-stages.md)
- [0026 — Database tables are snake_case, mapped with `@@map()`](./0026-snake-case-table-names.md)
- [0027 — Per-engine AI keys live in the database, `.env` as fallback](./0027-ai-keys-in-the-database.md)
- [0028 — Several searches run in parallel, scored by one call per posting](./0028-parallel-searches-one-call-per-posting.md) *(supersedes 0004)*
- [0029 — A comparison is a quick check by default; suggestions are a second call](./0029-quick-check-and-lazy-suggestions.md)
- [0030 — The strength review grades; the code scores](./0030-resume-strength-review.md)
- [0031 — A job's location is three columns next to the string, filled by hints and a parser](./0031-structured-location-columns.md)
- [0032 — A search hunts in countries and groups; the classifier's place may only narrow the parser's](./0032-profile-countries-and-the-classifier-place.md)
- [0033 — A search says where its candidate lives; the model decides whether a posting is open to them](./0033-residence-and-relocation.md)
- [0034 — A vendor's own licence governs keyed access, and the vendor's terms are code](./0034-keyed-sources.md)
- [0035 — Many installs, one set of boards: spread the tick, shuffle the walk, revalidate](./0035-many-installs-one-set-of-boards.md)
- [0036 — Watched companies are checked by reading what a site publishes for machines, never by rendering it](./0036-watchlist-reads-published-data-only.md)
- [0037 — Suggestions carry replacement text; the fact gate decides what is applicable](./0037-suggestions-carry-replacement-text-gated-in-code.md)

## When to write a new one

Add an ADR when:
- The decision is non-obvious from the code alone
- A future contributor (or you, in 6 months) might reasonably want to undo it
- You can articulate at least two alternatives you considered

Skip an ADR for: dependency picks (zod, pino — obvious), code style
choices (covered in CLAUDE.md), trivial naming.
