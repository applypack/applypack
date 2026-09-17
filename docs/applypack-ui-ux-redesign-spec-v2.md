# ApplyPack UI/UX Redesign Specification

> **Project:** ApplyPack  
> **Document type:** Product UI design specification  
> **Primary goal:** Redesign the entire application into a modern, highly readable, data-heavy professional workspace while preserving ApplyPack's emerald/green identity.  
> **Intended use:** Design reference for Claude Code, frontend implementation, future feature development, charts, analytics, forms, tables, dashboards, and new product surfaces.
> **Revision:** Expanded with component/MCP strategy, backend-first rendering architecture, DTO/pagination/virtualization guidance, chart performance rules, dependency policy, and safe Claude Code migration workflow.

---

## 1. Executive Summary

ApplyPack already has a coherent product structure and a large amount of useful functionality. The main problem is not the information architecture. The problem is visual hierarchy.

At the moment, almost every part of the interface has similar visual weight:

- application background;
- sidebar;
- cards;
- tables;
- inputs;
- filters;
- secondary text;
- status elements;
- empty states;
- forms.

As a result, the interface feels flat and unfinished even when the functionality is already strong.

The redesign should **not** turn ApplyPack into another generic SaaS dashboard. The target should be a professional **data workspace**: calm, compact, readable, precise, and capable of handling much more information in the future.

The visual direction can be summarized as:

> **Clean editorial workspace, warm off-white surfaces, deep graphite typography, emerald interaction layer, dense information where data matters, generous whitespace where decisions matter.**

A useful internal name for the design language is:

# **ApplyPack — Emerald Workbench**

The UI should feel closer to a polished productivity or developer tool than to a marketing-heavy SaaS dashboard.

The most important reference qualities are:

- **Attio:** data density and database-oriented UI;
- **Linear:** interaction quality, restraint, keyboard-first feel;
- **Stripe:** information hierarchy and clarity;
- **modern developer tools:** compactness, technical precision, quiet surfaces.

These are references for principles, not templates to copy.

---

# 2. Core Design Goals

The new design must satisfy the following goals.

## 2.1 Readability first

Every screen should answer three questions within a few seconds:

1. Where am I?
2. What is important here?
3. What can I do next?

The UI should make scanning easier than reading.

Long descriptions should never compete visually with primary controls or data.

---

## 2.2 Designed for data growth

ApplyPack will contain more analytics, statistics, historical data, charts, AI results, comparisons, screening details, and pipeline information over time.

The design therefore must scale to:

- tables with many columns;
- time-series charts;
- categorical charts;
- score distributions;
- trend cards;
- dashboards;
- activity feeds;
- logs;
- comparison views;
- multi-step workflows;
- side panels;
- rich entity pages;
- filters;
- saved views;
- drill-down analytics.

The system must not depend on every feature being placed in a separate white card.

---

## 2.3 Dense where useful, spacious where useful

ApplyPack should not be uniformly spacious.

Use:

- **compact density for tables, lists, filters, logs and metadata**;
- **larger spacing for page sections and decision-making areas**;
- **large empty space only when it improves comprehension**.

Principle:

> **Spacious page structure, dense data presentation.**

---

## 2.4 Green remains the brand

The existing emerald/green direction should remain.

Do not redesign ApplyPack around:

- blue;
- purple;
- red;
- neon gradients;
- rainbow accents.

Green should become more intentional and systematic rather than simply being used on occasional buttons.

---

## 2.5 Future features must look native

A new feature added six months from now should be implementable with existing primitives.

The design system should already define:

- chart appearance;
- table behavior;
- cards;
- badges;
- filters;
- forms;
- navigation;
- toolbars;
- drawers;
- empty states;
- loading states;
- error states;
- confirmation dialogs;
- page layouts;
- metric components.

---

# 3. What Is Wrong With the Current UI

## 3.1 Everything is visually similar

Most surfaces use nearly the same:

- white/light-gray background;
- subtle gray border;
- similar radius;
- similar typography;
- similar spacing.

There is no strong distinction between:

- page;
- section;
- interactive control;
- data container;
- highlighted result;
- secondary information.

This creates visual flatness.

---

## 3.2 Borders are doing too much work

Currently, borders are the primary separation mechanism.

Examples:

- card = border;
- table = border;
- input = border;
- form group = border;
- filter = border;
- Kanban column = border.

This produces a large number of rectangles.

The redesign should use a combination of:

- surface colors;
- whitespace;
- typography;
- alignment;
- subtle dividers;
- borders only where needed.

---

## 3.3 Typography hierarchy is too weak

Page titles, data labels, explanatory text, metadata, form labels and entity titles are too visually similar.

The redesign needs a strict text hierarchy.

---

## 3.4 Too much instructional text is permanently visible

Several screens contain paragraphs explaining how controls work.

This is helpful during onboarding but expensive in a daily-use application.

Move secondary explanations into:

- concise helper text;
- tooltips;
- info popovers;
- expandable “How this works” sections;
- onboarding states.

Keep only information that is required to make the current decision.

---

## 3.5 Many controls compete for attention

Filters, chips, tabs and buttons often have similar visual prominence.

The user should immediately understand:

- primary action;
- secondary action;
- filter state;
- navigation state;
- destructive action.

---

## 3.6 The interface does not yet have a recognizable visual signature

ApplyPack should develop several elements that feel distinctly ApplyPack.

Recommended candidates:

- emerald selection/focus language;
- Fit Score visualization;
- job status badge system;
- compact analytical widgets;
- job/resume entity cards;
- pipeline visualization;
- consistent “insight” treatment for AI-derived information.

---

# 4. Design Personality

ApplyPack should feel:

- professional;
- analytical;
- calm;
- precise;
- intelligent;
- trustworthy;
- modern;
- technically competent;
- useful rather than decorative.

It should **not** feel:

- playful;
- childish;
- overly corporate;
- excessively minimal;
- glossy;
- “AI startup purple”;
- crypto-like;
- template-driven;
- Dribbble-first;
- marketing-page-heavy.

---

# 5. Color System

Green remains the core brand color, but the design needs a complete neutral and semantic palette around it.

Suggested starting tokens:

```css
:root {
  --bg-app: #F6F8F7;
  --bg-sidebar: #F3F6F4;

  --surface-primary: #FFFFFF;
  --surface-secondary: #F1F4F2;
  --surface-tertiary: #EAF0ED;
  --surface-hover: #EDF5F1;
  --surface-selected: #E6F4ED;

  --text-primary: #17211D;
  --text-secondary: #637069;
  --text-tertiary: #8C9791;
  --text-disabled: #ADB5B1;

  --border-subtle: #E4E9E6;
  --border-default: #D9E0DC;
  --border-strong: #C7D1CC;

  --accent: #07875F;
  --accent-hover: #066F50;
  --accent-active: #055F45;
  --accent-soft: #E5F5EE;
  --accent-medium: #BFE6D6;
  --accent-border: #99D5BC;

  --success: #087A58;
  --success-soft: #E6F5EF;

  --warning: #B26014;
  --warning-soft: #FFF3E5;

  --danger: #B83B3B;
  --danger-soft: #FDECEC;

  --info: #3F67A8;
  --info-soft: #EDF3FC;

  --violet: #7757C7;
  --violet-soft: #F1ECFF;
}
```

These values are a starting point, not an immutable palette.

## Color rules

Use green for:

- primary actions;
- selected navigation;
- successful/healthy state;
- strong fit score;
- focus rings;
- active controls;
- positive progress.

Do **not** use green as decoration on every card.

Use semantic colors only when they communicate meaning.

Suggested status language:

- **Alerted:** muted amber;
- **Applied:** emerald;
- **Saved:** muted violet;
- **Dismissed:** neutral gray;
- **Error:** red;
- **Running:** green/teal;
- **Paused:** gray;
- **Warning:** amber.

Avoid rainbow dashboards.

---

# 6. Surface Hierarchy

The redesign should use multiple surface levels.

## Level 0 — Application background

```text
#F6F8F7
```

Used for the main app canvas.

## Level 1 — Primary surface

```text
#FFFFFF
```

Used for:

- main content sections;
- tables;
- primary forms;
- important panels.

## Level 2 — Secondary surface

```text
#F1F4F2
```

Used for:

- toolbars;
- filter areas;
- sub-sections;
- chart plot backgrounds when useful;
- inactive regions;
- secondary cards.

## Level 3 — Interaction surface

```text
#E6F4ED
```

Used for:

- selected rows;
- hover states;
- active navigation;
- highlighted options;
- contextual emphasis.

This hierarchy should replace excessive border usage.

---

# 7. Typography

Recommended default UI font:

**Geist Sans**

Recommended technical font:

**Geist Mono**

Use monospace selectively for:

- job/run names when technically appropriate;
- raw JSON;
- identifiers;
- timestamps where tabular alignment helps;
- logs;
- source output;
- technical metrics.

Do not use monospace for ordinary UI copy.

## Suggested hierarchy

### Page title

```text
26px
font-weight: 650
line-height: 1.2
```

### Major section title

```text
18px
font-weight: 620
```

### Entity title

```text
14–15px
font-weight: 580–620
```

### Standard body

```text
14px
font-weight: 430–450
```

### Metadata

```text
12–13px
font-weight: 430
color: secondary
```

### Label

```text
12–13px
font-weight: 560
```

### Micro label / eyebrow

```text
10–11px
font-weight: 600
letter-spacing: 0.03em
```

Avoid excessive uppercase text.

---

# 8. Spacing System

Use a consistent spacing scale.

Recommended base:

```text
4
8
12
16
20
24
32
40
48
64
```

Rules:

- 4px: tiny internal alignment;
- 8px: icon-text gaps, compact controls;
- 12px: dense component gaps;
- 16px: default component padding;
- 24px: section grouping;
- 32px: separation between major blocks;
- 40–48px: page-level rhythm.

Do not invent arbitrary spacing per component.

---

# 9. Border Radius

Avoid turning every component into a pill.

Recommended:

```text
Inputs:        7–8px
Buttons:       7–8px
Small cards:   9–10px
Large panels:  10–12px
Modals:        12px
Badges:        999px
```

Pill shapes should mainly be used for:

- badges;
- compact filters;
- tags;
- statuses.

---

# 10. Shadows

ApplyPack should rely primarily on:

- hierarchy;
- surface color;
- border;
- spacing.

Use subtle shadows only when elevation has meaning.

Default:

```css
box-shadow:
  0 1px 2px rgba(16, 24, 20, 0.04),
  0 1px 3px rgba(16, 24, 20, 0.03);
```

Use a slightly stronger shadow for:

- floating popovers;
- dropdowns;
- dialogs;
- draggable Kanban cards;
- floating action panels.

Do not place strong shadows on every panel.

---

# 11. Global Application Shell

## Sidebar

The sidebar should become quieter, more structured and more product-like.

Suggested organization:

```text
AP  ApplyPack

Overview

WORK
Jobs
Applications

TOOLS
Resumes
Compare
Cover letter

RESEARCH
Companies
Discovery

SYSTEM
Runs
Screening

Settings
```

Exact group labels can be removed if they add noise.

### Sidebar behavior

- width around 220–240px on desktop;
- compact version should be possible later;
- icon size 16–18px;
- label size 13–14px;
- counters may appear on Jobs or Applications;
- active state uses emerald tint;
- active state should not look like a large gray pill;
- use subtle left indicator or stronger icon/text treatment;
- sidebar background should differ slightly from main content.

Example active state:

```text
▌ Jobs          92
```

with light emerald background.

---

# 12. Page Header Pattern

All primary screens should follow a common header structure.

```text
Page title                         Primary action
Short context / count              Secondary actions
```

Example:

```text
Jobs                                      + Add job
92 opportunities in your workspace        •••
```

For more complex screens:

```text
Jobs

Search / filters toolbar

Tabs / saved views
```

Do not place unrelated controls randomly across the top-right corner.

---

# 13. Buttons

Define four button classes.

## Primary

Emerald fill.

Used for one main action per context.

Examples:

- Upload & scan;
- Compare;
- Save changes;
- Add job.

## Secondary

White/neutral surface with subtle border.

Examples:

- Fetch now;
- Export;
- Edit columns.

## Ghost

No permanent container.

Examples:

- Pause;
- View all;
- Cancel;
- contextual actions.

## Destructive

Red only when an action is actually destructive.

Examples:

- Delete resume;
- Remove application;
- Reset data.

### Button rules

- avoid gradient buttons;
- avoid multiple primary buttons beside each other;
- icons are optional, not mandatory;
- button heights should be standardized;
- loading buttons should preserve width;
- disabled buttons must remain readable.

---

# 14. Inputs and Forms

Forms are a major part of ApplyPack and require a strict system.

## Field structure

Recommended:

```text
Required technologies
Technologies that must appear in the role.

[ PHP × ] [ Laravel × ] [ Go × ] [ Add skill… ]
```

Avoid:

```text
Label
Long paragraph explaining internal system behavior...
[input]
Another paragraph...
```

## Helper text

Helper text should be:

- short;
- secondary;
- directly relevant to the decision.

Long explanations move to:

```text
ⓘ How matching uses this
```

as a popover or expandable disclosure.

## Field groups

Do not wrap every field group in its own bordered card.

Use:

- section title;
- short description;
- logical grouping;
- whitespace.

## Focus

All inputs should use a consistent emerald focus ring.

Example:

```css
outline: 3px solid rgba(7, 135, 95, 0.14);
border-color: var(--accent);
```

---

# 15. Selects, Comboboxes and Search

For data-heavy workflows, prefer searchable comboboxes over native long selects.

Examples:

- job selection;
- resume selection;
- company selection;
- skills;
- countries;
- sources.

Large option lists should support:

- search;
- keyboard navigation;
- recent items;
- selected state;
- clear action.

---

# 16. Filter System

The existing Jobs screen exposes too many chips simultaneously.

Replace large walls of filters with a layered system.

Recommended structure:

```text
[ Search jobs... ] [ Filters 3 ] [ Sort: Newest ]
```

Below:

```text
Location: United States ×
Work: Remote ×
Posted: Last 7 days ×
Clear all
```

Clicking `Filters` opens a popover or side panel with:

- location;
- work mode;
- age;
- source;
- fit threshold;
- salary;
- technology;
- company;
- status.

This is easier to scale when more filters are added.

---

# 17. Tabs

Tabs should be used for mutually exclusive views, not as decorative buttons.

Example:

```text
All     New     Alerted 22     Applied 1     Saved 3
```

Current tab:

- stronger text;
- subtle underline or compact selected background;
- no unnecessary large pill.

Tabs must remain visually distinct from filter chips.

---

# 18. Tag and Chip System

There should be three clearly different components.

## Status badge

Represents system state.

```text
● Alerted
● Applied
● Saved
```

## Tag

Represents metadata.

```text
PHP
Laravel
Remote
```

## Filter chip

Represents an active query.

```text
Remote ×
United States ×
```

Do not style all three identically.

---

# 19. Tables

Tables are a first-class ApplyPack component.

A large part of the product is database-like. Tables should therefore receive as much design attention as cards.

## Default characteristics

- compact but readable row height;
- sticky header;
- clear column hierarchy;
- subtle row dividers;
- hover state;
- optional selected state;
- right-aligned numeric columns;
- predictable action location;
- truncated content with tooltip where appropriate.

## Future capabilities to design for

- sorting;
- column resize;
- column visibility;
- saved views;
- bulk selection;
- inline actions;
- keyboard navigation;
- sticky columns;
- pagination;
- server-side filtering;
- compact/comfortable density;
- row expansion.

## Row hover

On hover:

- subtle emerald-tinted surface;
- contextual row actions appear;
- avoid large permanent action button columns.

---

# 20. Fit Score — Signature Component

Fit score is one of the most important product concepts and should become a recognizable ApplyPack element.

Current score + small bar is a good foundation.

Create a standardized `FitScore` component.

Example:

```text
85
━━━━━━
Strong match
```

For compact tables:

```text
85  ━━━━━
```

For summary cards:

```text
85
Strong match
```

Suggested ranges:

```text
90–100   Excellent / emerald
75–89    Strong / green
60–74    Moderate / muted blue-green
<60      Weak / neutral
```

Avoid:

- rainbow gauges;
- speedometer charts;
- giant circular meters;
- excessive red for low scores.

Low score should often simply be neutral rather than alarming.

---

# 21. Cards

Cards should be used only where content behaves as a distinct object.

Good card use:

- resume entity;
- Kanban application;
- saved report;
- important analytical insight;
- small system widget.

Poor card use:

- every section;
- every statistic;
- every filter;
- every form subsection.

Card hierarchy:

### Flat section

No shadow, perhaps no border.

### Standard card

Subtle border + minimal shadow.

### Interactive card

Hover state, stronger focus.

### Elevated card

Only for overlays or draggable items.

---

# 22. Charts and Analytics System

Future analytics are a major consideration.

Charts should look native to ApplyPack rather than imported from a generic dashboard library.

## General rules

Use charts only when visualization improves comprehension.

Do not add charts merely to make a page look more sophisticated.

Each chart must answer a question.

Examples:

- Are fit scores improving over time?
- Which sources produce the strongest jobs?
- Where are jobs being filtered out?
- How many jobs move from alert to application?
- Which skills appear most often in high-fit roles?
- How does salary vary by fit or role?
- How does resume version performance compare?

---

## 22.1 Chart card anatomy

Recommended:

```text
Fit score trend                           Last 30 days ▾
Average score across newly discovered jobs

       chart area

68 avg                     +7 vs previous period
```

Use:

- concise title;
- one-line explanation;
- optional timeframe control;
- chart;
- one or two summary values.

Do not surround the chart with excessive labels.

---

## 22.2 Line charts

Use for:

- time series;
- score changes;
- jobs discovered over time;
- applications over time;
- pipeline throughput;
- processing duration.

Visual rules:

- one dominant emerald series by default;
- secondary series use neutral tones;
- subtle grid;
- no heavy axis borders;
- tooltips show exact values;
- dots only when useful;
- avoid smooth curves when they imply data that does not exist.

---

## 22.3 Bar charts

Use for:

- source comparison;
- technology frequency;
- company counts;
- stage counts;
- salary bands.

Horizontal bars are often preferable when labels are long.

---

## 22.4 Stacked bars

Use only when part-to-whole meaning is important.

Example:

```text
jobs by source:
saved / alerted / dismissed
```

Do not create stacked charts with many tiny categories.

---

## 22.5 Pie and donut charts

Use sparingly.

Suitable:

- one simple part-to-whole composition with few categories.

Avoid:

- many slices;
- analytical comparisons;
- time series.

In most cases a horizontal bar chart is more readable.

---

## 22.6 KPI metrics

Avoid four giant cards for four numbers.

Prefer metric strips or compact analytical headers.

Example:

```text
Jobs found       Avg fit       Alerted       Applied
1,284            76            132           28
+12%             +4            +9%           +3
```

This can live inside one surface.

---

## 22.7 Chart colors

Primary series:

- emerald.

Secondary comparison:

- graphite;
- desaturated teal;
- soft blue-gray.

Semantic colors only when meaning requires them.

Charts should not become multi-color rainbows.

---

## 22.8 Tooltips

Chart tooltips must:

- use the same typography as the product;
- have white surface;
- subtle shadow;
- exact value;
- clear date/category;
- no visual clutter.

---

## 22.9 Empty chart state

Never show an empty grid.

Show:

```text
Not enough data yet

Charts will appear after ApplyPack has collected
at least several days of job history.
```

with an optional explanation of what will be shown.

---

# 23. Overview Page Redesign

The current Overview page should become a concise operational dashboard.

Suggested hierarchy:

```text
Overview

Pipeline status / refresh controls

Metric strip

Recent matches                     Pipeline health

Optional analytics below
```

## Metric strip

Instead of four isolated cards:

```text
New           Alerted         Applied         Saved
0             22              1               3
—             +6 today        —               +2 today
```

One surface, typography-first.

## Recent matches

Treat as a high-quality data feed.

Each row:

- job title;
- company/source;
- location;
- age;
- FitScore;
- status;
- optional quick actions on hover.

## Pipeline health

Make it a compact operational widget.

```text
Pipeline health                 ● Healthy

Fetch       25.3s               ✓
Digest      314ms               ✓
Cleanup     Never run           —
```

Future charts may be added below:

- jobs discovered by day;
- average fit;
- source contribution.

---

# 24. Jobs Page Redesign

The Jobs page should be the primary prototype for the entire design system.

It contains almost every essential UI pattern:

- navigation;
- page header;
- search;
- filters;
- tabs;
- table;
- scores;
- status;
- pagination;
- hover actions.

Suggested structure:

```text
Jobs                                          + Paste a job
92 opportunities

[ Search jobs... ] [ Filters 3 ] [ Sort: Recently fetched ]

All   New   Alerted 22   Applied 1   Saved 3   Dismissed

United States ×   Remote ×   Last 7 days ×        Clear all

JOB                         COMPANY       LOCATION       FIT     STATUS     FETCHED
...
```

## Job title cell

Primary line:

- title.

Secondary line:

- technology tags or short metadata.

Avoid excessively long single-line titles without useful context.

## Row actions

Appear on hover:

```text
Open
Save
⋯
```

## Pagination

Use clear pagination and result count.

Allow future:

- rows per page;
- keyboard navigation;
- saved filters.

---

# 25. Job Detail Page — Future-Proof Pattern

When jobs gain more data, avoid opening everything in modals.

Use either:

- full detail page;
- right-side inspector for quick review.

Recommended detail structure:

```text
← Jobs

Senior Backend Engineer
Company · Remote · United States

Fit 92       Alerted       Saved

Overview    Match analysis    Company    Activity

Main content                         Context sidebar
```

The detail page can host:

- job description;
- score explanation;
- matched skills;
- missing skills;
- salary;
- source;
- application status;
- notes;
- AI analysis;
- timeline.

---

# 26. Applications / Kanban Redesign

The current board is visually too empty.

Use background tone and spacing rather than large outlined boxes.

Suggested:

```text
Applications                                   1 active

Applied 1        Screen 0        Technical 0        On-site 0        Offer 0
─────────        ────────        ───────────        ─────────        ───────
```

Columns:

- light surface variation;
- minimal structural border;
- compact header;
- count.

Cards:

- job title;
- company;
- fit;
- age;
- optional next action.

Draggable cards may have slightly stronger elevation.

Empty columns should use minimal empty-state treatment rather than large dashed rectangles.

---

# 27. Resumes Page Redesign

The uploaded resume should be treated as an entity, not just a table row.

Suggested:

```text
Resumes                                      + Upload resume

Primary resume

Senior Software Engineer
PDF · v1 · Default · Scanned 7 days ago

PHP   Laravel   TypeScript   +70 skills

30 matches                               Open resume →
```

## Upload

After the user already has resumes, upload should not occupy a large permanent form.

Use:

- button;
- modal;
- drawer;
- dedicated upload step.

## Resume details

A resume detail page should support future:

- strengths;
- issues;
- skill inventory;
- scan history;
- version comparison;
- job matches;
- editing.

---

# 28. Confirmed Facts Redesign

Confirmed Facts is an important product capability and should not look like a generic input row.

Treat it as persistent user knowledge.

Example:

```text
Confirmed knowledge

Kubernetes
✓ I have this skill
Ran the cluster at Vodwork, 2023–2025

AWS Bedrock
✓ I have this skill
Add context
```

Actions:

- edit;
- remove;
- add context;
- source/history later.

This section should visually communicate that facts improve future matching.

---

# 29. Compare Page Redesign

The page should feel like a structured comparison workspace.

Recommended split:

```text
Compare

JOB                                      RESUME
────────────────────                     ────────────────────

● Existing job                           ● Existing resume
○ Paste new job                          ○ Upload file
                                         ○ Paste text

Selected job card                        Selected resume card

                     [ Compare → ]
```

Inactive options should remain collapsed.

Only expand:

- paste textarea;
- upload controls;
- additional fields;

after the user selects that mode.

This dramatically reduces visual complexity.

---

# 30. Comparison Result Page

Future result UI should have a strong hierarchy.

Suggested:

```text
Fit score: 84

Strong alignment
Short explanation

Strengths                  Gaps
✓ Laravel                  ! Kubernetes
✓ PostgreSQL               ! Event-driven systems
✓ AWS

Experience alignment
...
```

Charts can later show:

- skill coverage;
- keyword groups;
- requirement coverage;
- fit components.

Do not make the result one enormous text report.

---

# 31. Cover Letter Page

Use a workflow layout instead of one large form.

Potential structure:

```text
1. Job
2. Resume
3. Tone / options
4. Generate
5. Review
```

Generated content should appear in a document-like editor surface.

Actions:

- copy;
- regenerate section;
- shorten;
- personalize;
- export.

Avoid surrounding the editor with excessive controls.

---

# 32. Companies Page

Treat companies as data entities.

Potential table:

```text
Company          Jobs        Avg fit       Saved       Last seen
```

Company detail page:

```text
Company name

Overview    Jobs    Activity

Summary metrics
Relevant jobs
Historical fit
Notes
```

Future analytics could include:

- fit trend;
- job frequency;
- technology frequency.

---

# 33. Discovery Page

Discovery should visually emphasize exploration.

Use:

- saved searches;
- suggested sources;
- job clusters;
- discovery stats;
- recommendations.

Avoid turning the page into a wall of cards.

Prefer sections and data groups.

---

# 34. Runs Page Redesign

Raw JSON should not be the main presentation.

Current run table should become a human-readable operational log.

Example:

```text
FETCH        Sep 16, 07:54        25.3s        ✓ Success

593 fetched
55 duplicate
3 persisted
3 classified
9 sources

                                      Details →
```

Expanded/detail view:

```text
Run details

Started        Sep 16, 07:54
Duration       25.3 s
Fetched        593
Persisted      3
Duplicates     55
Sources        9

Slowest sources
...

Raw output
{ ... }
```

Use monospace only for technical/raw sections.

---

# 35. Screening Page

Screening likely contains rule-heavy or AI-heavy information.

Design should distinguish:

- rule;
- result;
- reason;
- severity;
- user override.

Recommended pattern:

```text
Screening rule
Short description

Result: Passed
Reason: ...

Advanced details ▾
```

Avoid displaying all internal reasoning by default.

---

# 36. Settings Redesign

Replace top tabs with vertical settings navigation.

Suggested:

```text
Settings

General
Profile
AI engine
Notifications
Sources
Screening
```

Right side contains the selected section.

Benefits:

- easier to scale;
- easier to scan;
- supports deeper settings;
- more consistent with professional tools.

## Settings content

Use section separators rather than large nested cards.

Example:

```text
Profile

Search identity
Name
Resume

Required technologies
...

Role preferences
...

Seniority
...
```

---

# 37. Modals, Drawers and Dedicated Pages

Use each intentionally.

## Modal

Use for:

- short confirmation;
- small create/edit task;
- destructive confirmation.

## Right drawer / inspector

Use for:

- quick record preview;
- lightweight editing;
- filters;
- row details.

## Full page

Use for:

- complex entity;
- long workflow;
- rich analysis;
- resume detail;
- job detail;
- comparison result.

Avoid modal-inside-modal flows.

---

# 38. Empty States

Every major component should have a designed empty state.

Good empty state:

- states what is missing;
- explains why it matters;
- gives one relevant action.

Example:

```text
No applications yet

Jobs you apply to will appear here so you can
track their progress.

Browse jobs
```

Avoid giant illustrations unless they genuinely improve the experience.

---

# 39. Loading States

Use skeletons that match final content structure.

Examples:

- table rows;
- metric blocks;
- list items;
- chart plot.

Do not use a single large spinner for full pages when partial loading is possible.

For background actions:

```text
Scanning resume…
```

show:

- step;
- progress if known;
- ability to leave the page if safe.

---

# 40. Error States

Errors should be local whenever possible.

Bad:

```text
Something went wrong.
```

Better:

```text
Resume scan failed

The AI provider returned a timeout.
Your uploaded file is safe and does not need to be uploaded again.

Retry scan
```

Technical detail can be expandable.

---

# 41. Toasts and Notifications

Use toasts for completed transient actions.

Examples:

- Resume uploaded;
- Job saved;
- Settings updated;
- Run started.

Do not use toasts for information the user must remember.

Error toasts should include a next action where possible.

---

# 42. Confirmation Dialogs

Only require confirmation for meaningful consequences.

Examples:

- delete resume;
- clear history;
- remove confirmed fact;
- reset profile.

Do not ask for confirmation for harmless navigation or reversible state changes.

---

# 43. Accessibility

The redesign must treat accessibility as a core engineering requirement.

Minimum:

- WCAG AA text contrast;
- visible keyboard focus;
- full keyboard navigation;
- accessible labels;
- semantic HTML;
- status communicated by text/icons, not color alone;
- table headers correctly associated;
- dialogs trap focus correctly;
- tooltips are not the only source of required information;
- charts have textual summaries or accessible data.

---

# 44. Responsive Behavior

ApplyPack is primarily a desktop productivity application, but screens must degrade gracefully.

## Desktop

Primary design target.

## Tablet

- collapsible sidebar;
- tables may scroll horizontally;
- nonessential columns can hide;
- panels can stack.

## Mobile

Do not try to preserve desktop tables unchanged.

Use:

- record cards;
- compact filters;
- bottom sheets;
- collapsible navigation.

Desktop efficiency should not be sacrificed merely to make every screen mobile-first.

---

# 45. Dark Mode

Dark mode can be added later, but tokens should support it from day one.

Avoid hard-coding:

```text
#fff
#000
```

inside arbitrary components.

Use semantic tokens.

Dark mode should preserve the same hierarchy, not simply invert colors.

---

# 46. Motion

Motion should be subtle and functional.

Good uses:

- drawer open/close;
- dropdown;
- tab content;
- small status transitions;
- drag-and-drop;
- chart appearance;
- loading progress.

Avoid:

- decorative bouncing;
- excessive scale animations;
- animated gradients;
- long transitions.

Suggested duration:

```text
120–180 ms for micro interactions
180–240 ms for panels
```

---

# 47. Icons

Use one consistent icon library.

Recommended:

**Lucide**

Rules:

- 16–18px for normal UI;
- same stroke weight;
- icons support labels rather than replace them;
- avoid placing an icon in every single card;
- avoid mixing icon styles.

---

# 48. Component Inventory

The new design system should include at least:

## Navigation

- AppSidebar
- SidebarItem
- SidebarGroup
- Breadcrumb
- Tabs
- SettingsNav

## Actions

- Button
- IconButton
- SplitButton
- DropdownMenu
- CommandMenu

## Forms

- Input
- Textarea
- Select
- Combobox
- Checkbox
- Radio
- Switch
- TagInput
- FileUpload
- DateRange
- SearchInput

## Data

- DataTable
- TableToolbar
- Pagination
- FilterChip
- SortControl
- ColumnPicker
- EmptyTable
- FitScore

## Feedback

- Badge
- Alert
- Toast
- Progress
- Skeleton
- Spinner
- InlineError

## Layout

- PageHeader
- Section
- Panel
- Card
- SplitPane
- Drawer
- Modal
- Inspector

## Analytics

- Metric
- MetricStrip
- ChartCard
- TrendIndicator
- ChartTooltip
- Legend

## Domain-specific

- JobRow
- JobCard
- ResumeCard
- ApplicationCard
- RunSummary
- PipelineHealth
- ConfirmedFact
- SkillTag

---

# 49. Design Tokens

Design tokens should be defined centrally.

At minimum:

```text
colors
spacing
font sizes
font weights
line heights
border radii
shadows
z-index
motion duration
breakpoints
component heights
```

Avoid page-specific arbitrary values.

---

# 50. Recommended Technical Foundation

If the frontend supports it, a strong stack is:

```text
Tailwind CSS
+
shadcn/ui primitives
+
TanStack Table
+
Lucide icons
+
a chart library such as Recharts
+
project-specific design tokens
```

Important:

**shadcn should be used as a component foundation, not as the visual identity.**

The final components must be customized to ApplyPack.

Do not let the product look like a default shadcn demo.

---


# 50A. Ready-Made Design / Template Strategy

ApplyPack should **not** be rebuilt around a complete third-party admin dashboard template.

A ready-made dashboard may be used as:

- visual reference;
- source of individual interaction patterns;
- source of layout ideas;
- source of isolated reusable primitives;
- inspiration for tables, filter bars, chart cards, settings layouts and sidebars.

It should **not** become the master design system.

ApplyPack already contains domain-specific concepts that generic templates do not understand:

- Fit Score;
- alert / save / apply lifecycle;
- resume matching;
- confirmed facts;
- job discovery;
- pipeline health;
- run history;
- screening;
- future job-search analytics.

A full template would force these concepts into someone else's visual model and often creates a recognizable "admin theme" appearance.

## Recommended rule

Use:

```text
reference → extract principle → adapt to ApplyPack tokens → implement locally
```

Do not use:

```text
download dashboard → replace labels → ship
```

Good candidates to borrow selectively:

- table toolbar layout;
- filter popover structure;
- chart card anatomy;
- settings navigation;
- command menu;
- empty-state pattern;
- drawer layout;
- responsive table pattern;
- column picker;
- date-range selector.

Everything borrowed must be restyled with ApplyPack tokens.

---

# 50B. shadcn/ui Recommendation

For a React-based frontend, shadcn/ui is recommended as a **component foundation**, not as the visual design.

Use it for low-level primitives such as:

```text
Button
Input
Textarea
Select
Combobox
Command
Popover
DropdownMenu
Dialog
Sheet / Drawer
Tabs
Tooltip
Checkbox
Radio
Switch
Badge
Skeleton
Calendar / Date picker
```

Benefits for ApplyPack:

- component source code lives in the project;
- components can be fully customized;
- no need to accept a library's visual identity;
- accessible primitives are easier to standardize;
- Claude Code can inspect and modify actual component code;
- design tokens can be applied consistently.

## Important limitation

Do not accept the default shadcn appearance as the finished product.

Avoid:

- default demo cards everywhere;
- default dashboard composition;
- default gray palette;
- generic shadcn sidebar appearance;
- blindly copying blocks without adapting spacing or hierarchy.

Every imported primitive must conform to:

```text
ApplyPack colors
ApplyPack typography
ApplyPack radius
ApplyPack spacing
ApplyPack component height
ApplyPack focus style
ApplyPack interaction rules
```

---

# 50C. Claude MCP Strategy

MCP can be useful, but it must be treated as a **search and implementation assistant**, not as an autonomous design director.

Recommended MCP configuration:

```text
Claude Code
├── shadcn MCP
├── 21st.dev MCP
└── project-specific ApplyPack design skill
```

The project-specific ApplyPack rules always have higher priority than third-party examples.

## shadcn MCP

Recommended.

Use it so Claude can:

- inspect available components;
- search the registry;
- understand component installation;
- avoid recreating primitives unnecessarily;
- install only required components;
- inspect examples before implementation.

Recommended initialization for Claude Code when appropriate:

```bash
pnpm dlx shadcn@latest mcp init --client claude
```

Also consider the shadcn skill so the agent understands the project's component configuration.

## 21st.dev MCP

Recommended **as a design/component catalogue**, not as the source of the whole UI.

Good use:

> Find compact B2B table toolbar patterns suitable for a data-heavy job-search workspace.

Bad use:

> Install a complete dashboard that looks modern.

### Required 21st.dev workflow

Claude must:

1. search;
2. inspect candidates;
3. compare them with ApplyPack design rules;
4. explain which parts are useful;
5. copy/adapt only the required pattern;
6. remove unnecessary dependencies;
7. restyle it with ApplyPack tokens.

Claude should not automatically install a component merely because it looks visually impressive.

## Third-party component approval checklist

Before adding any component from an MCP/catalogue, verify:

- Does an equivalent component already exist?
- Does it introduce a new dependency?
- Does it introduce an animation library?
- Does it ship large icons/assets?
- Does it create many nested DOM nodes?
- Does it render expensive effects?
- Does it fit keyboard accessibility requirements?
- Can it be restyled using current tokens?
- Does it solve a real UX problem?
- Will it remain maintainable after the original source changes?

If the answer is unclear, do not add it.

---

# 50D. Anthropic Frontend Design Skill

The frontend-design skill can be useful for avoiding generic AI-generated interfaces.

However, ApplyPack is a data-heavy productivity product, so expressive visual design must be constrained.

Add the following project override:

```text
ApplyPack is a professional data workspace.

Do not optimize for spectacle.

Prioritize:
- readability
- scanability
- information hierarchy
- compact data presentation
- fast rendering
- predictable interactions
- accessibility
- maintainability

Avoid:
- experimental layout for its own sake
- decorative animation
- large hero-style UI
- animated gradients
- glassmorphism
- oversized typography
- excessive illustration
- motion-heavy dashboards
```

The ApplyPack project skill is the final authority.

---

# 50E. Dependency Policy

The redesign must not become a dependency-collection exercise.

Before installing a frontend package, Claude must ask:

```text
Can this be implemented cleanly using:
1. existing project code;
2. CSS;
3. shadcn/Radix primitive;
4. an already installed library?
```

Only install another dependency if it provides meaningful value.

## Avoid duplicate libraries

Do not install multiple solutions for the same role.

Preferred defaults:

```text
Icons: Lucide
Tables: TanStack Table if advanced table behavior is required
Charts: Recharts for normal dashboard analytics
Primitives: shadcn/Radix where appropriate
```

Avoid duplicate icon, chart, modal, table or form libraries without a clear reason.

---

# 50F. Performance Architecture — Core Principle

The UI redesign must not move backend work into the browser.

ApplyPack is a data-heavy application.

The frontend should primarily:

```text
request prepared data
→ render it
→ handle local interaction
```

It should not download large datasets and repeatedly derive all application state in the browser.

Core rule:

> **Filter, sort, aggregate and paginate large datasets on the backend. Render small, purpose-specific payloads on the frontend.**

---

# 50G. Backend-First Data Flow

Use this architecture:

```text
DATABASE
   ↓
backend query
   ↓
filter / sort / aggregate
   ↓
purpose-specific DTO
   ↓
small API response
   ↓
frontend
   ↓
lightweight rendering
```

Avoid:

```text
DATABASE
   ↓
return everything
   ↓
frontend downloads thousands of records
   ↓
frontend filters/sorts/groups repeatedly
   ↓
large render tree
```

This is especially important for:

- Jobs;
- Runs;
- Companies;
- Applications history;
- analytics;
- future event/history tables.

---

# 50H. API DTO Strategy

Do not return full database entities to list pages if most fields are unused.

Create view-specific DTOs.

Example:

```typescript
type JobListItem = {
  id: string
  title: string
  company: string
  location: string
  fit: number
  status: JobStatus
  fetchedAt: string
  skills: string[]
}
```

A Jobs list does not need:

- full description;
- full AI analysis;
- raw source response;
- full company object;
- all matching details;
- internal processing metadata.

Load those fields only when the user opens the job.

Example:

```text
GET /jobs
→ lightweight list DTO

GET /jobs/:id
→ full detail DTO
```

Benefits:

- less database serialization;
- smaller network payloads;
- less browser memory;
- fewer unnecessary object allocations;
- simpler frontend components;
- fewer accidental rerenders.

---

# 50I. Server-Side Pagination, Sorting and Filtering

For large collections, pagination/filtering/sorting should be server-side.

Recommended Jobs request shape:

```http
GET /jobs?
  page=1
  limit=50
  status=alerted
  country=US
  remote=true
  fit_min=75
  sort=fetched_desc
```

Possible response:

```json
{
  "items": [],
  "total": 12842,
  "page": 1,
  "pages": 257
}
```

Do not retrieve 12,000 jobs merely to display 50.

A starting target such as 25–50 rows is appropriate for dense desktop tables.

---

# 50J. Table Virtualization Policy

Virtualization is useful, but it should not be added automatically.

For ordinary paginated screens:

```text
25 rows → normal table
50 rows → normal table
100 rows → usually still normal table
```

Consider virtualization when:

- users intentionally view hundreds/thousands of rows;
- infinite scrolling is required;
- run/event logs become very large;
- a table contains a large continuously scrolling result set.

Important:

> Virtualization reduces DOM nodes. It does not reduce downloaded data.

Therefore:

```text
server pagination first
virtualization only where it solves a real rendering problem
```

---

# 50K. Table Cell Performance Rules

Do not turn every cell into a complex component tree.

Avoid a row architecture like:

```text
Row
├── Tooltip
├── Popover
├── Dropdown
├── Avatar
├── AnimatedProgress
├── Badge
├── Chart
└── several nested providers
```

multiplied by 50–100 rows.

Prefer:

- plain text markup;
- simple CSS bars;
- lightweight badges;
- one contextual menu trigger;
- popover content mounted/opened on demand;
- CSS hover states.

## Fit Score

A Fit Score progress bar should generally be simple CSS.

Do not use a charting library for a table Fit Score.

---

# 50L. Overview Endpoint Strategy

The Overview page should not fetch several large resources and calculate the dashboard in the browser.

Prefer a dedicated endpoint such as:

```text
GET /overview
```

Possible response:

```json
{
  "metrics": {
    "new": 0,
    "alerted": 22,
    "applied": 1,
    "saved": 3
  },
  "recentMatches": [],
  "pipeline": {},
  "applicationTrend": []
}
```

This gives the frontend exactly what the screen needs.

Avoid:

```text
load all jobs
+ load all applications
+ load all runs
+ filter them
+ group them
+ aggregate them in browser
```

The server/database is better suited to preparing this data.

---

# 50M. Analytics API Strategy

Charts should consume **aggregated datasets**, not raw domain entities.

Bad:

```text
frontend receives 18,000 jobs
→ JavaScript groups them by day
→ JavaScript calculates average fit
→ chart renders result
```

Better:

```text
GET /analytics/jobs-discovered?range=30d
```

returns:

```json
[
  { "date": "Sep 01", "count": 41 },
  { "date": "Sep 02", "count": 52 }
]
```

For most dashboard charts, the frontend should receive:

```text
7 points
30 points
90 points
a few dozen categories
```

rather than thousands of raw records.

---

# 50N. Chart Library Strategy

## Default: Recharts

Recharts is suitable for normal ApplyPack dashboard analytics when the data has already been aggregated.

Examples:

- 7-day trend;
- 30-day job discovery trend;
- average fit over time;
- source counts;
- application stages;
- top technologies;
- salary ranges.

For these workloads, visual clarity and developer productivity matter more than extreme rendering optimization.

## Do not use charts for micro visualizations unnecessarily

Examples such as:

```text
Fit Score bar
small progress
pipeline status
```

should usually use CSS, not Recharts.

## Very large time-series

If ApplyPack later needs tens or hundreds of thousands of plotted points, evaluate a specialized canvas-based renderer such as uPlot.

Do not add uPlot now unless there is an actual requirement.

Principle:

```text
Recharts for normal product analytics
specialized renderer only for genuinely large datasets
```

---

# 50O. Lazy Loading and Code Splitting

Analytics libraries do not need to be loaded on every screen.

If the framework allows it, chart-heavy modules may be lazy-loaded on screens that use them.

Examples:

```text
Overview analytics
Company analytics
Resume performance analytics
```

should not necessarily increase the initial JavaScript cost of:

```text
Settings
simple forms
lightweight CRUD pages
```

Likewise, large editors or advanced comparison tools should load only where needed.

Do not over-engineer code splitting into tiny chunks, but avoid loading heavy feature code globally.

---

# 50P. Client State vs Server State

Do not copy all API data into large global frontend stores without reason.

Treat backend data as server state.

Use local/component state for:

- currently open menu;
- selected tab;
- unsaved form values;
- drawer state;
- temporary UI state.

Avoid duplicating the same dataset in:

```text
API cache
global store
page state
derived state
```

unless there is a specific requirement.

---

# 50Q. Derived Data and Rerenders

Do not repeatedly perform expensive operations in render paths.

Avoid patterns where every render executes large:

```text
filter
sort
group
reduce
map
```

operations across large arrays.

Prefer:

- backend preparation;
- small payloads;
- stable computed data;
- memoization only when profiling shows value;
- simple presentational components.

Do not add `memo`, `useMemo`, or `useCallback` everywhere by habit.

Optimization should be targeted.

---

# 50R. Animation Policy

ApplyPack does not need a motion-heavy design.

Recommended motion budget:

```text
hover/focus transition: ~100–150 ms
dropdown/popover: ~120–160 ms
drawer/modal: ~180–220 ms
```

Prefer CSS transitions.

Use motion only to explain:

- opening;
- closing;
- movement;
- selection;
- loading/progress.

Avoid:

- page entrance animations;
- springy cards;
- animated backgrounds;
- parallax;
- glowing effects;
- continuous decorative animation;
- expensive blur transitions;
- large chart entrance sequences.

Principle:

> In a professional data workspace, responsiveness feels more premium than animation.

---

# 50S. Expensive CSS / Visual Effects

Avoid using expensive effects as a major part of the UI.

Use cautiously:

- large backdrop blur;
- large animated gradients;
- complex filters;
- multiple layered shadows;
- sticky blurred surfaces covering most of the viewport.

ApplyPack should obtain depth mostly from:

```text
surface color
spacing
border
typography
small shadows
```

---

# 50T. Rendering and DOM Complexity

Claude should prefer the simplest DOM that expresses the design.

Review components for:

- unnecessary wrapper divs;
- repeated providers;
- unnecessary tooltip instances;
- duplicated invisible content;
- giant SVG decorations;
- large inline icon collections.

DOM simplicity improves:

- maintainability;
- accessibility;
- debugging;
- rendering performance.

---

# 50U. Images and Icons

ApplyPack is primarily an information product.

Avoid shipping large decorative image assets for application chrome.

Recommended:

```text
Lucide
```

Keep:

- one icon library;
- SVG icons;
- consistent stroke;
- standard sizes.

---

# 50V. Loading Strategy

The UI should show useful structure while data loads.

Use:

- table skeleton rows;
- metric skeletons;
- chart placeholders;
- section-level loading states.

Avoid blocking the whole page with a large spinner if independent sections can load separately.

However, do not create dozens of separate API calls just to make every widget independently load.

Balance reasonable endpoint grouping with clear loading hierarchy.

---

# 50W. Request Count and N+1 Frontend Calls

Avoid rendering a list and then issuing one API request per row.

Bad:

```text
GET /jobs
GET /jobs/1/company
GET /jobs/2/company
GET /jobs/3/company
...
```

The list endpoint should include the lightweight data needed for each row.

Detailed secondary information should load only after opening the record.

---

# 50X. Performance Budget and Verification

Before the redesign begins, capture a baseline.

Measure representative pages:

```text
Overview
Jobs
Applications
Resumes
Compare
Runs
Settings
```

Track:

- API payload size;
- request count;
- page load time;
- initial JS bundle impact;
- row render behavior;
- slow interactions;
- unnecessary rerenders;
- chart rendering;
- memory growth when navigating repeatedly.

The redesign should not be approved only because it looks better.

It must also avoid meaningful performance regressions.

## Practical acceptance targets

These are engineering targets, not absolute guarantees:

- ordinary table interactions should feel immediate;
- search/filter controls should not freeze the page;
- normal Jobs pages should render tens of rows, not thousands;
- dashboard charts should use aggregated data;
- row hover should be CSS-level and immediate;
- opening a dropdown should not trigger expensive page-wide rerenders;
- large feature libraries should not be included globally without need.

Use browser performance tools and framework profiling before introducing complex optimization.

---

# 50Y. Visual Verification + Performance Verification

Every major redesigned screen should pass two reviews.

## Visual review

Check:

- hierarchy;
- spacing;
- typography;
- consistency;
- density;
- states;
- responsiveness.

## Performance review

Check:

- payload;
- request count;
- rerenders;
- DOM size;
- responsiveness;
- chart complexity;
- dependency cost.

A visually excellent component that adds substantial runtime cost without product value should be simplified.

---

# 50Z. Safe Migration Strategy for the New Branch

The redesign should be implemented incrementally in a dedicated branch.

Recommended sequence:

```text
1. create redesign branch
2. capture screenshots and performance baseline
3. inventory existing components
4. establish design tokens
5. install/configure only approved primitives/MCP tools
6. redesign Jobs
7. visually verify Jobs
8. performance-test Jobs
9. extract stable shared components
10. migrate remaining screens gradually
11. add analytics primitives
12. run full regression
13. perform accessibility audit
14. perform dependency/bundle audit
```

## Do not mix unrelated product rewrites into the design migration

Where possible, keep visual redesign separate from:

- business logic changes;
- database redesign;
- large API behavior changes;
- unrelated new functionality.

Backend API improvements required for performance are valid, but they should be explicit and tested.

---

# 50AA. Claude Code Implementation Rules

Add these rules to the project prompt / skill.

```text
PERFORMANCE RULES

- Do not move backend aggregation into the browser.
- Do not load full collections when pagination can be used.
- Prefer purpose-specific API DTOs.
- Do not add virtualization until the dataset requires it.
- Do not use a chart library for simple progress bars.
- Do not mount expensive interactive components in every table cell.
- Do not add animation libraries for basic transitions.
- Prefer CSS transitions.
- Do not introduce a dependency without explaining why existing tools are insufficient.
- Do not install full dashboard templates.
- Search third-party component catalogues first; adapt only selected patterns.
- Keep one icon system, one table strategy and one main chart strategy.
- Keep chart data aggregated on the backend.
- Preserve accessibility while optimizing.
- Measure before applying advanced memoization.
- Verify both screenshots and performance after each major screen.
```

Add these design rules:

```text
DESIGN RULES

- Preserve ApplyPack's emerald identity.
- Do not turn the UI into a generic shadcn dashboard.
- Keep data dense but readable.
- Prefer hierarchy over decoration.
- Prefer fewer stronger components over many cards.
- Use color semantically.
- Hide advanced detail until requested.
- Keep important controls obvious.
- Use consistent tokens everywhere.
```

---

# 50AB. Recommended Final Tooling Decision

For ApplyPack, the preferred approach is:

```text
CUSTOM APPLYPACK DESIGN SYSTEM
             │
             ├── Tailwind / project tokens
             │
             ├── shadcn/ui primitives
             │
             ├── Lucide
             │
             ├── TanStack Table where advanced tables need it
             │
             └── Recharts for aggregated analytics
                     │
                     ▼
                 FRONTEND
```

Claude-side tooling:

```text
Claude Code
├── ApplyPack project design skill       ← highest priority
├── frontend-design skill                ← general design reasoning
├── shadcn skill / MCP                   ← primitives and registry
└── 21st.dev MCP                         ← inspiration/component search
```

Performance architecture:

```text
Database
   ↓
Backend
   ├── filter
   ├── sort
   ├── paginate
   ├── aggregate
   └── map to lightweight DTO
          ↓
       Frontend
          ├── small tables
          ├── compact forms
          ├── CSS micro-interactions
          └── aggregated charts
```

This approach provides the best balance for ApplyPack between:

- visual quality;
- readability;
- product identity;
- development speed;
- Claude Code productivity;
- frontend performance;
- long-term maintainability.



# 51. Claude Code Design Workflow

Do not ask Claude:

> “Redesign the whole application and make it modern.”

That produces inconsistent results.

Use a controlled workflow.

## Phase 1 — Audit

Claude should inventory:

- all pages;
- layouts;
- forms;
- buttons;
- tables;
- badges;
- cards;
- tabs;
- filters;
- typography;
- spacing;
- colors;
- repeated components.

No visual redesign yet.

---

## Phase 2 — Create tokens

Implement:

- color tokens;
- spacing;
- typography;
- radius;
- shadows;
- component sizes.

No page-specific hacks.

---

## Phase 3 — Redesign Jobs first

Jobs should be the visual prototype.

It establishes:

- sidebar;
- header;
- search;
- filters;
- tabs;
- table;
- FitScore;
- statuses;
- pagination;
- interactions.

Do not redesign all pages before this screen is visually approved.

---

## Phase 4 — Visual verification loop

For each important screen:

```text
implement
↓
run
↓
take screenshot
↓
inspect screenshot
↓
compare to design specification
↓
fix
↓
repeat
```

A passing build is not sufficient.

---

## Phase 5 — Extract stable components

Once Jobs is approved:

- extract shared table styles;
- extract toolbar;
- FitScore;
- status badges;
- page header;
- navigation;
- filter patterns.

---

## Phase 6 — Roll out by screen family

Suggested order:

1. Jobs
2. Overview
3. Applications
4. Resumes
5. Compare
6. Runs
7. Settings
8. Companies
9. Discovery
10. Screening
11. Cover letter

---

# 52. Custom Claude Design Skill

Create a project-specific design skill.

Suggested location:

```text
.claude/
  skills/
    applypack-design/
      SKILL.md
      references/
        DESIGN_SYSTEM.md
        COMPONENTS.md
        TABLES.md
        FORMS.md
        CHARTS.md
        ACCESSIBILITY.md
```

The skill should explicitly tell Claude:

```text
ApplyPack is a professional data workspace.

Priorities:
1. readability
2. hierarchy
3. data density
4. consistency
5. accessibility
6. product identity

Avoid:
- generic SaaS dashboard appearance
- purple gradients
- glassmorphism
- excessive cards
- nested cards
- huge KPI cards
- random colors
- excessive pills
- excessive border radius
- decorative charts
- unnecessary instructional text
- inconsistent spacing
- page-specific CSS hacks

Prefer:
- emerald interaction language
- restrained neutral surfaces
- typography hierarchy
- compact tables
- progressive disclosure
- contextual actions
- meaningful charts
- semantic color
- reusable tokens
```

---

# 53. Forbidden Patterns

The redesign should explicitly avoid:

- default Bootstrap admin appearance;
- default Material Dashboard appearance;
- default shadcn demo appearance;
- giant colorful KPI cards;
- gradients on ordinary buttons;
- excessive glassmorphism;
- giant rounded containers;
- pill-shaped everything;
- card-inside-card-inside-card;
- heavy shadows;
- arbitrary icon colors;
- colorful chart dashboards without analytical purpose;
- excessive helper paragraphs;
- raw JSON as primary content;
- empty pages with giant unused areas;
- hiding important actions behind unclear icons;
- inconsistent focus states.

---

# 54. Design Acceptance Checklist

Before considering a page redesigned, verify:

## Hierarchy

- Is the most important information obvious within three seconds?
- Is the primary action obvious?
- Are secondary actions visually quieter?

## Typography

- Are title, entity, body and metadata clearly distinguishable?
- Are long descriptions minimized?

## Color

- Is green intentional?
- Is status understandable without relying only on color?
- Are semantic colors consistent?

## Layout

- Is whitespace intentional?
- Are data-heavy areas compact enough?
- Are there unnecessary cards?

## Forms

- Are labels clear?
- Is helper text concise?
- Are advanced explanations progressively disclosed?

## Tables

- Are columns aligned?
- Are values scannable?
- Are actions contextual?
- Does hover clearly indicate interactivity?

## Charts

- Does every chart answer a real question?
- Is the visualization type appropriate?
- Is the number of colors restrained?
- Is an empty/loading state defined?

## Accessibility

- Keyboard works?
- Focus is visible?
- Contrast is sufficient?
- Labels are semantic?

## Consistency

- Does this screen look like the same product as every other screen?
- Could the component be reused elsewhere?

---

# 55. Recommended Final Visual Direction

The target appearance should be:

- warm gray-green application background;
- calm white working surfaces;
- deep graphite text;
- emerald interaction states;
- low visual noise;
- clear page titles;
- compact metadata;
- strong tables;
- restrained cards;
- minimal shadows;
- subtle borders;
- contextual actions;
- strong search/filter UX;
- charts that feel analytical rather than decorative;
- limited, semantic accent colors.

The redesign should make ApplyPack feel less like:

> “an admin dashboard for a job-search script”

and more like:

> **“a professional personal job-search operating system.”**

That distinction should guide every design decision.

---

# 56. Immediate Next Step

Do not redesign the whole repository immediately.

The safest next step is:

1. freeze current functionality;
2. inventory existing UI components;
3. implement global tokens;
4. redesign the **Jobs** screen as the visual reference;
5. capture screenshots at desktop width;
6. iterate until it establishes the desired ApplyPack style;
7. extract reusable components;
8. migrate the rest of the application;
9. add charts only after chart primitives and tokens are defined;
10. perform a final cross-page consistency and accessibility pass.

The Jobs page should effectively become the **living visual specification** for the rest of ApplyPack.

---

# 57. Core Principle to Preserve

When making future decisions, use this rule:

> **Do not ask whether a UI element looks modern. Ask whether it makes important information easier to understand, while still looking unmistakably like ApplyPack.**

That principle should keep the project modern without turning it into a collection of trends.
