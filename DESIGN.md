---
name: ApplyPack
description: A calm, light operations console for a one-person job hunt — dense tables, quiet status pills, one emerald accent.
colors:
  surface: "#F7F8FA"
  surface-raised: "#FFFFFF"
  surface-overlay: "#F3F4F6"
  line: "#E5E7EB"
  line-strong: "#D0D5DD"
  ink: "#101828"
  ink-muted: "#475467"
  ink-faint: "#667085"
  accent: "#059669"
  accent-strong: "#047857"
  accent-deep: "#065F46"
  ok: "#047857"
  warn: "#B45309"
  danger: "#D92D20"
  info: "#1D4ED8"
  violet: "#6D28D9"
typography:
  page-title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.025em"
  section-title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  secondary:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  micro:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
  stat-value:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "24px"
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
The composition is a Linear-density work surface — a fixed 240px sidebar on
paper-gray ground, white cards and tables carrying the data, hairline borders
doing all the structural work. Nothing on screen persuades or decorates; every
pixel serves reading four numbers, scanning new jobs, and acting on one.

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
- Paper-gray ground (#F7F8FA), white work surfaces, hairline structure
- One brand accent (emerald); status as quiet tinted pills, never fills
- Inter for all UI text; monospace strictly for machine values
- Flat by default; shadow is a whisper on white surfaces only
- Dense 4px-grid spacing; 14px body type; tables and forms carry the work
- Drawn stroke icons (Lucide-style), never emoji or Unicode glyphs

## Colors

A near-neutral gray field with a single emerald voice and a five-tone status
vocabulary; every value is declared once as an RGB triplet on `:root`
(`--surface: 247 248 250`) and consumed as `rgb(var(--token) / alpha)` through
the Tailwind config in `src/web/layout.tsx` — components never hard-code hex.

### Primary
- **Emerald** (#059669): the one brand accent. Focus rings (2px outline, 2px
  offset), text selection (18% tint), the "AP" mark, checked states of pill
  checkboxes and radios (`accent/5` fill, `accent/40–50` border), hover border
  on kanban cards.
- **Emerald Strong** (#047857): links and primary buttons — the AA-on-white
  workhorse shade.
- **Emerald Deep** (#065F46): primary button hover; link hover.

### Status
- **OK Green** (#047857): Applied status, enabled toggles, healthy runs, fit
  scores ≥ 85.
- **Info Blue** (#1D4ED8): New status, fit scores 70–84.
- **Warn Amber** (#B45309): Alerted status, mid fit scores (50–69), the solid
  `warn` button for destructive-ish batch actions.
- **AI Violet** (#6D28D9): the Saved status and AI-spend actions only — see the
  named rule below.
- **Danger Red** (#D92D20): destructive actions and error flashes; always an
  outline-tinted treatment on white, never a solid red button.
- Dismissed / absent / unknown renders neutral: overlay-gray pill with muted ink.

### Neutral
- **Paper Gray** (#F7F8FA): the app ground — page background, sidebar.
- **Surface White** (#FFFFFF): cards, tables, panels, controls — where work happens.
- **Overlay Gray** (#F3F4F6): table headers, hovers, wells, active nav, inline code.
- **Hairline** (#E5E7EB): borders between and around everything; table row dividers.
- **Strong Hairline** (#D0D5DD): control borders, scrollbar thumbs, disabled dots.
- **Ink** (#101828): primary text.
- **Muted Ink** (#475467): secondary text, table headers, stat labels.
- **Faint Ink** (#667085): hints, meta, placeholders, timestamps.

### Named Rules
**The One-Accent Rule.** Emerald is the only brand color. The status tones are
vocabulary, not decoration: they appear exclusively where they carry state
(pills, dots, meters, toned numbers) and never as ambient color.

**The Quiet-Pill Rule.** Status renders as a tinted pill — 10% tone background,
full-strength tone text, 20% tone inset ring — never as a saturated fill. A
status color at 100% opacity may only paint dots, meter fills, and text.

**The Violet-Means-AI Rule.** Violet (#6D28D9) is reserved for AI/model-spend
actions — Compare, Re-analyze with AI, Re-scan, Re-classify, HN Run now — and
for the Saved status. It signals "this button costs AI credit or marks a save."
It must never become a general secondary accent.

## Typography

**UI Font:** Inter (400 / 500 / 600, via Google Fonts) with `ui-sans-serif,
system-ui, -apple-system, "Segoe UI", sans-serif` fallback
**Machine Font:** system mono stack (`ui-monospace, SFMono-Regular, "SF Mono",
Menlo, Consolas, monospace`)

**Character:** One quiet family doing everything, differentiated by weight and
size rather than by face. Titles tighten (-0.025em); numbers align
(`tabular-nums`); nothing is ever uppercase-tracked or display-sized.

### Hierarchy
- **Page Title** (600, 20px/28px, tracking -0.025em): one per page, in the
  header row next to meta and actions; truncates rather than wraps.
- **Stat Value** (600, 24px/32px, tabular-nums): the largest type in the app —
  the four Overview numbers and stat cards.
- **Section Title** (600, 14px/20px): card headings (`SectionTitle`) and the
  left column of settings sections.
- **Body** (400, 14px/20px): default for everything — table cells, forms,
  buttons, nav. Medium (500) marks emphasis: row titles, button labels, labels.
- **Secondary** (400, 13px/20px): hints, meta counts, back-links, field labels
  (labels at 500); the descriptive voice under every control.
- **Micro** (500, 12px/16px): table headers, badges, kanban counts; drops to 400
  for sub-values and timestamps.
- **Mono Value** (400, 12px, mono stack): ids, tokens, cron expressions,
  durations, code — machine values only, usually one size below their context.

### Named Rules
**The Machine-Mono Rule.** Monospace is strictly for machine values — ids,
tokens, cron names, durations, code. Prose, labels, titles, and numbers-in-prose
stay in Inter; numeric columns align with `tabular-nums`, not with mono.

## Layout

A fixed app frame, not a scrolling document: `flex h-dvh overflow-hidden` with a
240px sidebar (`lg:w-60`) on paper-gray ground at desktop, a 64px icon rail at
tablet (`md:w-16`), and an off-canvas drawer on mobile (16rem wide, 200ms slide,
dimmed backdrop). Content owns the scroll: the main region scrolls vertically,
and pages that manage their own inner scrolling (the Jobs table, the
Applications board) opt into `fill` mode to pin their scroller to the viewport.

Content gutters are 16px, stepping to 24px ≥640px and 32px ≥1024px, with 20px
vertical padding. The page header sits 24px above the content. Cards stack and
grid at 16px gaps. Detail pages split into a fluid main column and a 340px
facts-and-actions rail at ≥1280px (rail first in DOM so actions lead on small
screens). Settings caps at `max-w-5xl` and uses Stripe-style rows: a 220px
title-and-description column beside the controls, each section separated by a
hairline and 28px of padding. The Applications board scrolls horizontally
through 288px fixed-width stage columns.

All spacing sits on the 4px grid; the working steps are 4 / 8 / 12 / 16 / 20 /
24 / 32px. Density is the point — 12px cell padding in tables, 20px card
padding, 6px vertical padding in controls — compact but never cramped.

## Elevation & Depth

Flat by default. Hairline borders (#E5E7EB, #D0D5DD on controls) carry all
structure; depth is layered with the three surface values (paper ground → white
raised → gray overlay), not with shadow. `shadow-sm` (`0 1px 2px 0
rgb(0 0 0 / 0.05)`) is a whisper applied only to white surfaces — cards, stat
tiles, controls, primary/secondary buttons — and reads as material thickness,
not lift. Sticky table headers replace their border with an inset hairline
shadow so the line survives scrolling.

### Shadow Vocabulary
- **Whisper** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): white surfaces
  only — cards, controls, filled buttons.
- **Drawer** (`box-shadow: 0 8px 30px rgb(16 24 40 / 0.12)`): the mobile nav
  drawer, the app's single true elevation, paired with a
  `rgb(16 24 40 / 0.4)` backdrop.
- **Header hairline** (`box-shadow: inset 0 -1px 0 rgb(var(--line))`): the
  bottom edge of sticky table headers.

### Named Rules
**The Whisper-Shadow Rule.** Surfaces are flat at rest; hairlines do the
structural work. `shadow-sm` appears only on white surfaces, and nothing except
the mobile drawer ever casts a real shadow. No glows, no heavy ambient shadows,
no hover-lift.

## Shapes

A three-step radius ladder: 8px (`rounded-lg`) for cards, tables, panels, and
empty states; 6px (`rounded-md`) for every control — buttons, inputs, selects,
nav links, tags, filter segments; 4px for the smallest chrome (inline code,
focus-ring corners, scrollbar thumbs). Badges and meters are full pills. Nothing
exceeds 8px; large radii are an explicit anti-reference.

Borders are 1px everywhere — hairline (#E5E7EB) on surfaces, strong hairline
(#D0D5DD) on interactive controls, tone-tinted (30–50% alpha) on stateful
elements; badges use a 1px inset ring at 20% tone. Dashed hairline rectangles
mark empty wells (the "No applications" slot in a board column). Icons are drawn
on the Lucide 24px grid at 2px stroke, round caps and joins, rendered
14–18px — geometry consistent from nav icons down to the drawn select chevron
and the check/x verdict marks.

## Components

Every page composes the primitives in `src/web/ui.tsx`; color and spacing
decisions live there and in the token layer, not in page files.

### Buttons
- **Shape:** 6px radius, 500 weight, min-height 32px, 150ms color transition;
  sizes sm (4×10px, 12px text), md (6×12px, 14px text), lg (8×16px). Disabled
  is 40% opacity.
- **Primary:** solid Emerald Strong (#047857), white text, whisper shadow;
  hover deepens to #065F46. One per view region — the main affirmative act.
- **Secondary:** white with strong-hairline border, ink text; hover fills
  overlay gray. The default for everything non-primary.
- **Violet (AI):** violet text on 5% violet tint with 30% violet border; hover
  10% tint. Only for actions covered by the Violet-Means-AI Rule.
- **Danger:** outline treatment — 30% danger border, danger text on white;
  hover 5% danger tint. Never solid red.
- **Warn:** solid amber (#B45309), white text — rare, for pause-everything acts.
- **Ghost:** borderless muted-ink text; hover overlay fill + ink text. For
  tertiary row actions.
- **Focus:** global ring — 2px emerald outline, 2px offset, 4px corner.

### Badges & Tags
- **Status pill (`Badge` / `StatusBadge`):** full pill, 2×8px padding, 12px/500
  text; 10% tone background, tone text, 20% tone inset ring; status pills lead
  with a 6px `currentColor` dot. Status mapping: New=info, Alerted=warn,
  Applied=ok, Saved=violet, Dismissed=neutral.
- **Tag:** same tinting at 6px radius for tech-match and rule chips.

### Fit Badge (signature)
A number plus meter so the value reads without color: 14px/500 tabular-nums
toned number beside a 36×6px pill track (hairline gray) with a tone-filled bar
(min 4% width). Tone thresholds: ≥85 ok, ≥70 info, ≥50 warn, below neutral;
null renders an em dash.

### Tables
- **Header:** overlay-gray row, 12px/500 muted-ink text, 10×16px padding,
  hairline bottom edge; optional sticky mode swaps the border for an inset
  shadow; 20px outer-column padding.
- **Body:** white; rows divided by hairlines, 12×16px cell padding, hover tints
  overlay gray at 50%, 150ms.
- **Fixed layout:** wide list tables set proportional column widths and a
  min-width wrapper that scrolls horizontally inside the card.

### Inputs / Fields
- **Style:** white, strong-hairline 1px border, 6px radius, 6×12px padding,
  14px text, faint-ink placeholder, whisper shadow.
- **Hover / Focus:** border darkens to faint ink on hover; focus turns the
  border emerald and adds a 2px ring at 15% emerald — calm, no glow.
- **Select:** identical, with a drawn 14px chevron (data-URI SVG, faint-ink
  stroke) replacing browser chrome.
- **Field:** 13px/500 ink label, optional faint hint, 6px gap to control.
- **Choice controls:** native checkboxes/radios tinted via `accent-color`;
  PillCheckbox and Radio wrap them in bordered white containers whose checked
  state tints emerald (5% fill, 40–50% border).

### Cards / Containers
- **Corner style:** 8px; **background:** white; **border:** hairline;
  **shadow:** whisper; **padding:** 20px (flush variant removes padding and
  clips children for tables). Card headings use Section Title with 12px below.
- **Stat card:** 16px padding, 13px/500 muted label over a 24px/600
  tabular-nums value, optional 12px faint sub-line; muted variant drops the
  shadow and fades its border.

### Navigation
- **Sidebar:** paper-gray, hairline right edge; 56px brand row (emerald 28px
  "AP" mark + 15px/600 wordmark); links are 14px, 6px radius, 6×10px padding,
  18px icon + label; active = overlay fill, 500 weight, ink; inactive =
  muted ink, hover 70% overlay. Settings and a privacy footnote pin to the
  bottom. Tablet collapses to a 64px icon rail (icons only), mobile to a
  drawer behind a hamburger bar.
- **Filter segments:** the same idiom inline — 13px bordered pills where active
  gets strong-hairline border + overlay fill, inactive is borderless muted ink.

### System Feedback
- **Flash:** rounded 6px banner, 25% tone border, 5% tone fill, tone text, with
  a drawn 16px icon; ok and danger kinds only.
- **Empty state:** centered in a hairline 8px card, a 28px 1.5px-stroke drawn
  icon in strong-hairline gray over 14px faint text with an inline link.
- **ToggleRow:** label + ok/neutral dot-pill beside an Enable/Disable button —
  the settings on/off idiom.

### Named Rules
**The Drawn-Icon Rule.** Every icon is a drawn SVG stroke on the 24px Lucide
grid — including the select chevron and check/x marks. Emoji, Unicode glyphs,
and icon fonts never stand in for icons.

**The Composed-Primitive Rule.** Pages compose `ui.tsx` primitives and never
hand-roll Tailwind for shared patterns; new visual decisions land in the
primitive or the token layer first.

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
  meter on fit — so state reads without color.

### Don't:
- **Don't** introduce gradients, glassmorphism, decorative noise, heavy or
  colored shadows, hover-lift, or radii above 8px — the confirmed anti-world.
- **Don't** use violet for anything but AI-spend actions and the Saved status,
  and don't promote any status tone into a second brand accent.
- **Don't** fill a status with saturated color; status stays a quiet tinted
  pill (10% background, 20% ring).
- **Don't** set prose, labels, or headings in monospace — mono is machine
  values only.
- **Don't** go dark ad hoc: no dark-styled components or pages until the token
  layer itself grows a dark value set.
