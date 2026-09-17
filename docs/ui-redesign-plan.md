# Dashboard redesign: hierarchy, disclosure, tokens (plan)

> Analysis 2026-09-16, nothing built. The owner's ask: readers said the
> dashboard shows too much at once, every surface looks the same, and nothing
> says where to look first. He wrote a redesign specification
> ([applypack-ui-ux-redesign-spec-v2.md](./applypack-ui-ux-redesign-spec-v2.md),
> 57 sections — "v2" below) and, after the first analysis of it, a correction
> ([applypack-design-required-corrections.md](./applypack-design-required-corrections.md),
> 28 sections — "the corrections"). This file is both of them read against the
> code at v2.10.0: what is adopted, what is adapted, what is dropped and why,
> the system the dashboard ends up with, and eight stages written so that a
> session with no memory of this analysis can run them one after another.
> Backlog ticks live in [TASKS.md §22](./TASKS.md). Pairs with
> [PRODUCT.md](../PRODUCT.md) (the constraints), [DESIGN.md](../DESIGN.md)
> (the system stage 2 rewrites), TASKS §8 (no component library — reaffirmed
> here), [improvement-2026-09/11-ui-copy.md](./improvement-2026-09/11-ui-copy.md)
> and [12-preserve-explanations.md](./improvement-2026-09/12-preserve-explanations.md)
> (the copy rule and its guard-rail), and the open A11Y-4 items of
> [audit-2026-09-10.md](./audit-2026-09-10.md).

**Verdict**

- **The diagnosis in v2 is right, and it is measurable.** Thirty controls
  stand above the Jobs table with another sixty-eight folded under "More…";
  the Sources tab of Settings shows 583 words of helper prose and the AI tab
  377; the Compare page renders all five input modes open at once (601
  words, 1 191 px); a job page is eight equal cards; `/runs` prints
  `JSON.stringify` for a hundred rows (7 759 px). Numbers: §1.1.
- **A third of v2 (§50–§50AB) describes a React client ApplyPack does not
  have** — shadcn/ui, TanStack Table, Recharts, two MCP servers, `useMemo`,
  virtualisation, code splitting, a "backend-first" rewrite of things that
  are already server-side. All of it is dropped; the corrections say the
  same, and so did TASKS §8 on 2026-08-31. The dashboard stays
  server-rendered Hono JSX with a committed Tailwind build, dependency-free
  browser modules and no third-party host (PRODUCT.md).
- **What is adopted is three moves, not "a redesign":** progressive
  disclosure (filters, helper prose, inactive input modes, raw JSON behind
  native `<details>`, no JavaScript needed); a surface-first hierarchy and a
  real type ladder, delivered as new token *values* under the existing token
  *names*; and six small primitives (`Disclosure`, `FilterChip`, `Tabs`,
  `MetricStrip`, a card variant, a fuller `Empty`).
- **Two findings neither file had.** The current *Alerted* pill fails WCAG
  AA — amber `#B45309` on its own 10 % tint is 4.39:1, the danger pill
  4.15:1 (§1.2) — so the token change is a fix, not only taste. And the
  first analysis's "98 visible controls" was a measuring error: `offsetParent`
  does not see that Chrome hides a closed `<details>` with
  `content-visibility`. The real number is 30, and
  [measure.js](./ui-redesign/measure.js) uses `checkVisibility()`.
- **Every stage names the number it moves before it starts** (corrections
  §23), measured with one expression on the same pages
  ([metrics.md](./ui-redesign/metrics.md)).
- **Nothing outside `src/web/`, the docs and two skills changes.** No schema,
  no migration, no worker code, no prompt, no fetcher, no route removed. Two
  query parameters are added (`panel` on `/jobs`, `tab` on `/jobs/:id`).

## 0. What changes, and what does not

| Part | Changes? |
| --- | --- |
| Prisma schema, migrations, worker, fetchers, classifier, prompts, scoring, AI engines | No. No `prisma` command is run at any point of this work |
| Route contracts | Additive only: `GET /jobs?panel=1`, `GET /jobs/:id?tab=…`, a hidden `tab` field on three job-page POSTs. No route removed or renamed |
| Browser modules in `src/web/public/` | `score.mjs` and `target.mjs` are untouched — `site/public/demo/` holds byte copies and `site-vendor.test.ts` fails on any drift |
| Token names (`surface / line / ink / accent / ok / warn / danger / info / violet`) | Kept. 1 062 class occurrences in 40 files use them, and `self-contained.test.ts` checks them in the build. Values change; one token is added (`surface-selected`) |
| Fit floors 85 / 70 / 50 (`format.ts`, mirrored in `target-page.mjs`, held by `tone-parity.test.ts`) | Kept. v2 §20's 90 / 75 / 60 is dropped: what a number's colour means is behaviour people have learned, not decoration |
| Font | Inter stays (bundled, variable `wght` 100–900 — checked in the file). v2 §7's Geist is dropped |
| DESIGN.md, PRODUCT.md, `ui-review`, CLAUDE.md "how does the user…" rows, README "Day to day" | Updated in the PR that changes what they describe |
| The site (`site/`) and the README screenshots | Not in this run (§7) |

## 1. Facts established (don't re-derive)

### 1.1 The baseline

Full table: [ui-redesign/metrics.md](./ui-redesign/metrics.md) — 20 pages at
1440×900 on a build of main at v2.10.0. The rows the stages aim at:

| Page | What is wrong, as a number |
| --- | --- |
| `/jobs` | 30 tab stops before the table (8 place chips + More…, 4 work, 3 posted, 6 statuses, Verified / Watched / Open to me, a four-control form, Paste a job); 150 controls in the DOM |
| `/settings` | helper prose per tab: Sources 583 words, AI engine 377, Profile 314, Screening 298, General 261, Notifications 122; 1 727 lines, 28 `<Hint>`, 20 `hint=`, 14 section descriptions, 20 `<Card>` |
| `/target` | five mode bodies open at once: 18 tab stops, 192 hint words, 1 191 px |
| `/letter` | the same launcher idiom: 23 tab stops, 144 hint words, 1 282 px |
| `/jobs/:id` | eight `h2` cards of equal weight, 190 hint words, three solid-emerald buttons |
| `/` | four separate stat cards (8 boxes), none of the four numbers is a link |
| `/runs` | `JSON.stringify(stats)` in a hundred rows: 1 409 words, 7 759 px, 190 KB |
| `/companies` | the companies table comes after seven other blocks on a 2 776 px page; 261 hint words |
| `/resumes` | the upload form and the add-a-fact form are always open; 123 hint words |

Every page already costs 4–10 requests and 5–24 KB of JavaScript with no
external host. v2's performance sections (§50F–§50X) have nothing to fix:
`/jobs` paginates in SQL at 50 rows, the facets are tallied server-side, the
Overview is one server render, and there is no client state.

### 1.2 Contrast (WCAG 2.1, normal text needs 4.5:1)

| Colour | on white | on its own 10 % pill | on its 5 % flash |
| --- | ---: | ---: | ---: |
| `warn` today `#B45309` | 5.02 | **4.39** | 4.68 |
| `warn` proposed `#A24F0A` | 5.74 | 4.97 | 5.34 |
| `danger` today `#D92D20` | 4.83 | **4.15** | 4.50 |
| `danger` proposed `#B42318` | 6.57 | 5.58 | 6.05 |
| `ok` `#047857` | 5.48 | 4.78 | 5.10 |
| `info` `#1D4ED8` | 6.70 | 5.72 | 6.21 |
| `violet` `#6D28D9` | 7.10 | 6.04 | 6.55 |

| Text | white | canvas `#F5F7F6` | subtle `#EEF2F0` | selected `#E4F1EA` |
| --- | ---: | ---: | ---: | ---: |
| `ink-faint` today `#667085` | 4.97 | 4.62 | **4.40** | **4.28** |
| `ink-faint` proposed `#5F6B7E` | 5.40 | 5.02 | 4.78 | 4.64 |
| `ink-muted` `#475467` | 7.69 | 7.14 | 6.81 | 6.61 |
| `accent-strong` `#047857` | 5.48 | 5.10 | 4.86 | 4.72 |

v2's own palette fails where it matters: accent `#07875F` is 4.24 on its
canvas, tertiary text `#8C9791` is 3.02 on white. The corrections' values
pass, with the one hole in the second table — closed by darkening
`ink-faint` rather than by a rule nobody can check ("never put faint text on
a tinted surface").

The surface steps are small in both files and in the dashboard today:
canvas → white 1.08, white → subtle 1.13 (today 1.10), subtle → selected
1.03. A background alone does not carry structure or state; corrections §8
says so and §3.3 below makes it a rule.

### 1.3 Where things live

- Tokens: the `:root` block of `TOKENS_CSS` in `src/web/layout.tsx`, as RGB
  triplets; `tailwind.config.js` maps them by name; `npm run css` writes the
  committed `src/web/public/tailwind.css`, and `self-contained.test.ts`
  fails when a class a page uses is not in it. **A new utility class means
  `npm run css` and committing the result.**
- Primitives: `src/web/ui.tsx` (622 lines): `PageHeader`, `Flash`, `Card`,
  `SectionTitle`, `Hint`, `Empty`, `Code`, `MarkIcon`, `Stat` (one use,
  `overview.tsx:174`), `Badge`, `Tag`, `StatusBadge`, `FitBadge`, `Table`,
  `Tr`, `Td`, `Field`, `Input`, `Select`, `Textarea`, `Checkbox`,
  `PillCheckbox`, `Radio`, `Button`, `ActionForm`, `ToggleRow`,
  `TagListInput`. DESIGN.md's Composed-Primitive Rule: a new pattern lands
  here first.
- Sidebar: `NAV` (nine flat items), `NavLink`, `Sidebar`, and the
  `DIRECTION_CONTRACT` comment that must stay in step with DESIGN.md — all in
  `layout.tsx`. Icons are inline Lucide paths in `ICON_PATHS`.
- Jobs: `src/web/pages/jobs-list.tsx` (the three facet rows, the status row,
  the GET form, `FacetLink`, `buildQuery`); the pure half in
  `src/web/job-facets.ts` with `job-facets.test.ts`; the query schema and
  `PAGE_SIZE = 50` in `src/web/routes/jobs.tsx`. "More…" is already a
  `<details class="contents">` — the idiom stage 1 reuses.
- Launchers: `ModeCard` is exported from `pages/target-start.tsx` and used
  by `letter-start.tsx` and `screen-new.tsx`; it already styles itself with
  `has-[:checked]:`. `public/launcher.mjs` selects a mode when a field in its
  box is touched and makes `data-required` controls required only in the
  chosen box. With JavaScript off, nothing in a launcher is `required`.
- Settings: `SETTINGS_TABS` (six link tabs, `?tab=`), a local `Section`
  (220 px title column) in `pages/settings.tsx`.
- Runs: `StatsCell` in `pages/runs.tsx`; `CronStats` in
  `src/jobs/cron-run.ts` is a flat record plus `bySource`. Keys the jobs
  write today: `fetched`, `persisted`, `duplicate`, `crossListed`,
  `classified`, `classifyFailed`, `alerted`, `sources`, `sourcesFailed`,
  `sourcesUnchanged`, `found`, `count`, `deleted`, `candidates`, `skipped`,
  `profile`, `profiles`, `reason`, `durationMs`.
  `src/web/fetch-summary.ts:summarizeFetchRun` is the "Fetch now" flash — one
  kind of run out of six, worded for that button.
- Job page: `pages/job-detail.tsx`, one grid
  `xl:grid-cols-[minmax(0,1fr)_340px]`; rail = Actions, Details, Application
  tracking; main = Classifier, "Is this job real?", Resume match, Cover
  letter, (France Travail payload), Description. Links that aim inside it:
  `?match=<id>#resume-match` (`resume-match-card.tsx:196, 209`,
  `routes/keywords.ts:57`, `routes/jobs.tsx:720`),
  `?letter=<id>#cover-letter` (`cover-letter-card.tsx:192`,
  `routes/letter.tsx:248`), bare `#verification`
  (`resume-match-card.tsx:613`, `cover-letter-card.tsx:163`,
  `target.tsx:233`, `description-refresh.tsx:31`,
  `routes/jobs.tsx:539, 571, 574, 606`) and bare `#resume-match`
  (`target.tsx:176`).
- Board: the dashed empty wells are `pages/applications.tsx:223` and `:261`;
  `public/board.mjs` finds its drop targets by `data-drop-stage`; the
  `stage-col-…` ids are the page's own jump links.
- Companies: block order in `pages/companies.tsx:243–327` — Watchlist, the
  paste-a-list card, Quiet sources, "How coverage works", Sources for your
  searches, Starter packs, Add company, then the table.
- Stale process docs: `.claude/skills/ui-review/SKILL.md` names Fira Sans and
  Fira Code (the font is Inter) and "Tailwind via CDN, no build pipeline"
  (committed build since v2.7.0); `commit-discipline`'s gate says "checked in
  light + dark" (there is one theme).
- An ADR is not needed: `adr-writer` lists UI changes as not requiring one.
  DESIGN.md is the decision record for visual rules.

### 1.4 Traps already paid for

- `offsetParent !== null` counts what sits inside a closed `<details>` as
  visible. Use `checkVisibility()` (measure.js does).
- `.env` points `DATABASE_URL` at `localhost:5432`, where a host Postgres
  answers; the compose database is on **5433** (CLAUDE.md). The loop in §4.2
  passes the URL explicitly.
- `<details>` closes on every navigation, and every facet chip is a
  navigation. Stage 1's panel carries `panel=1` in the links *inside* it.
- `display: contents` on `<details>` is what lets the summary share a row
  with its siblings while the body wraps below (`basis-full order-last`).
- A `Field` is a `<label>` wrapping its hint, so a long hint becomes the
  control's accessible name (audit A11Y-4). Short hints plus a disclosure
  *outside* the label is the fix chosen here (§3.4).
- Browsing the live database is GET only: no status change, no drag on the
  board, no saved setting, no violet button (AI spend), no "Fetch now". A
  POST is exercised by the route smoke in CI, on its throwaway Postgres.
- `npm start` is **not** a scratch copy on this machine. `.env` sets
  `DATABASE_URL`, and in `src/local/launcher.ts` that wins over the built-in
  database — the launcher would start a worker and a dashboard against a
  real Postgres. It is not run during this work.

## 2. Decisions: both files, section by section

"v2 §n" is the specification, "C §n" the corrections.

| Source | Topic | Verdict | Where |
| --- | --- | --- | --- |
| v2 §1–4, §55, §57 | Diagnosis, goals, personality | Adopt. Already DESIGN.md's voice ("dense, calm, light"); the new part is *hierarchy* | §3, stage 2 |
| v2 §5, C §7 | Palette | Adapt: C §7's values, under the existing names; `ink-faint` darkened; `warn` / `danger` replaced (§1.2) | stage 2 |
| v2 §6, C §8 | Surface levels | Adapt: four levels, never alone — a surface change is paired with spacing, type, a divider or an indicator | stage 2 |
| v2 §7, C §6 | Typography | Adopt the ladder, keep Inter; no uppercase-tracked labels (DESIGN.md already forbids them) | stage 2 |
| v2 §8–10 | Spacing, radius, shadow | Mostly present (4 px grid, 8 px ceiling, whisper shadow). Adopt 24 / 32 px between sections; keep the 8 px ceiling — v2's 10–12 px is dropped | stage 2 |
| v2 §11, C §25 | Sidebar groups, active state | Adopt: sentence-case group labels, emerald-tinted active item with a 2 px indicator. Counters dropped — `Layout` has no data and every route would have to pass them | stage 2 |
| v2 §12 | Page header pattern | Present (`PageHeader`). Adopt the one-sentence intro rule | stages 2–3 |
| v2 §13 | Buttons | Present (six variants, violet = AI). Adopt "one primary per region" as a measured number (`primaries`) | stages 5, 7 |
| v2 §14, C §12 | Forms, helper text | Adopt: label → one sentence → control; the rest behind "How this works" | stage 3 |
| v2 §15, C §18 | Comboboxes | Defer. The country picker and the job picker already search without a framework | §6 |
| v2 §16, C §11 | Jobs filters | Adopt — the first structural change | stage 1 |
| v2 §17–18 | Tabs vs tags vs filter chips | Adopt: three visibly different components | stages 1–2 |
| v2 §19 | Tables | Mostly present (sticky header, fixed widths, `hideBelow`, pagination). Adopt the emerald hover. Hover-revealed row actions dropped — `accessible-interactions`: nothing depends on hover | stage 2 |
| v2 §20 | Fit score | Present (`FitBadge`: number + meter). Adopt a word beside the number where there is room; floors unchanged | stage 5 |
| v2 §21 | Cards | Adopt: a card is an object, not a wrapper; one surface per region | stages 2–7 |
| v2 §22, C §19–21 | Charts | Later, with the search funnel, as server-rendered SVG from a pure function | §6 |
| v2 §23, C §14 | Overview | Adopt: metric strip, compact pipeline health | stage 4 |
| v2 §24 | Jobs page | Adopt (toolbar, tabs with counts, chips row) | stage 1 |
| v2 §25, C §16 | Job page | Adopt as `?tab=` links, no client state | stage 5 |
| v2 §26 | Applications board | Adopt the quiet empties and surface columns; DnD untouched | stage 7 |
| v2 §27–28 | Resumes, Confirmed facts | Adapt: upload and add-a-fact behind disclosures, facts read as knowledge. The table stays — comparing resumes is what it is for | stage 3 |
| v2 §29, C §13 | Compare | Adopt, in CSS (`:has`), which the launcher already uses — no server round-trip needed | stage 3 |
| v2 §30 | Comparison result | Present: the targeted view already has the ring, five lines, gaps and strengths. Verify only | stage 7 |
| v2 §31 | Cover letter as a wizard | Drop: the launcher is two choices and one button; it gets the mode collapse instead | stage 3 |
| v2 §32–33 | Companies, Discovery | Adapt: table first, add-flows behind disclosures. Company detail pages and analytics are product work, not this run | stage 6 |
| v2 §34, C §15 | Runs | Adopt: a sentence per run, raw output behind `<details>` | stage 4 |
| v2 §35 | Screening | Present (DESIGN.md has the section). Verify only | stage 7 |
| v2 §36 | Settings: vertical nav | Adopt at ≥ lg; the row of tabs stays below it | stage 3 |
| v2 §37, C §17 | Modals, drawers | Defer: page → `?tab=` → `<details>` → native `<dialog>` → a little JS, in that order | §6 |
| v2 §38 | Empty states | Adopt: what is missing, why it matters, one action | stage 7 |
| v2 §39 | Skeletons | Drop: pages arrive rendered; long work already has progress pages and a navigation bar | — |
| v2 §40–42 | Errors, toasts, confirms | Present (`Flash` with one action, `ActionForm confirm`, `delete-confirm.ts`). Toasts dropped — a flash is the server-rendered toast | stage 7 (check) |
| v2 §43 | Accessibility | Present as a skill. Fold in the open A11Y-4 items that live in primitives | stage 2 |
| v2 §44 | Responsive | Present (icon rail, drawer, `table-hide.ts`). Every stage checks 768 and 375 | §4.2 |
| v2 §45 | Dark mode | Later; stage 2's `tokens.ts` makes it a second value set plus one test | §6 |
| v2 §46–47 | Motion, icons | Present (150 ms colour transitions, reduced motion, drawn Lucide paths) | — |
| v2 §48–49 | Component inventory, tokens | Adapt: six new primitives, not forty | §3.4 |
| v2 §50–50E, C §1–4, §9, §27 | shadcn, TanStack, Recharts, MCP catalogues, dependency policy | Drop the stack; keep the policy (no new dependency) | — |
| v2 §50F–50Y, C §10 | Backend-first, DTOs, pagination, virtualisation, state, memoisation | Drop: already true or not applicable (§1.1) | — |
| v2 §50Z, §51, §56, C §22–24 | Migration order, measured criteria | Adopt, with a baseline stage and a number per PR | §4, §5 |
| v2 §52, C §5 | A new design skill | Drop: `impeccable` reads PRODUCT.md and DESIGN.md; a second rulebook drifts. Fix `ui-review` instead | stage 2 |
| v2 §53–54, C §26, §28 | Forbidden patterns, acceptance checklist | Adopt into DESIGN.md's Don'ts and `ui-review` | stage 2 |

## 3. The system after the change

### 3.1 Tokens — names stay, values move

A new pure module `src/web/tokens.ts` holds the triplets and builds the
`:root` block; `layout.tsx` consumes it; `tokens.test.ts` asserts the
contrast pairs below. Starting values — tuned on the Jobs page in stage 2,
then frozen and written into DESIGN.md:

| Token | Today | After | Role |
| --- | --- | --- | --- |
| `--surface` | `247 248 250` | `245 247 246` | canvas: page ground, sidebar base |
| `--surface-raised` | `255 255 255` | same | where work happens |
| `--surface-overlay` | `243 244 246` | `238 242 240` | subtle: table header, toolbars, wells, inactive regions |
| `--surface-selected` | — | `228 241 234` | **new**: active nav item, selected option, row hover (at 50 %) |
| `--line` | `229 231 235` | `221 227 224` | dividers and card outlines |
| `--line-strong` | `208 213 221` | `200 209 204` | control borders |
| `--ink` / `--ink-muted` | `16 24 40` / `71 84 103` | same | |
| `--ink-faint` | `102 112 133` | `95 107 126` | passes on every surface (§1.2) |
| `--accent` / `-strong` / `-deep` | `5 150 105` / `4 120 87` / `6 95 70` | same | ring and mark / text and primary / hover |
| `--ok` | `4 120 87` | same | |
| `--warn` | `180 83 9` | `162 79 10` | fixes the Alerted pill |
| `--danger` | `217 45 32` | `180 35 24` | fixes the danger pill and flash |
| `--info` / `--violet` | `29 78 216` / `109 40 217` | same | |

`tokens.test.ts` (pure, 4.5:1 unless said): every ink on every surface;
`accent-strong` on every surface; each tone on white, on its 10 % blend over
white (the pill), on its 5 % blend (the flash) and on the canvas; white on
`accent-strong`, `accent-deep` and `warn`; `accent-strong` on white ≥ 3:1 as
the focused control border. Hard-coded copies of a token go with it: the
select chevron's `%23667085` in `ui.tsx`, the hexes in `DIRECTION_CONTRACT`.

### 3.2 The type ladder

Added to `tailwind.config.js` as named sizes (Tailwind's tuple form carries
line height, tracking and weight), so a page writes `text-title`, not
`text-[26px] font-[650]`:

| Name | Size / line | Weight | Use |
| --- | --- | --- | --- |
| `title` | 26 / 32, −0.02em | 650 | the page's one `h1` |
| `section` | 18 / 24, −0.01em | 600 | a page-level section outside a card |
| `entity` | 15 / 22 | 600 | card headings, a row's name, a resume, a job |
| body | 14 / 20 | 400 (500 for emphasis) | unchanged |
| `label` | 13 / 18 | 550 | field labels, table headers, group labels |
| `meta` | 12 / 16 | 400 | timestamps, counts, helper prose under a control |

The ladder must be visible at a glance on every page: title > section >
entity > body > meta. No uppercase tracking anywhere — the four
`uppercase tracking-wide` labels on `/jobs` go in stage 1, the other three
in the dashboard with the pages they sit on.

### 3.3 Surfaces and borders

- **Surface first, never surface alone.** A region is set apart by its
  surface *and* one of: spacing, a heading, a divider, an indicator. State is
  never a background alone: a selected option also gets `accent-strong` text
  at weight 500 and a check or a left bar.
- **One surface per region.** A region of a page (a settings tab, the job
  page's main column, a filter panel) is one raised surface with dividers
  inside it, not a stack of bordered cards. A card is for an object that
  moves or stands alone: a board card, a mode box, a resume, the metric
  strip.
- Borders stay where a control or an object ends. Row dividers use `line`;
  wrappers around wrappers lose theirs.
- Spacing between major blocks is 24–32 px, inside a block 12–16 px.

### 3.4 Primitives

| Primitive | Stage | Shape |
| --- | --- | --- |
| `Disclosure` | 1 | `<details>` + `<summary>`; `variant="button"` (looks like a secondary button, optional count, chevron turns with `group-open:`) and `variant="quiet"` (13 px muted "How this works"); `open`, `id`, `class` |
| `FilterChip` | 1 | an active criterion: label, optional flag, a link that removes it, `aria-label="Remove filter: …"`; `rounded-md`, emerald-tinted — not a pill, not a tag |
| `Tabs` | 1 | a row of links with `aria-current`, underline for the current one, optional tabular count; never a pill |
| `Card` | 2 | gains `variant`: `card` (today's), `flat` (no border, shadow or fill), `subtle` (overlay fill, no border) |
| `SectionTitle` | 2 | gains `level`: `card` (`text-entity`, default) or `section` (`text-section`) |
| `Field` | 3 | a wrapper `<div>` takes the `class`; the `<label>` keeps label, one-sentence hint and control; an optional `more` renders a quiet `Disclosure` *outside* the label |
| `MetricStrip` | 4 | a `<dl>` on one raised surface, cells divided by hairlines: dot + label, a 28 px tabular value, a delta line; a cell may be a link. Replaces `Stat`, which is deleted |
| `Empty` | 7 | gains `title` and `action`: what is missing, why it matters, one way forward |

`Hint`, the `PageHeader` intro, the settings `Section` description and the
`Radio` body get `data-ui="hint"` in stage 0 — the hook measure.js counts.

Input focus becomes `focus:border-accent-strong focus:ring-2
focus:ring-accent/25`: the border is the 3:1 indicator the audit asked for,
the ring is the softness v2 asked for.

### 3.5 Rules DESIGN.md gains (stage 2)

Kept as they are: One-Accent, Quiet-Pill, Violet-Means-AI, Machine-Mono,
Drawn-Icon, Composed-Primitive, Whisper-Shadow. Rewritten: "hairline borders
doing all the structural work" and "flat by default" become **Surface-First**
and **One-Surface-Per-Region** (§3.3); the dashed empty well leaves Shapes.
New: **The Disclosure Rule** — under a label, one sentence; what explains a
cap, a cost, a gate, a privacy fact or a destructive act stays visible (§8);
everything else sits behind "How this works". **The Measured-Change Rule** —
a UI pull request names a number from measure.js and reports it before and
after.

## 4. How a stage is run

Written for a session working alone. CLAUDE.md and the `commit-discipline`,
`testing-gate`, `release-discipline`, `accessible-interactions` and
`ui-review` skills bind as always; this section adds only what is particular
to this work.

### 4.1 Branches and pull requests

- One stage = one branch = one PR. Names say the outcome:
  `redesign-baseline` → `jobs-filter-panel` → `dashboard-tokens` →
  `settings-compare-disclosure` → `overview-and-runs` → `job-page-tabs` →
  `companies-welcome-disclosure` → `redesign-polish`.
- The PRs are **stacked**: stage 0 branches off `main`, every later stage off
  the branch before it, and its PR's base is that branch. The PR body opens
  with "Stacked on #N — merge in order; retarget the next PR to `main`
  before deleting this branch" (deleting a base branch closes the PR stacked
  on it — paid for on 2026-09-04).
- Never merge, never tag. After `gh pr create`, read CI (`gh pr checks`), fix
  what is red, then start the next stage without waiting for the merge.
- Re-check the branch in the same command as every `git add` / `git commit`
  (parallel sessions switch branches); push with explicit refs. Commits are
  two to five words, verb first, at least 120 s apart (the commit-guard
  hook), no co-author line.

### 4.2 Build, look, measure

```
npm run css        # whenever a class was added or removed; commit the result
npm run build
DATABASE_URL='postgresql://jobhunter:jobhunter@localhost:5433/jobhunter' WEB_PORT=4848 node dist/web/server.js
```

That serves the branch on `127.0.0.1:4848` against the compose database —
real rows, read-only browsing (checked 2026-09-16: `/health` 200, `/jobs`
in 34 ms). The owner's own dashboard on 4747 is not touched until the stage
is finished. Nothing is posted to either. What a POST does is checked where
it is safe: a stage that changes a form's fields, or where a POST redirects,
extends `src/scripts/route-smoke.ts` (CI runs it on a throwaway Postgres) and
diffs the page's `<form>` markup before and after. The five wizard steps
render by GET whatever the setup state: `/welcome?step=ai|search|profile|sources|matches`.

Per stage, on the pages it names:

1. **Before**: run [measure.js](./ui-redesign/measure.js) at 1440×900, note
   the rows.
2. Build the change. Primitives and tokens first, pages second; `impeccable`
   in Operate mode as a *refinement* with §3 as the brief — no new visual
   world, no seed roll.
3. **After**: measure again; screenshots at 1440, 768 and 375 into
   `~/applypack-evidence/ui-redesign/<branch>/` (outside the repository —
   they show the owner's data); the browser console shows no error.
4. Keyboard: Tab through the changed region — order follows reading order,
   every stop has the emerald ring, `<details>` toggles on Enter and Space.
5. No JavaScript: the behaviour must come from HTML and CSS. Confirm it by
   reading the markup (`curl`), not by trusting the enhanced page.
6. A `ui-review` pass on the 1440 screenshot; fix Critical and High findings.
7. Append the stage's table to [metrics.md](./ui-redesign/metrics.md).

### 4.3 Gates before the PR

`npm run lint:types && npm test` green; a pure helper has its test beside it;
`docker compose build web && docker compose up -d web` and every changed
route answers 200 (after this the owner's dashboard runs the branch — say so
in the PR; `git checkout main` and the same two commands bring it back); the
`code-review-expert` skill over `git diff <base>...HEAD`, P0 / P1 fixed,
P2 / P3 named in the PR body; the docs that describe the changed surface
updated in the same PR; the stage ticked in TASKS §22.

### 4.4 Versions

Stage 0 carries no tag. Each later stage is a user-visible UI change: a
minor bump in `package.json`, a `CHANGELOG.md` section with its compare
link, and a "Release notes" draft in the PR body (`release-discipline`
format). Take the next free minor above both `main` and the branch below —
from v2.10.0 that is 2.11.0 for stage 1 through 2.17.0 for stage 7. If
`main` moves first, the bump is a one-line rebase at merge time.

### 4.5 When to stop

Stop and report instead of pushing on when: a test can only go green by
weakening it; a stage's number gets worse and there is no reason worth
writing down; a must-stay sentence (§8) cannot stay visible in the new
layout; a change would need a schema edit, a new dependency or a removed
route; CI fails for a reason outside the diff. Finish the stage in hand
before handing over when the context grows heavy — TASKS §22, metrics.md and
the branch names are the whole state, so the next session resumes from the
first unticked stage.

## 5. Stages

### Stage 0 — `redesign-baseline` (no tag)

**Goal**: the yardstick, and proof it reads the same before and after.

- Add `data-ui="hint"` to `Hint`, to the `PageHeader` intro wrapper, to the
  settings `Section` description and to the `Radio` body;
  `data-ui="mode-card"` and `data-ui="mode-body"` to `ModeCard`'s fieldset
  and body (stage 3 styles them). Nothing visible changes.
- Measure the twenty pages of metrics.md again, plus the five wizard steps
  (`/welcome?step=…`) and one `/screen/:id` if a screening exists; add the
  375 px `tabStops` / `heightPx` pass for `/`, `/jobs`, `/jobs/:id`,
  `/target`, `/settings?tab=profile`.
- Screenshots of all of them into `~/applypack-evidence/ui-redesign/baseline/`.

**Done when**: `hintWords` with the `data-ui` hooks equals the class-based
count within ±5 % on every page (the hooks see what the classes saw);
metrics.md has the dated table.

### Stage 1 — `jobs-filter-panel` (minor)

**Goal**: the table is what the page is about. `/jobs` `aboveTable` 30 → ≤ 14
with nothing selected, ≤ 19 with three filters; nothing that filtered before
filters differently.

Layout, top to bottom: header → toolbar (the GET form: search, Fit ≥, sort,
Apply; then **Filters (n)**) → status tabs with counts → the active-filter
row (only when something is active) → the table.

- `job-facets.ts` (pure, tested): move `buildQuery` here as `jobsHref`, with
  the filters type; add `activeFilters(filters, profiles)` → label, flag and
  the href that removes that one value (search, places, workplaces, posted,
  Verified, ★ Watched, Open to me); `clearFiltersHref`; `filterCount`.
  Status, sort, `q` and `minFit` are not "filters" — they are in plain sight.
- The panel is `Disclosure variant="button"` as a `details.contents` inside
  the toolbar's flex row, its body `basis-full order-last`: rows *Search*
  (only with more than one running search), *Where* (top eight + the existing
  More…), *Work*, *Posted*, *Show* (Verified, ★ Watched, Open to me). Row
  labels in sentence case at `label` size. Option chips are `rounded-md` on
  the subtle surface with their count; a selected one is tinted, weight 500,
  with a drawn check.
- Every link inside the panel carries `panel=1`; the route accepts it
  (`'1' | ''`, like `verified`) and the page renders the panel `open`. Links
  outside it — tabs, chips row, pagination, the form — do not carry it.
- Status tabs use `Tabs`, with counts from one
  `prisma.job.groupBy({ by: ['status'], where })` over the final `where`
  minus `status`, so a count is what the tab would show.
- Docs: the four `/jobs` rows in CLAUDE.md's "how does the user…" table
  ("the search chips", "the 'Where' chips…", "Open to me", "★ Watched") now
  start at **Filters**.

**Check**: for five URLs (none; `country=US`; `country=US&workplace=remote&posted=7d`;
`status=ALERTED&watched=1`; `q=php&minFit=70`) the "n jobs" line is identical
before and after. `inDom` ≤ 165, `htmlKB` within +6 % on the same data.

### Stage 2 — `dashboard-tokens` (minor)

**Goal**: four levels of text and three of surface that the eye separates
without reading; every text colour passes AA on every surface it can sit on.

- `tokens.ts` + `tokens.test.ts` (§3.1); `layout.tsx` consumes it;
  `tailwind.config.js` gains `surface.selected` and the named sizes (§3.2).
- Primitives: `PageHeader` → `text-title`; `SectionTitle` levels; `Card`
  variants; `Tr` hover → `surface-selected` at 50 %; table header → `label`;
  input focus (§3.4); option chips, `FilterChip`, `Tabs` and `Badge` checked
  side by side so the three families differ (v2 §18).
- Sidebar: groups *Work* (Jobs, Applications), *Tools* (Resumes, Compare,
  Cover letter), *Research* (Companies, Discovery), *System* (Runs, and
  Screening while employer mode is on); Overview above them, Settings pinned
  below. Labels at `label` size in `ink-faint`, a hairline in their place on
  the icon rail. The active item: `surface-selected`, `accent-strong` text
  and icon, a 2 px emerald bar on the left; the sidebar's ground one step off
  the canvas.
- Jobs is the reference page: tune the values there, then look at every
  other page for damage (a 26 px title beside header actions at 768 px, the
  340 px rail, the target page's ring).
- DESIGN.md rewritten (front matter values, Colors, Typography, Elevation,
  Shapes, Components, the rules of §3.5, v2 §53's forbidden list folded into
  the Don'ts); the `DIRECTION_CONTRACT` comment; PRODUCT.md's brand line;
  `ui-review` (Inter, the committed build, v2 §54's checklist, measure.js);
  `commit-discipline`'s "light + dark" line.
- The open A11Y-4 item that lives in a primitive: the 15 %-alpha input ring,
  closed by the focus change above. (The other one — two badge-buttons whose
  only name is their state — is page markup: `settings.tsx:857` goes with
  stage 3, `companies.tsx:381` with stage 6.)

**Done when**: `tokens.test.ts` green; no horizontal scrollbar on any page
at 1440 / 768 / 375; `boxes` not up on any page; the `ui-review` score for
hierarchy is ≥ 8 on `/jobs` and `/settings?tab=profile`.

### Stage 3 — `settings-compare-disclosure` (minor)

**Goal**: one sentence under a label; one input mode open at a time.
Visible `hintWords` at least 40 % down on every settings tab (Screening at
least 15 % — its legal text stays), `/resumes` 123 → ≤ 50, `/target` 192 →
≤ 90 with `tabStops` 18 → ≤ 11 and the page inside 900 px, `/letter` 144 →
≤ 80.

- The rule for every sentence (11-ui-copy.md): it says what to do, why a
  result happened, prevents a dangerous misunderstanding, gives evidence, or
  explains a non-obvious state — otherwise it moves behind "How this works"
  or goes. §8 lists what stays visible, by meaning. Run `stop-slop` over
  what is rewritten. Per PR: the word count per page, before and after.
- `Field` gains the wrapper and `more` (§3.4); `ToggleRow` and the settings
  `Section` take the same one-sentence discipline.
- Settings: at ≥ lg the six tabs become a sticky left column of links (same
  `?tab=` URLs, same order); below lg the row stays. `Section` stacks its
  title (`text-section`) and one-line description above its controls instead
  of beside them. The Sources tab's per-vendor explanations ("what it adds,
  when it is worth it, what the vendor asks, where to register") become one
  disclosure per vendor. The notification target's badge-button
  (`settings.tsx:857`, `title="Toggle"`) gets a name that says the action
  and its object — "Disable Work chat" — the audit's open A11Y-4 item.
- Launchers (`/target`, `/letter`, `/screen/new`): one rule in the token CSS,
  guarded so an old browser shows everything as today —

  ```css
  @supports selector(:has(*)) {
    [data-ui="mode-card"]:not(:has(> label input[type="radio"]:checked)) > [data-ui="mode-body"] { display: none; }
  }
  ```

  The selector reads the mode's own radio (`> label`), so a checked radio
  inside a body cannot hold a closed mode open. A disabled mode keeps its
  one-line reason outside the body. `launcher.mjs`
  needs no change: the radio is the visible way in, and `data-required`
  already follows the chosen box.
- Resumes: with at least one resume, the upload form sits behind
  `Disclosure variant="button"` ("Upload a resume") in the header area; with
  none it is open. *Confirmed facts* reads as knowledge — the term at
  `entity` weight, "I have this" / "I don't" with a drawn mark, the note
  under it, confirmed first — and "Add a fact" is a disclosure.

**Check**: `curl` each changed page before and after and diff its `<form>`
blocks — fields, names and actions are unchanged, and a closed mode's
fields are still in the markup, so every mode posts exactly as it did (a
`display: none` control is submitted; only a `disabled` one is not). The
route smoke's `POST /resumes` still answers 303.

### Stage 4 — `overview-and-runs` (minor)

**Goal**: four numbers read as one line; a run reads as a sentence. `/`
`boxes` 8 → ≤ 5; `/runs` `mainWords` 1 409 → ≤ 800 and `heightPx` 7 759 →
≤ 5 200, with no JSON outside a `<details>`.

- `MetricStrip` replaces the four `Stat` cards; each cell links to
  `/jobs?status=…`; the "tracked all-time · seen in 24 h · dismissed" line
  becomes the strip's footer. `Stat` is deleted.
- "Cron health" becomes "Pipeline health": an overall badge in the heading
  (Healthy, or "n failing"), one compact row per job. The three conditional
  paragraphs under the header (held alerts, watched companies, paused) keep
  their words and sit together under the strip.
- `src/web/runs-summary.ts` (pure, tested): `summarizeRun(name, stats)` →
  the facts worth a glance, in a fixed order, from the keys in §1.3
  ("594 fetched · 3 new · 55 duplicates · 3 classified · 0 alerted · 9
  sources"); `reason` becomes a sentence ("Discovery is switched off");
  unknown numeric keys are humanised, anything else is left to the raw
  block. `StatsCell` renders that, then `Disclosure variant="quiet"` "Raw
  output" with the JSON, then the existing by-source list. The page title
  becomes "Runs", as the menu says.

### Stage 5 — `job-page-tabs` (minor)

**Goal**: a job opens on what decides it. Default tab: `hintWords` 190 →
≤ 70, `boxes` 24 → ≤ 14, `primaries` ≤ 1 on every tab.

- `src/web/job-tabs.ts` (pure, tested): tabs `posting` (default: Classifier
  + Description, and the France Travail payload when present), `match`
  (Resume match), `letter` (Cover letter), `verify` ("Is this job real?").
  `resolveJobTab({ tab, match, letter })`: an explicit `tab` wins, else
  `match=` → `match`, `letter=` → `letter`, else `posting` — so every
  existing `?match=…#resume-match` and `?letter=…#cover-letter` link lands
  right without an edit. `jobHref(id, tab, params)` for the rest.
- The rail (status actions, Details, Application tracking) stays on every
  tab; its three forms post a hidden `tab`, and `POST /jobs/:id/status` and
  `/jobs/:id/reclassify` (`routes/jobs.tsx`) and `/jobs/:id/application`
  (`routes/applications.tsx`) redirect back to it — the value read through
  `resolveJobTab`, so nothing unvalidated reaches a redirect.
- The tab labels carry what exists: "Resume match · 72", "Cover letter · 1",
  "Is it real? · likely real". The route keeps loading what it loads today;
  only the render is split.
- The nine bare-anchor links of §1.3 get `?tab=verify` / `?tab=match`.
- `FitBadge` gains a worded size for the page header: `fitWord(score)` in
  `format.ts` (Strong / Good / Partial / Weak on the existing floors),
  tested. The "Actions" heading over the button row goes.
- `route-smoke.ts` requests the three non-default tabs, and posts a status
  change with `tab=match`, expecting the redirect to carry it;
  ARCHITECTURE.md's route table names `?tab=`.

### Stage 6 — `companies-welcome-disclosure` (minor)

**Goal**: a list page shows its list. `/companies`: the companies table
starts inside the first 900 px (today it ends a 2 776 px page), `hintWords`
261 → ≤ 130. `/welcome`: each step at least 30 % fewer visible hint words,
every must-stay sentence of §8 still on screen.

- Companies: header → Watchlist (when it has rows) → Quiet sources (when any)
  → the table → "Add sources": *Watch specific companies*, *Add a starter
  pack*, *Add one company*, *Sources for your searches*, each a
  `Disclosure`; with no companies at all they render open. "How coverage
  works" stays as it is — already a disclosure.
- The company row's badge-button (`companies.tsx:381`) gets the same fix as
  the notification target's in stage 3: its name says the action and the
  company, the badge keeps showing the state.
- Discovery and the watchlist preview pages: `Section` / flat-card
  treatment, one-sentence hints.
- Welcome: the disclosure rule per step, each measured through `?step=`.

### Stage 7 — `redesign-polish` (minor)

**Goal**: no page left in the old idiom, no page worse than its baseline.

- Applications: the dashed wells become a quiet "No applications" line; a
  column is the subtle surface with no outline. A drag writes a stage event,
  so it is not tried on the live board: the hooks `board.mjs` reads
  (`data-drop-stage`, the cards' data attributes) are diffed before and
  after, and `board.test.ts` stays green.
- `Empty` gains `title` and `action`; every use says what is missing, why it
  matters and offers one way forward.
- `/resumes/:id`, `/jobs/:id/target`, the `/screen` pages: tokens arrive by
  themselves — look at them, fix what broke, measure; one primary per region
  on the target page. No structural change there: `target-page.mjs` finds
  its elements by id and data attribute.
- Error flashes: any that says only that something failed gains what failed,
  what is safe, and the way forward.
- The full twenty-page table into metrics.md. A number worse than stage 0 is
  fixed or explained in one sentence.
- CLAUDE.md, README "Day to day" and ARCHITECTURE.md read against what the
  pages now say (`tokens.ts`, `runs-summary.ts`, `job-tabs.ts` in the file
  map).

## 6. Later, each with its trigger

- **Charts** — with TASKS §20's `search-funnel`: `src/web/chart-svg.ts`,
  pure functions returning an SVG string (one emerald series, neutral
  seconds, a subtle grid, tokens as `rgb(var(--…))`), wrapped in a
  `<figure>` whose `<figcaption>` says the finding in a sentence, with
  "View chart data" as a disclosure over a real table; "Not enough data
  yet" instead of an empty grid. No chart library (v2 §22, C §19–20).
- **Dark theme** — when the owner asks for it: a second value set in
  `tokens.ts`, the same contrast test over it, Radix Colors as the source
  (TASKS §8).
- **Inspector / drawer, richer comboboxes** — when a task is shown to need
  them that a page, a `?tab=`, a `<details>` or a native `<dialog>` cannot do.
- **First-run follow-through** (TASKS §20) — after stage 4: its "next three
  things" card takes `MetricStrip`'s surface instead of a fifth card.
- **One name for the score and one for the flow** (audit COPY-3's rename
  half) — its own block. It answers "nothing is clear" as much as any pixel,
  but it renames things across pages, prompts-adjacent copy and docs, and
  deserves its own diff.
- **Sidebar counters** — if `Layout` ever receives data.

## 7. Owner items

- Review and merge the eight stacked PRs in order; tag per
  `release-discipline` (the commands are in each PR body).
- README screenshots (`docs/screenshots/*.png`) and the site's
  `site/public/img/*.webp` show the old look after the merge. Re-shooting
  them is not automated on purpose: they are published, and they must be
  taken on data the owner chooses to show. The `demo-loop` block of TASKS §20
  should be recorded after this work, not before.
- Tune by eye what no number decides: the canvas tint, the sidebar's ground,
  whether 26 px is the right title.

## 8. What stays visible (by meaning; from 11-ui-copy.md and 12)

Never moved behind a disclosure; may be shortened only if it still says the
same thing.

- Any page: why a score is capped; why a keyword does not count; why a value
  is "unknown"; why a claim was blocked; why a job looks suspicious; what an
  AI call will cost in time or money before the button is pressed; privacy
  facts; the blast radius of a destructive action; how to recover from an
  error.
- Settings: what Save & re-classify costs, how long it takes and that
  applied jobs are exempt; the ceiling on running searches; the dated
  measurement on the classifier card; that a webhook URL is a secret; the
  employer-mode paragraph on personal subscriptions, the "not legal advice"
  note, the GDPR / AI Act notice, that applicant data is deleted with the
  screening, that switching the mode off hides screenings and keeps files.
- Compare and the targeted view: why the live number and the analysed
  verdicts differ; what Save as vN does and how long it takes; that Rewrite
  all spends a call and the score stays; that a one-off file is never added
  to Resumes; "Ready to apply"; the sentence on what Save can do with this
  file.
- Screening: the redaction list; that protected characteristics are refused;
  that a failed gate is about the posting's conditions; the upload caps; that
  the tool never changes a criterion or writes a decision; that a changed
  rubric makes every score stale; the delete confirmation.
- Welcome: that the test is one tiny AI call; the batch size and what is
  skipped for free; that the key lives in your database; that nothing is
  saved until the button is pressed; that the profile is built for software
  roles; what "nothing from N sources" usually means; that boards arrive
  switched off.
- Job page: that France Travail's licence asks for the whole offer; "also
  listed elsewhere — apply once"; the applied-resume snapshot lines; that
  Re-classify runs the AI; the description-replacement notice.
- Resume page: that the clean version is not the original design and changes
  nothing; what Save can and cannot write; the template author's name; the
  delete confirmation; that a new search starts switched off.

## 9. Starting the work in a new session

Paste this; it is the whole hand-over:

```text
Прочитай CLAUDE.md, потім повністю docs/ui-redesign-plan.md і секцію 22 у docs/TASKS.md.
Виконай редизайн дашборда за цим планом автономно, стадія за стадією, починаючи з першої
непозначеної стадії в TASKS §22.

Правила роботи:
- Протокол кожної стадії описано в розділі 4 плану: гілка від попередньої стадії (stacked PR),
  швидкий цикл на порту 4848 проти бази на 5433, заміри docs/ui-redesign/measure.js до і після,
  скриншоти 1440/768/375 у ~/applypack-evidence/ui-redesign/<гілка>/, lint + тести + npm run css,
  клавіатурна і no-JS перевірка, ui-review, code-review-expert, PR, перевірка CI, галочка в
  TASKS §22 і таблиця в docs/ui-redesign/metrics.md.
- Ціль кожної стадії — число, назване в плані. Якщо число не рухається, стадія не готова.
- Не мерж і не тегай. Жодної prisma-команди. `npm start` не запускай: на цій машині .env
  задає DATABASE_URL, і лаунчер підняв би воркер проти справжньої бази. На живій базі лише
  GET: не натискай фіолетові (AI) кнопки, Fetch now і нічого, що пише в базу. POST-поведінку
  перевіряє route smoke у CI (план §4.2).
- Після відкриття PR і зеленого CI одразу переходь до наступної стадії, не чекаючи мержу.
  Зупиняйся лише за правилами §4.5 плану.
- Якщо контекст стає важким, заверши поточну стадію, онови TASKS і пам'ять, і скажи, що
  наступну стадію можна запускати цим самим промптом у новому вікні.
- Після кожної стадії дай короткий звіт: що змінилось, числа до і після, посилання на PR.
```
