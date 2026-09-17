---
name: ApplyPack
description: A calm, light operations console for a one-person job hunt — dense tables, a visible type ladder, three surfaces, quiet status pills, one emerald accent.
colors:
  surface: "#F5F7F6"
  surface-raised: "#FFFFFF"
  surface-overlay: "#EEF2F0"
  surface-selected: "#E4F1EA"
  line: "#DDE3E0"
  line-strong: "#C8D1CC"
  ink: "#101828"
  ink-muted: "#475467"
  ink-faint: "#5F6B7E"
  accent: "#059669"
  accent-strong: "#047857"
  accent-deep: "#065F46"
  ok: "#047857"
  warn: "#A24F0A"
  danger: "#B42318"
  info: "#1D4ED8"
  violet: "#6D28D9"
typography:
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: "32px"
    letterSpacing: "-0.02em"
  section:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "24px"
    letterSpacing: "-0.01em"
  entity:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 550
    lineHeight: "18px"
  meta:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  stat-value:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "32px"
    letterSpacing: "-0.025em"
  mono-value:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
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
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-deep}"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-overlay}"
  button-violet:
    backgroundColor: "rgb(109 40 217 / 0.05)"
    textColor: "{colors.violet}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-ghost:
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  badge-neutral:
    backgroundColor: "{colors.surface-overlay}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  card:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.lg}"
    padding: "20px"
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
---

# Design System: ApplyPack

## Overview

**Creative North Star: "The Hunting Console"**

A calm, light operations desk for a daily job hunt. The dashboard is read twice a
day, briefly, in indoor daylight: it must be dense, quiet, and instantly legible.
The composition is a Linear-density work surface — a fixed 240px sidebar on the
subtle surface, a canvas ground, white surfaces carrying the data. Structure
comes from three surfaces and a type ladder the eye reads before the words:
title, section, entity, body, label, meta. Nothing on screen persuades or
decorates; every pixel serves reading four numbers, scanning new jobs, and
acting on one.

The personality is professional, calm, modern, information-first — compact but
not cramped. Brand lives in details rather than surfaces: an emerald focus ring,
emerald text selection, the emerald "AP" mark, an emerald primary button. Status
speaks in a quiet five-color vocabulary of tinted pills (blue / amber / emerald /
violet / gray) that never rises to a saturated fill. Controls follow a "quiet
precision" philosophy: they disappear into the task, borrowing their forms from
Stripe's settings forms and GitHub's data tables.

Two worlds are explicitly refused, per the owner's brief: the dark hacker
dashboard (glowing terminals, neon-on-black) and the AI-slop marketing admin
(gradients, glassmorphism, giant cards, 20–30px radii, decorative noise, heavy
shadows). Only a light theme is implemented today; every color flows through
semantic CSS-variable tokens so a dark theme later is a second set of values,
not a component rewrite.

**Key Characteristics:**
- Canvas ground (#F5F7F6), white work surfaces, a subtle third surface
  (#EEF2F0) for the sidebar, table headers and wells — surface first, never
  surface alone
- A type ladder visible at a glance: 26 / 18 / 15 / 14 / 13 / 12 px
- One brand accent (emerald); status as quiet tinted pills, never fills
- Inter for all UI text; monospace strictly for machine values
- One surface per region; shadow is a whisper on white surfaces only
- Dense 4px-grid spacing; 14px body type; tables and forms carry the work
- Drawn stroke icons (Lucide-style), never emoji or Unicode glyphs

## Colors

A near-neutral field, faintly green, with a single emerald voice and a
five-tone status vocabulary. Every value is declared once as an RGB triplet in
`src/web/tokens.ts` (`surface: [245, 247, 246]`), reaches the page as
`--surface: 245 247 246` on `:root` (`layout.tsx`) and is consumed as
`rgb(var(--token) / alpha)` through `tailwind.config.js` — components never
hard-code hex. `tokens.test.ts` holds every text colour to WCAG AA (4.5:1) on
every surface it can sit on; a value that fails does not ship.

### Primary
- **Emerald** (#059669): the one brand accent. Focus rings (2px outline, 2px
  offset), text selection (18% tint), the "AP" mark, tints and rings.
- **Emerald Strong** (#047857): links, primary buttons, the current tab's
  underline, the active nav item, the focused control's border — the
  AA-on-every-surface workhorse.
- **Emerald Deep** (#065F46): primary button hover; link hover.

### Status
- **OK Green** (#047857): Applied status, enabled toggles, healthy runs, fit
  scores ≥ 85.
- **Info Blue** (#1D4ED8): New status, fit scores 70–84.
- **Warn Amber** (#A24F0A): Alerted status, mid fit scores (50–69), the solid
  `warn` button for destructive-ish batch actions. Darkened in 2.12.0: the old
  #B45309 read 4.39:1 on its own pill.
- **AI Violet** (#6D28D9): the Saved status and AI-spend actions only — see the
  named rule below.
- **Danger Red** (#B42318): destructive actions and error flashes; always an
  outline-tinted treatment on white, never a solid red button. Darkened in
  2.12.0 (the old #D92D20 read 4.15:1 on its pill).
- Dismissed / absent / unknown renders neutral: subtle-surface pill, muted ink.

### Neutral
- **Canvas** (#F5F7F6, `surface`): the app ground behind everything.
- **Raised White** (#FFFFFF, `surface-raised`): cards, tables, panels,
  controls — where work happens.
- **Subtle** (#EEF2F0, `surface-overlay`): the sidebar, table headers,
  toolbars, wells, inactive regions, inline code, option chips.
- **Selected** (#E4F1EA, `surface-selected`): the active nav item, a chosen
  option, a filter in force, a checked pill; table rows hover at 50 % of it.
- **Divider** (#DDE3E0, `line`): row dividers and the outline of an object.
- **Control Border** (#C8D1CC, `line-strong`): inputs, selects, secondary
  buttons, scrollbar thumbs.
- **Ink** (#101828): primary text.
- **Muted Ink** (#475467): secondary text, table headers, a page's intro.
- **Faint Ink** (#5F6B7E): hints, meta, placeholders, timestamps, group
  labels — 4.64:1 on the selected surface, its hardest ground.

The surface steps are small on purpose (canvas → white 1.08, white → subtle
1.13, subtle → selected 1.03): a background alone never carries structure or
state — see the Surface-First Rule.

### Named Rules
**The One-Accent Rule.** Emerald is the only brand color. The status tones are
vocabulary, not decoration: they appear exclusively where they carry state
(pills, dots, meters, toned numbers) and never as ambient color.

**The Quiet-Pill Rule.** Status renders as a tinted pill — 10% tone over white,
full-strength tone text, 20% tone inset ring — never as a saturated fill. The
pill carries its own white ground, so it reads the same on the canvas, in a
table and on a subtle well. A status color at 100% opacity may only paint dots,
meter fills, and text.

**The Violet-Means-AI Rule.** Violet (#6D28D9) is reserved for AI/model-spend
actions — Compare, Re-analyze with AI, Re-scan, Re-classify, HN Run now — and
for the Saved status. It signals "this button costs AI credit or marks a save."
It must never become a general secondary accent.

## Typography

**UI Font:** Inter, bundled (`/static/fonts/inter-latin.woff2`, variable weight
400–700) with `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
fallback
**Machine Font:** system mono stack (`ui-monospace, SFMono-Regular, "SF Mono",
Menlo, Consolas, monospace`)

**Character:** One quiet family doing everything, differentiated by size and
weight rather than by face. The ladder must be visible at a glance on every
page — title > section > entity > body > label > meta. Titles tighten; numbers
align (`tabular-nums`); nothing is ever uppercase-tracked or display-sized.

### Hierarchy
Each step is one Tailwind class (`tailwind.config.js` carries size, line,
tracking and weight together), so a page writes `text-title`, not four
utilities.
- **Title** (`text-title`, 650, 26px/32px, tracking -0.02em): the page's one
  `h1`, in the header row next to meta and actions.
- **Section** (`text-section`, 600, 18px/24px, tracking -0.01em): a page-level
  section outside a card — `SectionTitle level="section"`, a settings section.
- **Entity** (`text-entity`, 600, 15px/22px): card headings (`SectionTitle`),
  a row's name, a resume, a job, an engine.
- **Body** (400, 14px/20px): default for everything — table cells, forms,
  buttons, nav, a page's one-sentence intro (muted ink). Medium (500) marks
  emphasis: row titles, button labels.
- **Label** (`text-label`, 550, 13px/18px): field labels, table headers,
  fieldset legends, sidebar group labels, filter-row labels.
- **Meta** (`text-meta`, 400, 12px/16px): timestamps, counts, the header's
  meta line, helper prose under a control (`Hint`).
- **Stat Value** (600, 28px/32px, tabular-nums): the metric strip's numbers —
  the largest type in the app after the page title.
- **Micro** (500, 12px/16px): badges and kanban counts.
- **Mono Value** (400, 12px, mono stack): ids, tokens, cron expressions,
  durations, code — machine values only, usually one size below their context.

### Named Rules
**The Machine-Mono Rule.** Monospace is strictly for machine values — ids,
tokens, cron names, durations, code. Prose, labels, titles, and numbers-in-prose
stay in Inter; numeric columns align with `tabular-nums`, not with mono.

## Layout

A fixed app frame, not a scrolling document: `flex h-dvh overflow-hidden` with a
240px sidebar (`lg:w-60`) on the subtle surface at desktop, a 64px icon rail at
tablet (`md:w-16`), and an off-canvas drawer on mobile (16rem wide, 200ms slide,
dimmed backdrop). Content owns the scroll: the main region scrolls vertically,
and pages that manage their own inner scrolling (the Jobs table, the
Applications board) opt into `fill` mode to pin their scroller to the viewport.

Content gutters are 16px, stepping to 24px ≥640px and 32px ≥1024px, with 20px
vertical padding. The page header sits 24px above the content. Cards stack and
grid at 16px gaps. Detail pages split into a fluid main column and a 340px
facts-and-actions rail at ≥1280px (rail first in DOM so actions lead on small
screens). Settings puts its six tabs in a sticky left column of links from
1024px (a rule down its side, the current tab marked on it in emerald-strong)
and keeps them as a segmented row below that — same `?tab=` URLs either way.
A settings section stacks its title (the section step) and one sentence above
its controls, each section separated by a hairline and 28px of padding. The
launchers (Compare, Cover letter, New screening) show one input mode at a
time: the body of a mode whose radio is not checked folds away in CSS
(`:has()`), its fields still in the form. The Applications board scrolls
horizontally through 288px fixed-width stage columns.

All spacing sits on the 4px grid; the working steps are 4 / 8 / 12 / 16 / 20 /
24 / 32px. Density is the point — 12px cell padding in tables, 20px card
padding, 6px vertical padding in controls — compact but never cramped.

## Elevation & Depth

Surface first. Depth is layered with the surfaces — subtle sidebar, canvas
ground, white raised work, the selected tint — and a region of a page is ONE
raised surface with dividers inside it, not a stack of bordered cards. Borders
stay where a control or an object ends; wrappers around wrappers lose theirs.
`shadow-sm` (`0 1px 2px 0 rgb(0 0 0 / 0.05)`) is a whisper applied only to
white surfaces — cards, controls, primary/secondary buttons — and reads as
material thickness, not lift. Sticky table headers replace their border with
an inset hairline shadow so the line survives scrolling. Between major blocks
of a page sit 24–32px; inside a block 12–16px.

### Shadow Vocabulary
- **Whisper** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): white surfaces
  only — cards, controls, filled buttons.
- **Drawer** (`box-shadow: 0 8px 30px rgb(16 24 40 / 0.12)`): the mobile nav
  drawer, the app's single true elevation, paired with a
  `rgb(16 24 40 / 0.4)` backdrop.
- **Header hairline** (`box-shadow: inset 0 -1px 0 rgb(var(--line))`): the
  bottom edge of sticky table headers.

### Named Rules
**The Surface-First Rule.** A region is set apart by its surface AND one of:
spacing, a heading, a divider, an indicator — never by a background alone (the
steps are 1.03–1.13). State is never a background alone either: a selected
option also gets emerald-strong text at weight 500 and a drawn check or a left
bar; the active nav item gets all three.

**The One-Surface-Per-Region Rule.** A settings tab, a job page's main column,
a filter panel: one raised surface with dividers inside it. A card is for an
object that moves or stands alone — a board card, a mode box, a resume, the
metric strip. `Card variant="flat"` is a part of such a region, `"subtle"` a
well inside it.

**The Whisper-Shadow Rule.** Surfaces are flat at rest. `shadow-sm` appears
only on white surfaces, and nothing except the mobile drawer ever casts a real
shadow. No glows, no heavy ambient shadows, no hover-lift.

## Shapes

A three-step radius ladder: 8px (`rounded-lg`) for cards, tables, panels, and
empty states; 6px (`rounded-md`) for every control — buttons, inputs, selects,
nav links, tags, option chips, filter chips; 4px for the smallest chrome
(inline code, focus-ring corners, scrollbar thumbs). Badges and meters are full
pills, and only they are. Nothing exceeds 8px; large radii are an explicit
anti-reference.

Borders are 1px everywhere — the divider (#DDE3E0) on surfaces, the control
border (#C8D1CC) on interactive controls, tone-tinted (30–50% alpha) on
stateful elements; badges use a 1px inset ring at 20% tone. Icons are drawn on
the Lucide 24px grid at 2px stroke, round caps and joins, rendered 14–18px —
geometry consistent from nav icons down to the drawn select chevron and the
check/x verdict marks.

## Components

Every page composes the primitives in `src/web/ui.tsx`; color and spacing
decisions live there and in the token layer, not in page files.

### Buttons
- **Shape:** 6px radius, 500 weight, min-height 32px, 150ms color transition;
  sizes sm (4×10px, 12px text), md (6×12px, 14px text), lg (8×16px). Disabled
  is 40% opacity.
- **Primary:** solid Emerald Strong (#047857), white text, whisper shadow;
  hover deepens to #065F46. One per view region — the main affirmative act.
- **Secondary:** white with the control border, ink text; hover fills the
  subtle surface. The default for everything non-primary.
- **Violet (AI):** violet text on 5% violet tint with 30% violet border; hover
  10% tint. Only for actions covered by the Violet-Means-AI Rule.
- **Danger:** outline treatment — 30% danger border, danger text on white;
  hover 5% danger tint. Never solid red.
- **Warn:** solid amber (#A24F0A), white text — rare, for pause-everything acts.
- **Ghost:** borderless muted-ink text; hover subtle fill + ink text. For
  tertiary row actions.
- **Focus:** global ring — 2px emerald outline, 2px offset, 4px corner.

### Badges & Tags
- **Status pill (`Badge` / `StatusBadge`):** full pill, 2×8px padding, 12px/500
  text; 10% tone over its own white ground, tone text, 20% tone inset ring;
  status pills lead with a 6px `currentColor` dot. Status mapping: New=info, Alerted=warn,
  Applied=ok, Saved=violet, Dismissed=neutral.
- **Tag:** same tinting at 6px radius for tech-match and rule chips.

### Fit Badge (signature)
A number plus meter so the value reads without color: 14px/500 tabular-nums
toned number beside a 36×6px pill track (hairline gray) with a tone-filled bar
(min 4% width). Tone thresholds: ≥85 ok, ≥70 info, ≥50 warn, below neutral;
null renders an em dash.

### Tables
- **Header:** subtle-surface row, the label step (13px/550) in muted ink,
  10×16px padding, hairline bottom edge; optional sticky mode swaps the border for an inset
  shadow; 20px outer-column padding.
- **Body:** white; rows divided by hairlines, 12×16px cell padding, hover tints
  the selected surface at 50%, 150ms. Nothing a row offers depends on hover.
- **Fixed layout:** wide list tables set proportional column widths and a
  min-width wrapper that scrolls horizontally inside the card.

### Inputs / Fields
- **Style:** white, control-border 1px, 6px radius, 6×12px padding,
  14px text, faint-ink placeholder, whisper shadow.
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

### Cards / Containers
- **`Card`:** 8px corners, white, divider outline, whisper shadow, 20px
  padding (`flush` removes the padding and clips children for tables). Card
  headings use `SectionTitle` (the entity step) with 12px below.
- **`Card variant="flat"`:** no border, shadow, fill or padding — a part of a
  region that is already one surface. **`variant="subtle"`:** the subtle fill,
  8px corners, no outline — a well or an inactive region.
- **Metric strip (`MetricStrip`):** a few numbers read as one line — a `<dl>`
  on ONE raised surface, its cells divided by hairlines, never four boxed
  cards. A cell is a tone dot and a label (the label step), a 28px/600
  tabular-nums value and a delta line at the meta step; with `href` the value
  is a link stretched over its cell, and the cell hovers in the selected
  tint. An optional footer line sits under a hairline. Two columns below
  1280px, one row of four from there.
- **A run as a sentence (`/runs`):** `runs-summary.ts` turns a run's stats into
  facts in a fixed order ("594 fetched · 3 new · 55 duplicates · 3 classified
  · 0 alerted"), the dot between them drawn; a reason reads as a sentence
  ("Discovery is switched off"). The stats JSON and the per-source list fold
  behind **Details** on the same line — raw machine output is never a page's
  primary content — and runs past the latest fifty fold behind a button that
  names any failure among them.

### Navigation
- **Sidebar:** the subtle surface, one step off the canvas, hairline right
  edge; 56px brand row (emerald 28px "AP" mark + 15px/600 wordmark). Overview
  stands alone, then four groups with sentence-case labels at the label step
  in faint ink — *Work* (Jobs, Applications), *Tools* (Resumes, Compare, Cover
  letter), *Research* (Companies, Discovery), *System* (Runs, and Screening
  while employer mode is on). Links are 14px, 6px radius, 6×10px padding, 18px
  icon + label; active = selected surface, emerald-strong text and icon at
  500, a 2px emerald-strong bar on the left; inactive = muted ink, hover 70%
  white. Settings and a privacy footnote pin to the bottom. Tablet collapses
  to a 64px icon rail where a short hairline stands in for each group label;
  mobile is a drawer behind a hamburger bar.
- **Filter segments:** the same idiom inline — 13px bordered pills where active
  gets the control border + the subtle fill, inactive is borderless muted ink.
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
- **Filter options (the Jobs panel):** 6px-radius links on the subtle surface
  with a faint count; a chosen one takes the selected surface, emerald-strong
  500 text and a drawn check — never colour alone.
- **Filter chip (`FilterChip`):** a criterion in force, above the table: 6px
  radius, the selected surface, 30% emerald border, a drawn ✕. The whole chip is
  the link that lifts it (`aria-label="Remove filter: …"`).

### System Feedback
- **Flash:** rounded 6px banner, 25% tone border, 5% tone fill, tone text, with
  a drawn 16px icon; ok, warn and danger kinds. An error says three things:
  what failed, what is safe, the way forward — never "Invalid form values".
- **Empty state (`Empty`):** a 28px 1.5px-stroke drawn icon in control-border
  gray, then three parts, centered — the title (what is missing, entity type),
  one muted sentence (why it matters) and at most one action (a small
  secondary button, or the sentence names the control already on the page).
  A hairline 8px card on the canvas; `bare` inside a card, which stays the one
  surface.
- **Board column:** the subtle surface, 8px corners, no outline; an empty
  column says "No applications" in one faint meta line. No dashed wells — the
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
grid — including the select chevron and check/x marks. Emoji, Unicode glyphs,
and icon fonts never stand in for icons.

**The Composed-Primitive Rule.** Pages compose `ui.tsx` primitives and never
hand-roll Tailwind for shared patterns; new visual decisions land in the
primitive or the token layer first.

**The Disclosure Rule.** Under a label, one sentence. What explains a cap, a
cost, a gate, a privacy fact or a destructive act stays visible; everything
else sits behind a quiet `Disclosure` ("How this works"), outside the label so
it never becomes the control's accessible name. Filters, inactive input modes
and raw machine output fold the same way — native `<details>`, no JavaScript.

**The Measured-Change Rule.** A UI pull request names a number from
`docs/ui-redesign/measure.js` — tab stops before the table, visible hint
words, boxes, primaries, height — and reports it before and after
(`node docs/ui-redesign/shoot.js`). If the number does not move, the change is
not done.

## Do's and Don'ts

### Do:
- **Do** route every color through the semantic tokens (`surface` / `line` /
  `ink` / `accent` / status tones) as `rgb(var(--token) / alpha)`; a future dark
  theme must be a token swap, not a component edit.
- **Do** keep the 4px spacing grid and the observed density: 20px card padding,
  12×16px table cells, 6px control padding, 16px card gaps.
- **Do** set `tabular-nums` on every numeric readout (stats, counts, scores,
  dates in columns) and render absent values as an em dash (—), never blank.
- **Do** give every interactive element the global focus ring (2px emerald,
  2px offset) and a 150ms color-only transition.
- **Do** pair color with a redundant channel — dot + label on status, number +
  meter on fit, a check or a bar on a selection — so state reads without color.
- **Do** put a new value in `src/web/tokens.ts` and let `tokens.test.ts` say
  whether its text passes AA on every surface, the pill and the flash.
- **Do** mark helper prose written outside `Hint` with `data-ui="hint"`, so the
  number a UI change reports counts it.

### Don't:
- **Don't** introduce gradients, glassmorphism, decorative noise, heavy or
  colored shadows, hover-lift, or radii above 8px — the confirmed anti-world.
  The same goes for the stock looks: a Bootstrap or Material admin, a
  component-library demo page, giant colorful KPI cards, pills everywhere.
- **Don't** nest cards in cards, wrap a wrapper in a border, or set a region
  apart by a background alone.
- **Don't** let helper paragraphs pile up under a control, show raw JSON as a
  page's primary content, leave a page with a giant unused area, or hide an
  important action behind an unlabelled icon.
- **Don't** colour an icon arbitrarily, draw a chart that answers no question,
  or vary the focus state between controls.
- **Don't** set anything in uppercase with tracking; a group label is sentence
  case at the label step.
- **Don't** use violet for anything but AI-spend actions and the Saved status,
  and don't promote any status tone into a second brand accent.
- **Don't** fill a status with saturated color; status stays a quiet tinted
  pill (10% background, 20% ring).
- **Don't** set prose, labels, or headings in monospace — mono is machine
  values only.
- **Don't** go dark ad hoc: no dark-styled components or pages until the token
  layer itself grows a dark value set.
