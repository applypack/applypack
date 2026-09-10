# §29 — Recommended immediate priorities

**Verdict: replaced by the measured order in TASKS §20.**

The plan's fifteen-item list is generic (audit everything, fix P0/P1, verify
installation, scoring, failover, injection, blind mode, metadata, copy, dead
code, e2e tests, landing hierarchy, GIF, employer split, analytics). Against
this repo on 2026-09-10:

| Plan item | State | Where |
| --- | --- | --- |
| 1–2 audit, P0/P1 | this pass found no P0; the P1/P2 list is in the audit report | `audit-2026-09-10.md` |
| 3 installation / first run | verified in §14 (2026-09-02) and by the fresh baseline on 2026-09-09; not re-run | — |
| 4 scoring paths | unit-tested (`score.test.ts`, parity test, matrix / variance scripts); hand-run tools exist | — |
| 5 provider failover | code-inspected (audit report, AI section); a live failover test needs keys → owner | needs-maintainer-review |
| 6 prompt-injection boundaries | guarded by `prompt-fence-registry.test.ts`, broken on purpose in the 2026-09 audit | — |
| 7 blind-mode privacy | `redact.test.ts` + `findLeaks` at intake; the batch path re-read in this audit | audit report |
| 8 metadata drift | real: package.json 24, GitHub 22, launch drafts 22 | block `metadata-drift` |
| 9 copy | candidate list produced | block `copy-pass` |
| 10 dead code | 10 dead exports, 84 over-exported | block `dead-exports` |
| 11 e2e tests | rejected as Playwright (TASKS §17.2); the gap is 144 routes with zero automated requests | block `route-smoke-ci` |
| 12 landing hierarchy | done except the employer section | block `site-employers` |
| 13 GIF | none exists | block `demo-loop` |
| 14 employer split | not done | block `site-employers` |
| 15 analytics | stage 1 is a sum over stored stats | block `search-funnel` |

Plus two the plan could not know: the dashboard's CDN dependencies
(`dashboard-self-contained`) and the `hono` advisories (`deps-hono`).
