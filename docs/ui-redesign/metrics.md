# Redesign metrics

One table per stage, same pages, same expression
([measure.js](./measure.js)), 1440×900, the dashboard built from the branch
and pointed at the live database (plan §4.2). A stage's PR body quotes the
rows it set out to move. `mainWords`, `tabStops` and `htmlKB` on `/jobs`,
`/runs` and `/companies` move with the data, so compare them only between
two measurements taken the same hour.

## Baseline — main at v2.10.0, 2026-09-16

Measured by the planning session. Stage 0 measures again on the day the work
starts, adds the 375px pass and the screenshots, and marks the primitives
with `data-ui` so the helper-prose count survives the restyle.

| Page | tabStops | inDom | aboveTable | hintWords | mainWords | boxes | primaries | heightPx | htmlKB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 11 | 11 | — | 17 | 210 | 8 | 0 | 900 | 29.4 |
| `/jobs` | 81 | 150 | 30 | 2 | 1 123 | 33 | 0 | 900 | 151.1 |
| `/jobs?country=US&workplace=remote&posted=7d` | 51 | 117 | 30 | 2 | 562 | 33 | 0 | 900 | 97.5 |
| `/jobs/100` | 24 | 28 | — | 190 | 400 | 24 | 3 | 1 380 | 36.7 |
| `/applications` | 4 | 9 | — | 2 | 48 | 13 | 0 | 900 | 23.9 |
| `/resumes` | 9 | 9 | 0 | 123 | 189 | 9 | 1 | 900 | 26.5 |
| `/resumes/1` | 15 | 15 | 11 | 147 | 856 | 15 | 2 | 2 392 | 53.7 |
| `/target` | 18 | 18 | — | 192 | 601 | 20 | 0 | 1 191 | 29.9 |
| `/letter` | 23 | 25 | — | 144 | 573 | 26 | 0 | 1 282 | 32.2 |
| `/companies` | 97 | 98 | 16 | 261 | 662 | 44 | 3 | 2 776 | 100.5 |
| `/discovery` | 2 | 3 | — | 83 | 119 | 3 | 2 | 900 | 20.1 |
| `/runs` | 62 | 62 | 1 | 2 | 1 409 | 2 | 0 | 7 759 | 190.2 |
| `/settings?tab=general` | 79 | 81 | — | 261 | 927 | 78 | 2 | 2 123 | 85.5 |
| `/settings?tab=profile` | 75 | 95 | — | 314 | 700 | 42 | 1 | 2 002 | 65.0 |
| `/settings?tab=ai` | 32 | 34 | — | 377 | 543 | 34 | 4 | 2 190 | 43.2 |
| `/settings?tab=notifications` | 18 | 18 | 8 | 122 | 178 | 14 | 2 | 915 | 28.5 |
| `/settings?tab=sources` | 55 | 55 | — | 583 | 769 | 48 | 0 | 1 850 | 45.2 |
| `/settings?tab=screening` | 11 | 11 | — | 298 | 637 | 10 | 0 | 1 462 | 26.9 |
| `/welcome` | 6 | 6 | — | 8 | 63 | 6 | 1 | 900 | 20.1 |
| `/screen` | 4 | 4 | 1 | 71 | 102 | 1 | 1 | 900 | 20.7 |

Every page: 4–10 requests, 5–24 KB of JavaScript, no external host.

`/welcome` was measured with setup finished, so it shows the summary, not
the five steps; stage 6 measures each step on the scratch install.
