# Redesign metrics

One table per stage, same pages, same expression
([measure.js](./measure.js)), 1440×900, the dashboard built from the branch
and pointed at the live database (plan §4.2). A stage's PR body quotes the
rows it set out to move. `mainWords`, `tabStops` and `htmlKB` on `/jobs`,
`/runs` and `/companies` move with the data, so compare them only between
two measurements taken the same hour.

From stage 0 on the rows are taken by [shoot.js](./shoot.js): it evaluates
measure.js verbatim in a headless Chrome on every page below, adds the 375 px
pass, and with `--shots` saves the 1440 / 768 / 375 screenshots outside the
repository. `node docs/ui-redesign/shoot.js --label <name>` prints the table;
the header of the file has the rest.

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
the five steps; stage 0 measures each step through `/welcome?step=…`.

## Stage 0 — `redesign-baseline`, 2026-09-17

The same code as the table above plus the `data-ui` hooks; the live database a
day later (96 jobs). Nothing visible changed: on all 26 pages, and on four
more (`/jobs/new`, `/screen/new`, a targeted view, an applicant's scorecard),
the HTML the branch serves is byte for byte what `main` serves once
` data-ui="…"` is taken out — the two AI pages differ only in the CLI versions
the host and the container report.

| Page | tabStops | inDom | aboveTable | hintWords | mainWords | boxes | primaries | heightPx | htmlKB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 11 | 11 | — | 17 | 228 | 8 | 0 | 900 | 29.6 |
| `/jobs` | 81 | 150 | 30 | 2 | 1 152 | 33 | 0 | 900 | 151.7 |
| `/jobs?country=US&workplace=remote&posted=7d` | 47 | 114 | 30 | 2 | 502 | 33 | 0 | 900 | 90.2 |
| `/jobs/100` | 24 | 28 | — | 190 | 400 | 24 | 3 | 1 380 | 36.8 |
| `/applications` | 4 | 9 | — | 2 | 48 | 13 | 0 | 900 | 23.9 |
| `/resumes` | 9 | 9 | 0 | 123 | 189 | 9 | 1 | 900 | 26.6 |
| `/resumes/1` | 15 | 15 | 11 | 147 | 856 | 15 | 2 | 2 392 | 53.8 |
| `/target` | 18 | 18 | — | 192 | 614 | 20 | 0 | 1 191 | 30.4 |
| `/letter` | 23 | 25 | — | 144 | 586 | 26 | 0 | 1 282 | 32.6 |
| `/companies` | 97 | 98 | 16 | 261 | 662 | 44 | 3 | 2 782 | 100.8 |
| `/discovery` | 2 | 3 | — | 83 | 119 | 3 | 2 | 900 | 20.1 |
| `/runs` | 63 | 63 | 1 | 2 | 1 410 | 2 | 0 | 7 741 | 188.7 |
| `/settings?tab=general` | 79 | 81 | — | 261 | 927 | 78 | 2 | 2 123 | 85.8 |
| `/settings?tab=profile` | 75 | 95 | — | 314 | 700 | 42 | 1 | 2 002 | 65.4 |
| `/settings?tab=ai` | 32 | 34 | — | 377 | 543 | 34 | 4 | 2 190 | 43.6 |
| `/settings?tab=notifications` | 18 | 18 | 8 | 122 | 178 | 14 | 2 | 915 | 28.6 |
| `/settings?tab=sources` | 55 | 55 | — | 583 | 769 | 48 | 0 | 1 851 | 45.9 |
| `/settings?tab=screening` | 11 | 11 | — | 298 | 637 | 10 | 0 | 1 462 | 27.1 |
| `/welcome` | 6 | 6 | — | 8 | 63 | 6 | 1 | 900 | 20.2 |
| `/screen` | 4 | 4 | 1 | 71 | 102 | 1 | 1 | 900 | 20.7 |
| `/welcome?step=ai` | 7 | 7 | — | 21 | 95 | 7 | 1 | 900 | 21.8 |
| `/welcome?step=search` | 7 | 7 | — | 8 | 68 | 7 | 1 | 900 | 21.0 |
| `/welcome?step=profile` | 8 | 12 | — | 8 | 80 | 8 | 1 | 900 | 23.9 |
| `/welcome?step=sources` | 11 | 11 | — | 25 | 203 | 12 | 1 | 900 | 25.4 |
| `/welcome?step=matches` | 11 | 11 | — | 8 | 98 | 7 | 1 | 900 | 24.1 |
| `/screen/1` | 42 | 166 | 9 | 134 | 919 | 26 | 0 | 1 885 | 177.0 |

Every page: 4–10 requests, 5–24 KB of JavaScript, no external host, no
console error, no horizontal scroll at 1440, 768 or 375. (`/screen/new`, not
in the table, does scroll sideways at 375 — stage 2's check will meet it.)

At 375×812:

| Page | tabStops | heightPx |
| --- | ---: | ---: |
| `/` | 11 | 1 330 |
| `/jobs` | 81 | 886 |
| `/jobs/100` | 24 | 2 842 |
| `/target` | 18 | 2 318 |
| `/settings?tab=profile` | 75 | 3 344 |

**The hooks see what the classes saw.** Counted three ways on every page —
by the class selectors alone (the build before the hooks), by
`[data-ui="hint"]` alone, and by measure.js's union — `hintWords` is the same
number: 0 % apart on all 26 pages, and on the four extra ones. The four
primitives the plan named (`Hint`, the header intro, the settings section
description, the radio body) were not enough on their own: fifteen of the 26
pages read more than 5 % lower through them — the Sources tab by 72 %,
`/companies` by 42 %, the AI tab by 25 % — and the pages whose only faint
prose is the header's count or the wizard's one line (`/jobs`,
`/applications`, `/runs`, `/welcome` and three of its steps) read 0. What
closed the gap is `data-ui="hint"` on the header's `meta` line and on the raw
paragraphs and label spans the class selectors had been catching: the
Overview's tally and its three conditional lines, the wizard's five, the
Sources tab's captions, per-vendor counts and "Worth it if / In exchange"
lines, the engine description on the AI tab, the starter-pack blurbs and
counts, the watched-company line on a job page, and one paragraph each on the
targeted view, the empty Jobs table, the comparison page and the applicant's
scorecard. `shoot.js` prints "hooks vs classes" on every run, so a restyle
that drops a class without keeping the hook shows up as a line, not as a
better number.

Two things the later stages should know before they quote a row:

- The class selectors never saw most of the wizard's prose: a step's lead is
  `text-ink-muted`, and the pack blurbs on `?step=sources` are faint spans
  outside a label. The steps' `hintWords` of 8–25 undercount what a reader
  meets, so stage 6 should mark that prose first and take its "before" from
  the marked build.
- The steps were measured with setup finished and every step done — the only
  state the live database offers.

## Stage 1 — `jobs-filter-panel`, 2026-09-17

Before = the stage 0 build (the owner's dashboard), after = the branch, both
read within the same minutes on the same 96 jobs.

| Page | | tabStops | inDom | aboveTable | boxes | heightPx | htmlKB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/jobs` | before | 81 | 150 | **30** | 33 | 900 | 151.7 |
| | after | 63 | 151 | **12** | 9 | 900 | 154.1 |
| `/jobs?country=US&workplace=remote&posted=7d` | before | 47 | 114 | **30** | 33 | 900 | 90.2 |
| | after | 33 | 119 | **16** | 12 | 900 | 95.3 |

Targets: `aboveTable` ≤ 14 with nothing selected (12), ≤ 19 with three
filters (16); `inDom` ≤ 165 (151); `htmlKB` within +6 % (+1.6 %, and +5.7 %
on the filtered page — every link inside the panel repeats the query and adds
`panel=1`). With the panel open the two pages read 31 and 35: the reader asked
for the options. At 375 px `/jobs` went from 81 stops and 886 px to 63 and 764.

Nothing filters differently: eight URLs — the plan's five, plus
`profile=1&open=1`, `country=unknown&workplace=unknown&verified=1` and
`page=2` — return the same total and the same set of rows before and after,
and each status tab's count equals the total of the list it opens. The GET
form's seventeen controls are the same names, types and values.

The other 24 pages read exactly as in stage 0.

## Stage 2 — `dashboard-tokens`, 2026-09-17

This stage moves no count on purpose — it changes what the counts look like.
Its checks, on all 26 pages and on four more (`/jobs/new`, `/screen/new`, a
targeted view, a scorecard), before = the stage 1 build, after = the branch:

| Check | Result |
| --- | --- |
| `tokens.test.ts` — every ink and `accent-strong` on all four surfaces, each tone on white / its 10 % pill / its 5 % flash / the canvas, white on the solid buttons, the 3:1 focus border | 29 of 29 |
| horizontal scroll at 1440 / 768 / 375 | none (stage 0 found `/screen/new` scrolling at 375: a file input kept its intrinsic width inside the grid — fixed here) |
| `boxes` up on any page | none — equal on all 26 |
| `hintWords`, `tabStops`, `aboveTable`, `primaries` | equal on all 26; the hooks still see everything the classes see, though `Hint` no longer carries the class sizes it had |
| console errors, external hosts | none |
| `ui-review` hierarchy | `/jobs` 8.5, `/settings?tab=profile` 8 (asked: ≥ 8) |

Pages got shorter where helper prose moved from 13 to 12 px — the ladder's
`meta` step:

| Page | heightPx before | after | at 375 px before | after |
| --- | ---: | ---: | ---: | ---: |
| `/settings?tab=profile` | 2 002 | 1 916 | 3 344 | 3 140 |
| `/settings?tab=ai` | 2 190 | 2 070 | 3 628 | 3 414 |
| `/settings?tab=general` | 2 123 | 2 043 | — | — |
| `/jobs/100` | 1 380 | 1 344 | 2 842 | 2 726 |
| `/target` | 1 191 | 1 179 | 2 318 | 2 216 |

Contrast, the pairs that failed before and what they read now (WCAG 2.1, 4.5
asked): *Alerted* on its pill 4.39 → 4.97; danger on its pill 4.15 → 5.58;
faint ink on the subtle surface 4.40 → 4.78, on the selected tint 4.28 → 4.64.
One pair the plan did not list: a pill laid on the canvas instead of on white
read 4.44 for *Applied* — a pill now paints its tint over its own white
ground, so it is the tested pair wherever it sits.

