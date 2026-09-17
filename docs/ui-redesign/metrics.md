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

## Stage 3 — `settings-compare-disclosure`, 2026-09-17

Before = the stage 2 build, after = the branch, same hour, same data.

| Page | hintWords before | after | change | asked | tabStops | heightPx |
| --- | ---: | ---: | ---: | --- | --- | --- |
| `/settings?tab=general` | 261 | 151 | −42 % | ≥ 40 % down | 79 → 80 | 2 043 → 2 196 |
| `/settings?tab=profile` | 314 | 180 | −43 % | ≥ 40 % | 75 → 77 | 1 916 → 1 881 |
| `/settings?tab=ai` | 377 | 217 | −42 % | ≥ 40 % | 32 → 38 | 2 068 → 2 127 |
| `/settings?tab=notifications` | 122 | 69 | −43 % | ≥ 40 % | 18 → 20 | 900 |
| `/settings?tab=sources` | 583 | 345 | −41 % | ≥ 40 % | 55 → 57 | 1 825 → 1 503 |
| `/settings?tab=screening` | 298 | 244 | −18 % | ≥ 15 % | 11 → 12 | 1 405 → 1 562 |
| `/resumes` | 123 | 39 | −68 % | ≤ 50 | 9 → 4 | 900 |
| `/target` | 192 | 43 | −78 % | ≤ 90 | **18 → 10** (≤ 11) | **1 179 → 900** (inside 900) |
| `/letter` | 144 | 50 | −65 % | ≤ 80 | 23 → 15 | 1 264 → 907 |

The AI tab's "before" is the host's reading: its state lines quote the CLI
versions the machine reports, and the container's longer ones read 391. The
tab stops that appeared are the "How this works" summaries (five of them on
the AI tab, one per engine). Settings tabs grew taller where a section's title
moved from beside its controls to above them; Sources shrank because the two
vendors' explanations folded. At 375 px `/target` went from 2 216 px to 974.

Every `<form>` on the ten changed pages — 59 forms, 1 020 controls — has the
same action, method, encoding and the same controls in the same order, with
the same names, types, values and `required` / `data-required` marks, before
and after: a folded mode's fields are still in the markup and still posted.
The other 17 measured pages read exactly as in stage 2.

## Stage 4 — `overview-and-runs`, 2026-09-17

Before = the stage 3 build, after = the branch, same hour, same data.

| Page | | tabStops | inDom | mainWords | boxes | heightPx | htmlKB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | before | 11 | 11 | 228 | **8** | 900 | 32.0 |
| | after | 15 | 15 | 248 | **5** (≤ 5 asked) | 900 | 32.9 |
| `/runs` | before | 63 | 63 | **1 410** | 2 | **7 743** | 197.2 |
| | after | 52 | 102 | **775** (≤ 800 asked) | 3 | **2 486** (≤ 5 200 asked) | 238.2 |

No JSON stands outside a `<details>` on `/runs`. The four tab stops `/`
gained are its four numbers, now links to their jobs. The other 24 pages read
as in stage 3.

**The plan's own recipe for `/runs` measured worse than the page it replaced**
— 2 152 words and 8 372 px against 1 410 and 7 741 — and the reason is worth
keeping. The yardstick counts words by whitespace, and a `JSON.stringify`
blob has none: four hundred characters of machine output read as one to three
"words", while the sentence that replaces them ("594 fetched · 3 new · 55
duplicates · 3 classified · 0 alerted · 9 sources") reads as seventeen, dots
included; and two folds stacked under every sentence ("Raw output", then "by
source") added two lines to each of a hundred rows. What reached the numbers,
without taking anything away from the reader:

- one line per run: the facts, then a single **Details** fold on the same line
  holding the per-source list and the JSON;
- the routine counters every tick carries (`filterRejected`, `preFiltered`,
  `dismissed`) stay in the raw block, and a zero speaks only where it is news
  ("0 new" always, "0 alerted" when something new was stored);
- the dot between two facts is drawn in CSS, not typed — it is a separator,
  not a word;
- runs past the latest fifty fold behind a button ("50 earlier runs") that
  names any failure among them and opens by itself when there is one.

`htmlKB` on `/runs` rose by a fifth: the facts are markup the JSON was not,
and the JSON is still in the page. `mainWords` under-reads machine output by
design; read it beside `heightPx` on any page that prints some.

## Stage 5 — `job-page-tabs`, 2026-09-17

Before = the stage 4 build (one page, eight cards), after = the branch.

| Page | tabStops | hintWords | mainWords | boxes | primaries | heightPx |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/jobs/100` before | 24 | **190** | 400 | **24** | **3** | 1 344 |
| `/jobs/100` — Posting (default) | 17 | **5** (≤ 70 asked) | 151 | **12** (≤ 14 asked) | **1** | 1 038 |
| `/jobs/100?tab=match` | 20 | 75 | 190 | 14 | 0 | 1 038 |
| `/jobs/100?tab=letter` | 22 | 54 | 177 | 17 | 0 | 1 038 |
| `/jobs/100?tab=verify` | 17 | 71 | 162 | 12 | 1 | 1 038 |
| `/jobs/62?match=3` (a full report; the tab is inferred) | 66 | 106 | 1 014 | 39 | 1 | 3 621 |

One solid button on every tab (asked: ≤ 1): the header's "Open posting" is
the primary on Posting and Is it real?, and steps back to a secondary button
where the tab brings its own ("Tailor resume →", "Copy letter"). Two boxes
went with the rail becoming one surface with dividers and one with the
Posting tab's classifier and description sharing a surface — the
One-Surface-Per-Region rule, not a trick of the count.

All 61 forms of the single-page job 62 exist on the tabbed page with the same
action and controls: the rail's five on every tab (each now posting a hidden
`tab`), the classifier's on Posting, the comparison's 54 on Resume match, the
letter's on Cover letter, the verifier's on Is it real?; none missing, none
new. The other 25 measured pages read as in stage 4.

## Stage 6 — `companies-welcome-disclosure`, 2026-09-17

Before = the stage 5 build, after = the branch.

| Page | | tabStops | aboveTable | hintWords | mainWords | boxes | heightPx |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/companies` | before | 97 | 16 | **261** | 662 | 44 | 2 758 |
| | after | 85 | **0** | **2** (≤ 130 asked) | 350 | 32 | 1 843 |
| `/discovery` | before | 2 | — | 83 | 119 | 3 | 900 |
| | after | 4 | — | 51 | 93 | 3 | 900 |

The companies table starts **77 px** down the page (asked: inside the first
900; it started at 1 140). The 16 stops that stood before it were the add-flows'
fields; they sit under **Add sources** now, closed while the list has rows.
All 57 forms on the page keep their action and controls.

The wizard, measured the way stage 0 said it would have to be: the old
selectors never saw a step's lead (muted, not faint) nor the pack blurbs (faint
spans outside a label), so the steps first got the hook on that prose — the
**marked** column is this branch with only the hooks added — and the rule was
applied after.

| Step | stage 5 (unmarked) | marked | after | change from marked | asked |
| --- | ---: | ---: | ---: | ---: | --- |
| `/welcome` (all done) | 8 | 25 | 15 | −40 % | ≥ 30 % down |
| `?step=ai` | 21 | 37 | 24 | −35 % | ≥ 30 % |
| `?step=search` | 8 | 8 | 5 | −37 % | ≥ 30 % |
| `?step=profile` | 8 | 8 | 5 | −37 % | ≥ 30 % |
| `?step=sources` | 25 | 111 | 36 | −68 % | ≥ 30 % |
| `?step=matches` | 8 | 8 | 5 | −37 % | ≥ 30 % |

Read against the unmarked stage 5 column three steps went UP (8 → 15, 21 → 24,
25 → 36): that is the hook finding prose that was always on screen, not prose
added. The live database only offers each step's finished state; the
first-run branches (no engine detected, no search run, no resume, nothing
scored) were shortened by the same rule and read in the diff, not measured.
What §8 keeps in sight is still there: the test is one tiny AI call; the key
lives in your database; nothing is saved until the button is pressed; built
for software engineering roles; what "nothing from N sources" usually means;
the batch size and what is set aside for free; boards land switched off.

## Stage 7 — `redesign-polish`, 2026-09-17

The whole table again, on the last branch of the stack, the live database the
same day (98 jobs).

| Page | tabStops | inDom | aboveTable | hintWords | mainWords | boxes | primaries | heightPx | htmlKB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 15 | 15 | — | 17 | 248 | 5 | 0 | 900 | 33.0 |
| `/jobs` | 63 | 151 | 12 | 2 | 1 094 | 9 | 0 | 900 | 156.8 |
| `/jobs?country=US&workplace=remote&posted=7d` | 33 | 119 | 16 | 2 | 464 | 12 | 0 | 900 | 98.0 |
| `/jobs/100` | 17 | 17 | — | 5 | 151 | 12 | 1 | 1 038 | 31.0 |
| `/applications` | 4 | 9 | — | 2 | 48 | 4 | 0 | 900 | 26.1 |
| `/resumes` | 4 | 11 | 1 | 39 | 86 | 4 | 0 | 900 | 30.3 |
| `/resumes/1` | 15 | 15 | 11 | 147 | 856 | 15 | 2 | 2 356 | 56.1 |
| `/target` | 10 | 19 | — | 43 | 460 | 11 | 0 | 900 | 33.1 |
| `/letter` | 15 | 26 | — | 50 | 492 | 18 | 0 | 907 | 35.8 |
| `/companies` | 85 | 103 | 0 | 2 | 350 | 32 | 0 | 1 843 | 109.7 |
| `/discovery` | 4 | 5 | — | 51 | 101 | 3 | 2 | 900 | 24.0 |
| `/runs` | 52 | 102 | 1 | 2 | 777 | 3 | 0 | 2 486 | 232.5 |
| `/settings?tab=general` | 80 | 82 | — | 151 | 825 | 77 | 2 | 2 196 | 89.2 |
| `/settings?tab=profile` | 77 | 97 | — | 180 | 585 | 41 | 1 | 1 881 | 69.7 |
| `/settings?tab=ai` | 38 | 40 | — | 217 | 406 | 33 | 4 | 2 127 | 49.9 |
| `/settings?tab=notifications` | 20 | 20 | 9 | 69 | 131 | 13 | 2 | 900 | 33.2 |
| `/settings?tab=sources` | 57 | 57 | — | 345 | 489 | 45 | 0 | 1 503 | 50.1 |
| `/settings?tab=screening` | 12 | 12 | — | 244 | 586 | 9 | 0 | 1 562 | 30.9 |
| `/welcome` | 6 | 6 | — | 15 | 53 | 6 | 1 | 900 | 22.6 |
| `/screen` | 4 | 4 | 1 | 71 | 102 | 1 | 1 | 900 | 23.3 |
| `/welcome?step=ai` | 7 | 7 | — | 24 | 82 | 7 | 1 | 900 | 24.2 |
| `/welcome?step=search` | 7 | 7 | — | 5 | 65 | 7 | 1 | 900 | 23.5 |
| `/welcome?step=profile` | 8 | 12 | — | 5 | 77 | 8 | 1 | 900 | 26.3 |
| `/welcome?step=sources` | 12 | 12 | — | 36 | 132 | 12 | 1 | 900 | 28.6 |
| `/welcome?step=matches` | 11 | 11 | — | 5 | 95 | 7 | 1 | 900 | 26.5 |
| `/screen/1` | 42 | 166 | 9 | 134 | 919 | 26 | 0 | 1 906 | 180.1 |

Every page: 4–10 requests, 5–24 KB of JavaScript, no external host, no console
error, no horizontal scroll at 1440, 768 or 375, and the hooks see everything
the class selectors see.

What this stage set out to move, before = the stage 6 build:

| Page | | boxes | solid buttons in sight |
| --- | --- | ---: | ---: |
| `/applications` | before | 13 | 0 |
| | after | **4** | 0 |
| `/jobs/94/target`, Suggestions open | before | — | 6 |
| | after | — | **1** |

`/resumes/1` weighs 56.1 KB where stage 6 served 63.2 (the pill ground, below).

The board's outlined columns and dashed wells, nine boxes, are one subtle
surface a column and a quiet line. `board.mjs` reads `data-drop-stage`,
`data-job-id`, `data-stage` and the `stage-…` ids: the 33 distinct `data-*`,
`id`, `draggable`, `name`, `action` and `method` values on the page are byte
for byte the stage 6 ones, `board.test.ts` is green, and no card was dragged
on the live board. On the targeted view every suggestion card carried a solid
Apply (five of them beside the header's button); they are outlined now, so
the one solid button in sight is the page's own. `/resumes/1`, the targeted
view, `/screen`, `/screen/1`, a scorecard and the clean-version page were
looked at under the new tokens at three widths: nothing had broken, and their
other numbers are the stage 6 ones.

### Against stage 0

| Page | hintWords | boxes | tabStops | heightPx |
| --- | ---: | ---: | ---: | ---: |
| `/` | 17 | 8 → 5 | 11 → 15 | 900 |
| `/jobs` | 2 | 33 → 9 | 81 → 63 | 900 |
| `/jobs?country=US&workplace=remote&posted=7d` | 2 | 33 → 12 | 47 → 33 | 900 |
| `/jobs/100` | 190 → 5 | 24 → 12 | 24 → 17 | 1 380 → 1 038 |
| `/applications` | 2 | 13 → 4 | 4 | 900 |
| `/resumes` | 123 → 39 | 9 → 4 | 9 → 4 | 900 |
| `/resumes/1` | 147 | 15 | 15 | 2 392 → 2 356 |
| `/target` | 192 → 43 | 20 → 11 | 18 → 10 | 1 191 → 900 |
| `/letter` | 144 → 50 | 26 → 18 | 23 → 15 | 1 282 → 907 |
| `/companies` | 261 → 2 | 44 → 32 | 97 → 85 | 2 782 → 1 843 |
| `/discovery` | 83 → 51 | 3 | 2 → 4 | 900 |
| `/runs` | 2 | 2 → 3 | 63 → 52 | 7 741 → 2 486 |
| `/settings?tab=general` | 261 → 151 | 78 → 77 | 79 → 80 | 2 123 → 2 196 |
| `/settings?tab=profile` | 314 → 180 | 42 → 41 | 75 → 77 | 2 002 → 1 881 |
| `/settings?tab=ai` | 377 → 217 | 34 → 33 | 32 → 38 | 2 190 → 2 127 |
| `/settings?tab=notifications` | 122 → 69 | 14 → 13 | 18 → 20 | 915 → 900 |
| `/settings?tab=sources` | 583 → 345 | 48 → 45 | 55 → 57 | 1 851 → 1 503 |
| `/settings?tab=screening` | 298 → 244 | 10 → 9 | 11 → 12 | 1 462 → 1 562 |
| `/welcome` | 8 → 15 | 6 | 6 | 900 |
| `/screen` | 71 | 1 | 4 | 900 |
| `/welcome?step=ai` | 21 → 24 | 7 | 7 | 900 |
| `/welcome?step=search` | 8 → 5 | 7 | 7 | 900 |
| `/welcome?step=profile` | 8 → 5 | 8 | 8 | 900 |
| `/welcome?step=sources` | 25 → 36 | 12 | 11 → 12 | 900 |
| `/welcome?step=matches` | 8 → 5 | 7 | 11 | 900 |
| `/screen/1` | 134 | 26 | 42 | 1 885 → 1 906 |

Over the 26 pages: helper prose 3 403 → 1 863 words (−45 %), bordered
boxes 530 → 420 (−21 %), tab stops 760 → 698 (−8 %), page height
40 896 → 33 305 px (−19 %). At 375 px the five pages of the mobile pass are all
shorter: `/` 1 330 → 1 286, `/jobs` 886 → 764, `/jobs/100` 2 842 → 1 586,
`/target` 2 318 → 974, `/settings?tab=profile` 3 344 → 2 943.

### Every number that is worse than stage 0, and why

- **`htmlKB`** is up 2–9 KB on every page but the job page (−5.8), and 44 KB
  on `/runs`: the shell carries the grouped sidebar and the token and
  disclosure rules (about 2.3 KB a page), and the rest is content folded
  instead of removed (the closed filter panel, the add-flows, a run's raw
  output), which costs bytes and no attention. One cause was a defect and is
  fixed here: a toned pill wrote its ground as an 80-byte arbitrary class, 8 KB
  on a resume page with a hundred skill tags; it is a `pill-*` class now.
- **`inDom`** is up on `/jobs` (+1), its filtered view (+5), `/resumes` (+2),
  `/target` (+1), `/letter` (+1), `/companies` (+5) and `/runs` (+39) while
  `tabStops` fell on each: `inDom` counts what a closed disclosure holds, and
  the redesign's method is to close things.
- **`tabStops`** (and `inDom` with it) is up on `/` (11 → 15), Discovery
  (2 → 4), the six settings tabs (+1 … +6) and `?step=sources` (+1): on
  Overview the four numbers became links to their jobs; everywhere else each
  new stop is one "How this works" that replaced a paragraph, and the settings
  tabs lost 18–43 % of their helper words for them.
- **`aboveTable`** on `/resumes` (0 → 1) and Notifications (8 → 9): the
  "Upload a resume" button that folded the upload card, and one "How this
  works".
- **`heightPx`** on General (+73), Screening (+100) and `/screen/1` (+21):
  the settings tabs became stacked titled sections with 32 px between them,
  and the 26 px page title with its margin is taller than the old one.
- **`boxes`** on `/runs` (2 → 3): the one outlined button that folds the runs
  past the latest fifty.
- **`hintWords`** on `/welcome` (8 → 15), `?step=ai` (21 → 24) and
  `?step=sources` (25 → 36): the hook finds prose the class selectors never
  saw; against the marked build each step is 35–68 % shorter (stage 6).
- **`mainWords`** on `/` (228 → 248): the strip writes each delta out ("0 in
  the last 24h") and adds the all-time line; the count moves with the data.
- **`primaries`** rose nowhere. The 2–4 on Discovery and the settings tabs
  are `ToggleRow`'s Enable buttons, one a row, as at stage 0.
