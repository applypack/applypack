---
name: ApplyPack
description: A clear, light console for a one-person job search — numbers that lead, white cards on a quiet canvas, a visible type ladder, tinted status pills and icon tiles, one emerald accent.
colors:
  surface: "#F3F5F4"
  surface-raised: "#FFFFFF"
  surface-overlay: "#EBEFED"
  surface-selected: "#E0F2E8"
  line: "#D9DFDB"
  line-strong: "#BCC6C0"
  ink: "#0D1421"
  ink-muted: "#3D4859"
  ink-faint: "#566173"
  accent: "#059669"
  accent-strong: "#047455"
  accent-deep: "#065F46"
  ok: "#047455"
  warn: "#A8470A"
  danger: "#B42318"
  info: "#1D4ED8"
  violet: "#6D28D9"
typography:
  title:
    fontFamily: "Inter, 'Noto Sans Devanagari', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: "36px"
    letterSpacing: "-0.025em"
  kpi:
    fontFamily: "Inter, 'Noto Sans Devanagari', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: "36px"
    letterSpacing: "-0.03em"
  section:
    fontFamily: "Inter, 'Noto Sans Devanagari', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "18px"
    fontWeight: 650
    lineHeight: "26px"
    letterSpacing: "-0.015em"
  entity:
    fontFamily: "Inter, 'Noto Sans Devanagari', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "22px"
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Inter, 'Noto Sans Devanagari', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Inter, 'Noto Sans Devanagari', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 550
    lineHeight: "18px"
  note:
    fontFamily: "Inter, 'Noto Sans Devanagari', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  meta:
    fontFamily: "Inter, 'Noto Sans Devanagari', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  mono-value:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-strong}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  button-primary-hover:
    backgroundColor: "{colors.accent-deep}"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-overlay}"
  button-violet:
    backgroundColor: "rgb(109 40 217 / 0.05)"
    textColor: "{colors.violet}"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  button-ghost:
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  badge-neutral:
    backgroundColor: "{colors.surface-overlay}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  card:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.lg}"
    padding: "20px"
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "7px 12px"
---

# Design System: ApplyPack

## Overview

**Creative North Star: "The Job-Search Console"**

A clear, light console for a daily job search. The dashboard is opened twice a
day, briefly: it has to say what the search did and whether it is working
before anyone reads a sentence. So the numbers lead — four status cards with
their last fortnight, one chart of the matches over time — and everything else
is built to be scanned: white cards on a quiet canvas, a white menu, a type
ladder the eye reads before the words, an icon on a tinted tile where a row
needs a picture.

The personality is professional, crisp, modern, information-first. Contrast
does the work that decoration would otherwise do: near-black ink, helper text
held a step above WCAG AA, card edges that read on the canvas, one emerald
accent that is never spent on ambience. Status speaks in a five-tone
vocabulary of tinted pills and tiles (blue / amber / emerald / violet / gray)
that never rises to a saturated fill. Controls are plain and one height, so a
row of them lines up without thought.

Two looks are refused: the dark hacker dashboard (glowing terminals,
neon-on-black) and the decorated admin template (glassmorphism, animated
gradients, hover-lift, a chart for its own sake). Only a light theme is
implemented; every colour flows through semantic CSS-variable tokens, so a
dark theme later is a second set of values, not a component rewrite.

**Key Characteristics:**
- Canvas ground (#F3F5F4), white cards and a white menu, a subtle third
  surface (#EBEFED) for table headers and wells
- A type ladder visible at a glance: 30 / 18 / 15 / 14 / 13 / 12 px, and one
  32 px step for a number that leads
- One brand accent (emerald); status as tinted pills and icon tiles, never fills
- Inter for all UI text; monospace strictly for machine values
- Cards with 12px corners, a hairline outline and a soft shadow; controls with
  8px corners at one height (36px)
- Charts drawn by the server as inline SVG: one series, a sentence, real data
- Drawn stroke icons from one family (Lucide), never emoji or Unicode glyphs


## Words

One name for each thing, on every page, in every flash and in the docs
(TASKS U17, the plan's Q11). A second word for the same thing reads as a
second thing.

| Say | For | Never |
| --- | --- | --- |
| **Tailor resume** | the flow that fits a resume to one posting: the launcher (`/target`, "Tailor resume" in the menu) and the editor it opens (`/jobs/:id/target`) | "targeted view", "optimise" |
| **Compare** | the button that runs one comparison — the action, never the flow | "Compare page" for the launcher |
| **match score** | how well a resume answers a posting, 0–100, the deterministic number of ADR 0012 (the ring, the Resume match tab, "editing can reach a match of 92") | "fit" for this number |
| **a match**, **matches** | a posting that clears a search's fit floor — what an alert sends, "the best match" on the Overview | a posting under the floor |
| **fit**, **fit score** | how well a posting suits a search, 0–100, the classifier's verdict (the Fit column, the fit floor) | "match" for this number |
| **search** | one search profile: what to hunt, where, and with which resume (Settings → **Searches**) | "profile" in a label |
| **posting** / **job** | a posting is the text an employer wrote; a job is our row that holds it | "vacancy", "listing" in a label |
| **screening**, **applicant** | employer mode: the position and the people who applied to it | "candidate" for an applicant |
| **strength review** | a resume judged on its own, no posting | "resume score" |

## Colors

A near-neutral field, faintly green, with a single emerald voice and a
five-tone status vocabulary. Every value is declared once as an RGB triplet in
`src/web/tokens.ts` (`surface: [243, 245, 244]`), reaches the page as
`--surface: 243 245 244` on `:root` (`layout.tsx`) and is consumed as
`rgb(var(--token) / alpha)` through `tailwind.config.js` — components never
hard-code hex. `tokens.test.ts` holds every text colour to its floor on every
surface it can sit on; a value that fails does not ship.

### Primary
- **Emerald** (#059669): the one brand accent. Focus rings (2px outline, 2px
  offset), text selection (18% tint), the "AP" mark, tints and rings, the
  chart's line and bars.
- **Emerald Strong** (#047455): links, primary buttons, the current tab's
  underline, the active nav item, the focused control's border — the
  AA-on-every-surface workhorse. Deepened in 2.40.0 so an emerald chip still
  reads 4.7:1 on the darker canvas.
- **Emerald Deep** (#065F46): primary button hover; link hover.

### Status
- **OK Green** (#047455): Applied status, enabled toggles, healthy runs, fit
  scores ≥ 85, a rising trend.
- **Info Blue** (#1D4ED8): New status, fit scores 70–84.
- **Warn Orange** (#A8470A): Alerted status, mid fit scores (50–69), warn
  flashes. A shade warmer since 2.40.0 (it was the browner #A24F0A), and
  4.9:1 on its own pill. The solid `warn` button variant is defined in
  `ui.tsx` and no page uses it.
- **AI Violet** (#6D28D9): the Saved status and AI-spend actions only — see the
  named rule below.
- **Danger Red** (#B42318): destructive actions and error flashes; the word is
  red on a plain control outline, never a solid red button.
- Dismissed / absent / unknown renders neutral: subtle-surface pill, muted ink.

### Neutral
- **Canvas** (#F3F5F4, `surface`): the app ground behind everything.
- **Raised White** (#FFFFFF, `surface-raised`): cards, tables, panels,
  controls, the menu — where work happens.
- **Subtle** (#EBEFED, `surface-overlay`): table headers, toolbars, wells,
  inactive regions, inline code, option chips, a neutral tile.
- **Selected** (#E0F2E8, `surface-selected`): the active nav item, a chosen
  option, a filter in force, a checked pill; table rows hover at 50 % of it.
- **Divider** (#D9DFDB, `line`): row dividers and the outline of a card.
- **Control Border** (#BCC6C0, `line-strong`): inputs, selects, secondary
  buttons, scrollbar thumbs, a chart's baseline.
- **Ink** (#0D1421): primary text.
- **Muted Ink** (#3D4859): secondary text, table headers, a page's one
  sentence.
- **Faint Ink** (#566173): hints, meta, placeholders, timestamps, group
  labels — 5.4:1 on the selected surface, its hardest ground.

Contrast is a tested number, not a judgement. Body and helper text (ink, muted
ink, faint ink) holds **5:1** on all four surfaces and on the row hover — a
step above AA, because it is small and everywhere; a status tone holds AA
(4.5:1) on white, on its own pill, on its flash and on the canvas; white holds
AA on every solid button.

### Named Rules
**The One-Accent Rule.** Emerald is the only brand colour. The status tones are
vocabulary, not decoration: they appear where they carry state or name a kind
of thing (pills, tiles, dots, toned numbers, a status card's bars) and never
as ambient colour.

**The Tinted-Pill Rule.** Status renders as a tinted pill or tile — 12 % tone
over white, full-strength tone text, 25 % tone inset ring — never as a
saturated fill. The pill carries its own white ground, so it reads the same on
the canvas, in a table and on a subtle well. A status colour at 100 % opacity
may only paint dots, bars and text.

**The Violet-Means-AI Rule.** Violet (#6D28D9) is reserved for AI/model-spend
actions — Compare, Re-analyze with AI, Re-scan, Re-classify, HN Run now — and
for the Saved status. It signals "this button costs AI credit or marks a save."
It must never become a general secondary accent.

## Typography

**UI Font:** Inter, bundled (`/static/fonts/inter-latin.woff2`, variable weight
400–700) with `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
fallback. Two more faces serve the interface's other scripts and are fetched
only by a page that holds them (`unicode-range`): Inter's Cyrillic subset, and
Noto Sans Devanagari for the script Inter does not draw (ADR 0061)
**Machine Font:** system mono stack (`ui-monospace, SFMono-Regular, "SF Mono",
Menlo, Consolas, monospace`)

**Character:** One family doing everything, differentiated by size and weight
rather than by face. The ladder must be visible at a glance on every page —
title > section > entity > body > label > meta — and a page's title is its
strongest element. Titles tighten; numbers align (`tabular-nums`); nothing is
ever uppercase-tracked.

### Hierarchy
Each step is one Tailwind class (`tailwind.config.js` carries size, line,
tracking and weight together), so a page writes `text-title`, not four
utilities. `src/web/type-ladder.test.ts` fails a raw size (`text-xs`,
`text-[13px]`, `text-base` …) or a `text-sm font-semibold` heading anywhere
in `src/web`, with no exception left.
- **Title** (`text-title`, 700, 30px/36px, tracking -0.025em): the page's one
  `h1`, at the left of the header with the page's one sentence under it.
- **KPI** (`text-kpi`, 700, 32px/36px, tracking -0.03em, tabular-nums): a
  number that leads — a status card's value, the chart's total, the score
  ring.
- **Section** (`text-section`, 650, 18px/26px, tracking -0.015em): a card's
  title (`CardHeader`), a page-level section outside a card
  (`SectionTitle level="section"`), a settings section, the wordmark.
- **Entity** (`text-entity`, 600, 15px/22px): a row's name — a job, a resume,
  an engine — a small card's heading (`SectionTitle`), the number in a fit
  tile.
- **Body** (400, 14px/20px): default for everything — table cells, forms,
  buttons, nav, a page's one-sentence intro (muted ink). Medium (500) marks
  emphasis: row titles, button labels, nav links.
- **Label** (`text-label`, 550, 13px/18px): field labels, table headers,
  fieldset legends, sidebar group labels, a status card's label.
- **Note** (`text-note`, 400, 13px/20px): a standing notice, a quiet
  disclosure, a tab's link, a row's secondary line, a small button's text.
- **Meta** (`text-meta`, 400, 12px/16px): timestamps, counts, axis ticks,
  badges (at 500), helper prose under a control (`Hint`).
- **Mono Value** (400, 12px, mono stack): ids, tokens, cron expressions,
  durations, code — machine values only, usually one size below their context.

### Named Rules
**The Machine-Mono Rule.** Monospace is strictly for machine values — ids,
tokens, cron names, durations, code. Prose, labels, titles, and numbers-in-prose
stay in Inter; numeric columns align with `tabular-nums`, not with mono.

## Layout

A fixed app frame, not a scrolling document: `flex h-dvh overflow-hidden` with a
240px white menu (`lg:w-60`) at desktop, a 64px icon rail at tablet
(`md:w-16`), and an off-canvas drawer on mobile (16rem wide, 200ms slide,
dimmed backdrop). Content owns the scroll: the main region scrolls vertically,
and pages that manage their own inner scrolling (the Jobs table, the
Applications board) opt into `fill` mode to pin their scroller to the viewport.

Content gutters are 16px, stepping to 24px ≥640px and 32px ≥1024px. A page
opens with `PageHeader`: the title and its one sentence at the left, what the
page offers — a quiet meta line, a status pill, the buttons — at the right,
level with the title. Cards stack and grid at 16px gaps. Detail pages split
into a fluid main column and a 340px facts-and-actions rail at ≥1280px (rail
first in DOM so actions lead on small screens). Settings puts its six tabs in
a sticky left column of links from 1024px and keeps them as a segmented row
below that — same `?tab=` URLs either way. The launchers (Compare, Cover
letter, New screening) show one input mode at a time: the body of a mode whose
radio is not checked folds away in CSS (`:has()`), its fields still in the
form; the alert window on Settings → Schedule folds the same way. The
Applications board scrolls horizontally through 288px fixed-width stage
columns.

**The Overview** is the dashboard and sets the language: four status cards in
a row, then a main column (the matches chart with the search funnel at its
foot, then the recent alerts) beside a narrower one (pipeline health, recent
activity, jobs by stack). The fourth card and the side column share one grid
track (`minmax(18rem, 27%)`), so their edges line up; under 1280px everything
stacks, the cards two by two.

All spacing sits on the 4px grid; the working steps are 4 / 8 / 12 / 16 / 20 /
24 / 32px. 20px card padding, 12px table cells, 16px between cards.

## Elevation & Depth

Depth is layered with the surfaces — canvas ground, white raised work, the
subtle well, the selected tint — and finished with a hairline and a soft
shadow, so a card reads as a card on the canvas without a heavy edge. A region
of a page is ONE raised surface with dividers inside it, not a stack of
bordered cards; a dashboard is the exception its name says — separate cards,
each about one thing. Borders stay where a control or an object ends; wrappers
around wrappers lose theirs. Sticky table headers replace their border with an
inset hairline shadow so the line survives scrolling.

### Shadow Vocabulary
Tinted with the ink, never black (`tailwind.config.js`):
- **Control** (`shadow-sm`, `0 1px 2px rgb(13 20 33 / 0.06)`): inputs, filled
  and outlined buttons, the chosen segment of a switch.
- **Card** (`shadow-card`, `0 1px 2px rgb(13 20 33 / 0.04), 0 2px 8px -2px
  rgb(13 20 33 / 0.06)`): a raised surface at rest.
- **Pop** (`shadow-pop`, `0 4px 8px -2px rgb(13 20 33 / 0.08), 0 16px 32px -8px
  rgb(13 20 33 / 0.16)`): what floats — a confirm popover, an info tip, the
  chart's hover card.
- **Drawer** (`box-shadow: 0 8px 30px rgb(16 24 40 / 0.12)`): the mobile nav
  drawer, paired with a `rgb(16 24 40 / 0.4)` backdrop.
- **Header hairline** (`box-shadow: inset 0 -1px 0 rgb(var(--line))`): the
  bottom edge of sticky table headers.

### Named Rules
**The Surface-First Rule.** A region is set apart by its surface AND one of:
spacing, a heading, a divider, an indicator — never by a background alone.
State is never a background alone either: a selected option also gets
emerald-strong text at weight 500 and a drawn check or a left bar; the active
nav item gets the tint, the emerald text at 600 and a bar at the menu's edge.

**The One-Surface-Per-Region Rule.** A settings tab, a job page's main column,
a filter panel: one raised surface with dividers inside it. A card is for an
object that stands alone — a board card, a mode box, a resume, a status card,
a dashboard block. `Card variant="flat"` is a part of such a region,
`"subtle"` a well inside it.

**The Soft-Shadow Rule.** Shadows say "raised" and "floating", nothing more:
no glows, no coloured shadows, no hover-lift. A card's border darkens on hover
when the whole card is a link; it never moves.

## Shapes

A three-step radius ladder under Tailwind's own names (`tailwind.config.js`
sets them): 12px (`rounded-lg`) for cards, tables, panels, wells and empty
states; 8px (`rounded-md`) for every control and chip — buttons, inputs,
selects, nav links, tags, option chips, filter chips, tiles, the fit tile; 4px
for the smallest chrome (inline code, focus-ring corners, scrollbar thumbs).
Badges, dots and bars are full pills.

Borders are 1px everywhere — the divider (#D9DFDB) on surfaces, the control
border (#BCC6C0) on interactive controls, tone-tinted (25–50% alpha) on
stateful elements. Icons are one family — Lucide's paths in
`src/web/icons.tsx`, drawn by `Icon` on the 24px grid with round caps and
joins: 14px in a line of text, 16px in a button or a row, 18px in the menu,
20px in a tile (at a 1.75 stroke). A new icon is a new row in that file, never
a second family.

## Components

Every page composes the primitives in `src/web/ui.tsx`; colour and spacing
decisions live there and in the token layer, not in page files.

### Buttons
- **Shape:** 8px radius, 500 weight, 150ms colour transition; three heights —
  sm 30px (13px text) in a table row, md 36px (14px) beside a field, lg 40px
  for a page's main act. A button beside a field is md: the two are one
  height. An icon sits before the label at 16px. Disabled is 40% opacity.
- **Primary:** solid Emerald Strong (#047455), white text, control shadow;
  hover deepens to #065F46. One per view region — the main affirmative act
  ("Fetch now" on the Overview).
- **Secondary:** white with the control border, ink text; hover fills the
  subtle surface. The default for everything non-primary.
- **Violet (AI):** violet text on 5% violet tint with 30% violet border; hover
  10% tint. Only for actions covered by the Violet-Means-AI Rule.
- **Danger:** the word in danger red on the secondary button's outline; hover
  tints the fill 5% and the border 40% danger. Never solid red, and never a
  red outline at rest — a column of Deletes must not shout.
- **Warn:** solid orange (#A8470A), white text. Defined, unused: the pause
  acts use the secondary button.
- **Ghost:** borderless muted-ink text; hover subtle fill + ink text. For
  tertiary row actions.
- **Focus:** global ring — 2px emerald outline, 2px offset, 4px corner.
- **Confirm (`ConfirmAction`):** a delete, a removal or a spend that deserves
  a second look opens a native popover (`popovertarget`, no JavaScript) in the
  middle of the screen — the sentence of what will happen, Cancel (focused)
  and the real button. It sits in the top layer, so a table's scroll box never
  clips it; Escape or a click outside closes it. Never `confirm()`: without a
  script it asked nothing and the delete went through.

### Badges, Tags & Tiles
- **Status pill (`Badge` / `StatusBadge`):** full pill, 12px/500 text; 12% tone
  over its own white ground, tone text, 25% tone inset ring. The word in its
  tone is the status, so `StatusBadge` carries no dot; a state pill (Running,
  Enabled) leads with a 6px `currentColor` dot. `size="md"` (13px, 6×12px) is
  the pill that stands in a page header beside the buttons. Status mapping:
  New=info, Alerted=warn, Applied=ok, Saved=violet, Dismissed=neutral.
- **Tag:** the same tinting at 8px radius, 12px/500 — technologies, rule
  chips. A technology is written the way people write it
  (`src/web/tech-label.ts`: TypeScript, Node.js, AWS), never as the
  classifier's lowercase tag.
- **Icon tile (`IconTile`):** an icon on its tone's pill ground, 40px at 8px
  radius — what a status card or an activity row is about, at a glance.
- **Avatar:** who a row is about, as the first letter of the name on a neutral
  tile. No logo is ever fetched, and the tile takes no tone — a tone means a
  status.

### Fit tile (signature)
`FitBadge`: the fit score as a number in a toned tile — 15px/600 tabular-nums
on the tone's pill ground at 8px radius. The number is the value and the tone
its floor, so it reads without colour. Tone thresholds: ≥85 ok, ≥70 info, ≥50
warn, below neutral; null renders an em dash; `worded` adds the floor's word
("72 Good") on a job page's header.

### Tables
- **Header:** the subtle surface at 70%, the label step (13px/550) in muted
  ink, hairline bottom edge; optional sticky mode swaps the border for an
  inset shadow; 20px outer-column padding.
- **Body:** white; rows divided by hairlines, 12×16px cell padding, hover tints
  the selected surface at 50%, 150ms. Nothing a row offers depends on hover.
- **A place in a row** is a few words — "Remote · USA, Canada +3"
  (`src/web/place-line.ts`), the places the running searches hunt in named
  first, every country in the tooltip — never a row of flags.
- **Fixed layout:** wide list tables set proportional column widths and a
  min-width wrapper that scrolls horizontally inside the card.
- **On a phone:** a wide list keeps the two or three columns that name a row
  and say its state (`hideBelow`); the rest join as the screen widens, and the
  min-width wrapper starts at `md` or `lg`.

### Inputs / Fields
- **Style:** white, control-border 1px, 8px radius, 7×12px padding (36px tall),
  14px text, faint-ink placeholder, control shadow.
- **Hover / Focus:** border darkens to faint ink on hover; focus turns the
  border emerald-strong — the 3:1 indicator — and adds a 2px ring at 25%
  emerald for softness. Calm, no glow.
- **Select:** identical, with a drawn 14px chevron (data-URI SVG, faint-ink
  stroke) replacing browser chrome.
- **Field:** the label step (13px/550) in ink, an optional one-sentence hint
  at the meta step, 6px gap to control. The `<label>` wraps only those three;
  `more` renders a quiet "How this works" disclosure outside it, so a long
  explanation never becomes the control's accessible name. `ToggleRow`,
  `TagListInput` and a settings `Section` take `more` the same way.
- **More (`More`):** the rest of an explanation — a quiet `Disclosure` whose
  body is meta-step prose carrying the hint hook.
- **Choice controls:** native checkboxes/radios tinted via `accent-color`;
  PillCheckbox and Radio wrap them in bordered white containers whose checked
  state takes the selected surface and a 40–50% emerald border — the native
  mark is the second channel.
- **A segmented switch** (the chart's 7D / 30D / 90D / 180D): links on a
  subtle track, the current one on white with the control shadow and
  emerald-strong text, `aria-current`. Links, not buttons: the choice rides in
  the URL.

### Cards / Containers
- **`Card`:** 12px corners, white, divider outline, card shadow, 20px padding
  (`flush` removes the padding and clips children for tables and lists).
- **`CardHeader`:** what a card holds, said at its top — the title at the
  section step, an optional (i) whose one sentence shows on hover and on focus
  with no script, and the card's one way onward at the right (`CardLink`:
  "View all →", or a control). A small card inside a region still uses
  `SectionTitle` (the entity step).
- **`Card variant="flat"`:** no border, shadow, fill or padding — a part of a
  region that is already one surface. **`variant="subtle"`:** the subtle fill,
  12px corners, no outline — a well or an inactive region.
- **Status card (`StatCard`):** one number that stands alone — its icon tile,
  the label, the value at the KPI step, one line of what moved ("+14 in the
  last 24h", the count in OK green), and the last fortnight as a row of bars
  in the status tone on the number's row. With `href` the value is a link
  stretched over the card and the card's border darkens on hover. The bars
  are decoration for the eye (the line under the number says it in words);
  in a narrow card they give way before the number does.
- **A run as a sentence (`/runs`):** `runs-summary.ts` turns a run's stats into
  facts in a fixed order ("594 fetched · 3 new · 55 duplicates · 3 classified
  · 0 alerted"), the dot between them drawn; a reason reads as a sentence
  ("Discovery is switched off"). The stats JSON and the per-source list fold
  behind **Details** on the same line — raw machine output is never a page's
  primary content — and runs past the latest fifty fold behind a button that
  names any failure among them.

### Charts
A chart answers one question and says its answer in a sentence. The server
draws it as inline SVG (`src/web/chart-svg.ts`, pure), so it is in the page
before any script and without one; no chart library, no canvas, nothing
fetched.
- **The matches chart (`pages/matches-chart.tsx`):** one emerald line over a
  fading emerald fill, smoothed without overshoot (it never dips under zero
  between two days), on hairline grid lines at whole-number ticks. The plot is
  stretched to its card; the ticks and the dates are HTML beside it, so no
  label ever scales. Above it: the total at the KPI step, the change against
  the equal range before (a percentage only when that range holds ten or
  more — "+3" says more than "+300%"), and nothing at all when there is no
  earlier range to compare.
- **Range and filter ride in the URL** (`?range=7d|30d|90d|180d`, `?stack=`):
  links and a plain form, so the page's refresh keeps what was picked. A long
  range reads in wider steps — thirty points at most.
- **Hover (`public/chart.mjs`):** a dashed guide, a dot and a small card — the
  day, the count, the move from the point before; arrow keys walk the points
  once the plot has focus. Without the script the chart is unchanged.
- **For a screen reader** the plot is one image named by the sentence, and the
  same numbers follow as a table.
- **Sparkline bars** (on a status card) and **share bars** (Jobs by stack) are
  plain elements sized inline — a fortnight fading towards its oldest day, a
  flat emerald bar on a subtle track.
- **Honest numbers:** days are UTC, the key the daily rollup is stored under;
  a day nothing happened on is a zero; anything by technology looks back
  thirty days, because that is how long a dismissed job is kept.

### Navigation
- **Sidebar:** white, a hairline right edge; a 64px brand row (the emerald
  32px "AP" mark + the wordmark at the section step). Overview stands alone,
  then four groups with sentence-case labels at the label step in faint ink —
  *Work* (Jobs, Applications), *Tools* (Resumes, Tailor resume, Cover
  letter), *Research* (Companies, Discovery), *System* (Runs, and Screening
  while employer mode is on). Links are 14px/500, 8px radius, 8×12px padding,
  18px icon + label; active = selected surface, emerald-strong text and icon
  at 600, a 4px emerald-strong bar at the menu's left edge; inactive = muted
  ink, hover the subtle surface. Settings and a privacy footnote pin to the
  bottom. Tablet collapses to a 64px icon rail where a short hairline stands
  in for each group label; mobile is a drawer behind a hamburger bar.
- **Tabs (`Tabs`):** views of one list — or the parts of one object, as on the
  job page (`?tab=`, server-rendered, no client state) — as a row of 13px links
  on a hairline;
  the current one carries a 2px emerald-strong underline, 500 weight and
  `aria-current="page"`, and a faint tabular count says what the tab would
  show. Never a pill — a tab must not read as a filter or a status.
- **Disclosure (`Disclosure`):** native `<details>`, no JavaScript. `button`
  is a secondary button with a count on the selected surface and a chevron
  that turns when open (a toolbar's "Filters"); `quiet` is a 13px muted line
  under a control.
- **Filter options (the Jobs panel):** 8px-radius links on the subtle surface
  with a faint count; a chosen one takes the selected surface, emerald-strong
  500 text and a drawn check — never colour alone.
- **Filter chip (`FilterChip`):** a criterion in force, above the table: 8px
  radius, the selected surface, 30% emerald border, a drawn ✕. The whole chip is
  the link that lifts it (`aria-label="Remove filter: …"`).

### System Feedback
- **Flash:** rounded 8px banner, 25% tone border, 5% tone fill, tone text, with
  a drawn 16px icon; ok, warn and danger kinds. An error says three things:
  what failed, what is safe, the way forward. "Invalid form values" says none.
  When a schema refused one field, the field says so too: a danger border and
  ring (`aria-invalid`), described by the message, and focused.
- **Notice:** the same shape for what a page says on every render — the
  pipeline is paused, matches are waiting for the alert window.
- **Empty state (`Empty`):** a drawn 20px icon on a 40px neutral tile, then
  three parts, centered: the title (what is missing, entity type), one muted
  sentence (why it matters) and at most one action (a small secondary button,
  or the sentence names the control already on the page). A card on the
  canvas; `bare` inside a card, which stays the one surface.
- **Board column:** the subtle surface, 12px corners, no outline; an empty
  column says "No applications" in one faint meta line. No dashed wells: the
  surface already reads as a place to drop.
- **ToggleRow:** label + ok/neutral dot-pill beside an Enable/Disable button —
  the settings on/off idiom.

### Screening (employer mode, ADR 0047–0052)
The other side of the table reuses every primitive above; what is new is
vocabulary, not chrome.
- **Gate buckets:** three, in this order and these words — *Priority to talk
  to* (ok), *Ask first* (warn), *Did not pass a gate* (danger) — never "best
  candidate". A gate is a fact about the posting's conditions, so the danger
  tone marks the bucket, not the person.
- **Score cell:** tabular number; `*` after it means capped and the scorecard
  says why; the person's adjustment reads `85 → 95` with a small `+10`, the
  computed number kept in the tooltip and both exports. During a run the
  cell shows the previous verdict muted and prefixed *was*, never a number
  that looks new.
- **Run badges:** *queued* (neutral) · *scoring…* (info) · *scored — refresh*
  (ok), painted per row from `/screen/:id/state`; the progress line above
  the table is a live region.
- **Scorecard:** who / did / verdict at the top, then one row per criterion
  with its quote from the redacted text; a quote is the evidence, an unquoted
  answer is shown as unknown. "Stands out" is a list of facts, never a score.
- **Criteria editor:** one row per criterion — kind, the person's words, a
  Gate / Scored / Note choice, stars for weight, Remove — and a last row that
  adds one. A row naming a protected characteristic is refused with the
  lawful criterion offered in its place.
- **Decisions:** the one write the tool never makes; the decision select is a
  plain control, never violet (violet means AI spend). Calibration shows
  counts beside every ratio and changes nothing by itself.
- **The redaction line:** what was removed before the model read a word, on
  the scorecard and at intake; the name is shown to the person only.

### Named Rules
**The Drawn-Icon Rule.** Every icon is a drawn SVG stroke on the 24px Lucide
grid — `Icon` for the family in `src/web/icons.tsx`, plus the select chevron
and the check/x marks drawn in place. Emoji, Unicode glyphs, and icon fonts
never stand in for icons.

**The Composed-Primitive Rule.** Pages compose `ui.tsx` primitives and never
hand-roll Tailwind for shared patterns; new visual decisions land in the
primitive or the token layer first.

**The Disclosure Rule.** Under a label, one sentence. What explains a cap, a
cost, a gate, a privacy fact or a destructive act stays visible; everything
else sits behind a quiet `Disclosure` ("How this works"), outside the label so
it never becomes the control's accessible name. Filters, inactive input modes,
a setting that belongs to an unchosen mode and raw machine output fold the
same way — native `<details>` or one `:has()` rule, no JavaScript.

**The One-Question Rule.** A chart, a number or a bar is on a page because it
answers a question someone asks of the search — is it finding anything, more
or fewer than before, what do the matches ask for. It carries its unit, its
period and a way to the rows behind it. A figure nobody can act on is not
drawn.

**The Measured-Change Rule.** A UI pull request names a number from
`docs/ui-redesign/measure.js` — tab stops before the table, visible hint
words, boxes, primaries, height — and reports it before and after
(`node docs/ui-redesign/shoot.js`). If the number does not move, the change is
not done.

## Do's and Don'ts

### Do:
- **Do** route every colour through the semantic tokens (`surface` / `line` /
  `ink` / `accent` / status tones) as `rgb(var(--token) / alpha)`; a future dark
  theme must be a token swap, not a component edit. A chart's strokes and
  fills use the same variables.
- **Do** keep the 4px spacing grid: 20px card padding, 12×16px table cells,
  16px card gaps, one control height.
- **Do** set `tabular-nums` on every numeric readout (stats, counts, scores,
  dates in columns) and render absent values as an em dash (—), never blank.
- **Do** give every interactive element the global focus ring (2px emerald,
  2px offset) and a 150ms colour-only transition.
- **Do** pair colour with a redundant channel — the word on a status, the
  number on a fit tile, a check or a bar on a selection, a word for a screen
  reader beside a health dot — so state reads without colour.
- **Do** put a new value in `src/web/tokens.ts` and let `tokens.test.ts` say
  whether its text passes on every surface, the pill and the flash.
- **Do** mark helper prose written outside `Hint` with `data-ui="hint"`, so the
  number a UI change reports counts it.
- **Do** say what a number is over and against what: "52 jobs in the last 30
  days", "+58% vs previous 7 days".

### Don't:
- **Don't** introduce glassmorphism, animated or decorative gradients, heavy
  or coloured shadows, hover-lift, entrance animations or decorative noise.
  The one gradient in the app is the fade under the chart's line.
- **Don't** nest cards in cards, wrap a wrapper in a border, or set a region
  apart by a background alone.
- **Don't** let helper paragraphs pile up under a control, show raw JSON as a
  page's primary content, leave a page with a giant unused area, or hide an
  important action behind an unlabelled icon.
- **Don't** colour an icon or a letter tile arbitrarily, draw a chart that
  answers no question, smooth a line into values the data never had, or vary
  the focus state between controls.
- **Don't** set anything in uppercase with tracking; a group label is sentence
  case at the label step.
- **Don't** use violet for anything but AI-spend actions and the Saved status,
  and don't promote any status tone into a second brand accent.
- **Don't** fill a status with saturated colour; status stays a tinted pill
  (12% background, 25% ring).
- **Don't** show a rate without the number under it, a percentage of a
  handful, or a row of country flags where three words would do.
- **Don't** fetch a logo, a font, an icon or a script from a third party: the
  dashboard draws everything it shows.
- **Don't** set prose, labels, or headings in monospace — mono is machine
  values only.
- **Don't** go dark ad hoc: no dark-styled components or pages until the token
  layer itself grows a dark value set.
