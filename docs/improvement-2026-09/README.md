# Improvement plan 2026-09 — the analysis, one file per point

The source is [applypack-improvement-and-claude-code-audit.md](../applypack-improvement-and-claude-code-audit.md)
(an outside plan, September 2026: 30 sections — positioning, landing page,
first run, copy, metadata, five future directions, and a 25-phase audit
prompt). Every section was read against the repository as it stands at
v2.5.2 on 2026-09-10; each file below says what the plan proposes, what
the repo already has (with evidence), a verdict, and the steps — which
live in [TASKS.md §20](../TASKS.md#20-improvement-plan--full-audit-analysis-2026-09-10).
The audit itself is [audit-2026-09-10.md](../audit-2026-09-10.md).

## Verdicts

| § | Topic | Verdict | Block in TASKS §20 |
| --- | --- | --- | --- |
| [2](./02-positioning.md) | Positioning | drop — decided 2026-09-02; the alternatives are weaker | — |
| [3](./03-landing-hierarchy.md) | Landing hierarchy | done, except §6 and §13 | — |
| [4](./04-interactive-demo.md) | Demo prominent | done | — |
| [5](./05-scoring-message.md) | Scoring as the message | done; a contrast graphic is optional | `site-employers` (optional) |
| [6](./06-employer-split.md) | Employer page | **adopt** — 31 % of the landing is the other side of the table | `site-employers` |
| [7](./07-privacy-messaging.md) | Privacy | words done; **the claim needs the CDN gone** | `dashboard-self-contained` |
| [8](./08-bring-your-own-ai.md) | Bring your own AI | done | — |
| [9](./09-local-vs-self-hosted.md) | Local vs self-hosted | done; two metadata strings | `metadata-drift` |
| [10](./10-first-run.md) | First run | steps 1–4 shipped; **adopt steps 5–8** | `first-run-follow-through` |
| [11](./11-ui-copy.md) | Reduce copy | **adopt** as a per-page pass from the candidate list | `copy-pass` |
| [12](./12-preserve-explanations.md) | Preserve explanations | the guard-rail for §11 | — |
| [13](./13-demo-gif.md) | Demo GIF | **adopt** for README and drafts; the site keeps the live demo | `demo-loop` |
| [14](./14-readme.md) | README | done | — |
| [15](./15-metadata-consistency.md) | Metadata drift | **adopt** — three stale copies; extend the guard | `metadata-drift` |
| [16](./16-contribution-ux.md) | Contribution UX | one dead end (empty label); the rest verified | `metadata-drift` + owner |
| [17](./17-credibility-strip.md) | Credibility strip | done | — |
| [18](./18-founder-story.md) | Founder story | done; owner facts pending (TASKS §14) | — |
| [19](./19-search-analytics.md) | Search analytics | **adopt stage 1** — a sum over stored tick stats | `search-funnel` |
| [20](./20-skill-demand.md) | Skill demand | defer — needs one classifier field and volume; trigger written | `search-funnel` (deferred) |
| [21](./21-application-feedback.md) | Application feedback | drop — decided with a measurement (F19); trigger stands | — |
| [22](./22-coverage-map.md) | Coverage map | **adopt the flat version** as stage 3 | `search-funnel` |
| [23](./23-shareable-reports.md) | Shareable reports | drop | — |
| [24](./24-audit-areas.md) | Audit areas | ran; the coverage map says what was not | `audit-2026-09-10.md` |
| [25](./25-priority-model.md) | Priority model | adopted as the report's scale | — |
| [26](./26-audit-output.md) | Audit output | adopted in the repo's naming | — |
| [27](./27-master-prompt.md) | Master prompt | do not paste; the trimmed version is in the file | — |
| [28](./28-second-pass.md) | Second pass | already how the project works | — |
| [29](./29-immediate-priorities.md) | Priorities | replaced by the measured order | TASKS §20 |
| [30](./30-principle.md) | Principle | one sentence into PRODUCT.md | `docs-drift` |

Adopted from the plan: six blocks (`site-employers`, `first-run-follow-through`,
`copy-pass`, `demo-loop`, `metadata-drift`, `search-funnel`). Found by the
audit and not in the plan: `security-p1`, `deps-hono`, `data-integrity`,
`route-hardening`, `fetcher-dates`, `ai-provider-robustness`,
`dashboard-self-contained`, `query-diet`, `a11y-pass`, `route-smoke-ci`,
`dead-exports`, `docs-drift`. Dropped: §2, §21, §23; done already: §3, §4,
§5, §8, §14, §17, §18, §28.

The source file can be deleted once this folder is merged; nothing links to
it but this README.
