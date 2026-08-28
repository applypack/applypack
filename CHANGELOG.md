# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-08-28

First tagged release. Everything below was designed and built between
2026-04-26 and 2026-08-28 by a single author (AI-assisted; every non-obvious
decision is recorded in [docs/adr/](./docs/adr/)). The phase labels match the
commit history.

### Dashboard
- Light-theme redesign of every page: shared layout, design tokens, tables,
  forms, empty states, mobile job header.
- Overview with status counters, recent alerts and cron health.
- Jobs list (filter / sort / paginate), job detail with Claude output,
  status actions and re-classify.
- `/jobs/new` — paste a posting the fetchers cannot see; it is classified like
  any other.
- Applications kanban (applied → screen → tech → onsite → offer / rejected /
  ghosted) with a stale-applications digest.
- Companies page with manual add and a live ATS probe before save; per-row
  toggle and delete.
- Discovery review page for companies harvested from HN comments.
- Runs log, settings (profiles, toggles, Telegram targets, source families),
  `/health` JSON endpoint, optional HTTP Basic Auth.

### Resume module
- Upload `.docx` / `.md` / `.txt`; pure zip + docx text extraction with tests.
- One-time AI scan per version: headline, seniority, skill tags, ATS issues.
- Resume-vs-job comparison with a fixed rubric: match score, red flags,
  prioritised to-do list, keyword coverage (`present` / `add` / `can't claim`),
  removals; version-over-version delta.
- Targeted view: posting and resume side by side, keyword highlights, in-place
  editing with a live keyword-coverage score computed in the browser, AI
  re-analysis, save as new version (ADR 0010).

### Job verification
- "Is this job real?" — ghost-job checklist run with web search through the
  AI seam; verdict `legit` / `suspicious` / `fake`, recommendation, confidence
  and evidence URLs (ADR 0009).

### Classifier and AI backend
- Profile-driven Claude classifier with explicit tech-stack vs role-type and
  country-lock rules.
- Optional two-stage mode: short cached prefilter prompt, full prompt only for
  survivors.
- Priority rules: post-classification fit-score floor per profile.
- Single AI provider seam (`src/ai-provider.ts`): Anthropic Messages API or
  Claude Code CLI on a subscription (ADR 0007).
- Concurrency limiter (`AI_CONCURRENCY`) for fetch ticks and re-classify.
- Configurable models per task (`CLAUDE_MODEL`, `CLAUDE_MODEL_RESUME`).

### Sources
- Per-company: Greenhouse, Lever, Ashby, Workable, SmartRecruiters.
- Cross-company: LaraJobs, RemoteOK, Remotive, Jobicy, Arbeitnow,
  WeWorkRemotely, Golangprojects, Working Nomads, Himalayas, HN
  "Who is hiring", HN /jobs.
- Universal ATS-URL discovery from HN text; candidates reviewed on
  `/discovery` and promoted with one click.
- Per-source-family toggles and a global "pause fetching" switch
  (deployments start paused).
- Policy: official public APIs and RSS only; no LinkedIn / Indeed / Glassdoor /
  Workday / Wellfound (ADR 0005).

### Worker and infrastructure
- Separate cron worker and dashboard processes sharing Postgres (ADR 0002);
  node-cron, no queue (ADR 0003).
- Prisma migrations baseline; `init.ts` applies migrations and seeds on boot.
- Multi-stage Dockerfile on `node:24-alpine`, docker-compose with Postgres 16.
- Telegram alerts and daily digest; targets managed from the dashboard.
- GitHub Actions CI: type check, unit tests, `prisma validate`, format check.
- Documentation set: SPEC, ARCHITECTURE (Mermaid), CLAUDE.md conventions and
  gotchas, ten ADRs.

### Milestones

| Date | Milestone |
| --- | --- |
| 2026-04-26 | Initial worker + dashboard, CI, migrations baseline |
| 2026-04-27 | Two-stage classifier, HN parser, application tracking, discovery, priority rules, docs set, ADR 0001–0006 |
| 2026-04-28 | Fetcher fixes (LaraJobs namespace, Lever re-seed) |
| 2026-04-29 | Pure fetcher mappers + tests, Jobicy, HN /jobs, universal ATS discovery |
| 2026-08-27 | Node 24, pause toggle, AI provider seam, first dashboard redesign, parallel classifier |
| 2026-08-28 | Resume module, targeted view, ghost-job verification, light-theme redesign — **v0.1.0** |

[Unreleased]: https://github.com/nazboyko/job-hunter/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nazboyko/job-hunter/releases/tag/v0.1.0
