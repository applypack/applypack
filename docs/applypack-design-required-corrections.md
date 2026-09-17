# ApplyPack Design Spec — Required Corrections Only

> This document is a **delta/correction** to the previous ApplyPack UI/UX redesign specification.  
> It contains **only the changes that should be made** after validating the actual project architecture and existing repository rules.
>
> Do **not** treat this as a replacement for all previous visual design recommendations.  
> Keep the useful visual guidance from the original spec unless explicitly changed below.

---

# 1. Remove React-oriented frontend recommendations

The previous specification assumed a React-style frontend in several places. That does not match the current ApplyPack architecture.

ApplyPack is based on:

```text
Hono
→ server-rendered JSX
→ semantic HTML
→ CSS
→ minimal browser JavaScript
→ no-JS fallback
→ no third-party hosted runtime dependencies
```

Therefore, remove recommendations that would introduce a React/client application architecture.

## Remove

Do not introduce these as part of the redesign:

```text
shadcn/ui runtime/component stack
TanStack Table
Recharts
React state management
React Query-style server state
useMemo / useCallback / memo recommendations
React virtualization
React code-splitting guidance
client-side dashboard aggregation
client-rendered table architecture
```

These are not needed for the current application and would work against the existing architectural constraints.

---

# 2. Replace the frontend technology strategy

Replace the previous component-stack recommendation with this model:

```text
Hono JSX
   ↓
semantic HTML
   ↓
DESIGN.md tokens
   ↓
small reusable server-side UI primitives
   ↓
CSS
   ↓
native browser elements
   ↓
tiny progressive-enhancement JavaScript only where justified
```

The redesign goal is:

> **Make server-rendered HTML look like a premium modern data workspace without turning ApplyPack into a client application.**

This is the main engineering/design constraint for the redesign.

---

# 3. Do not add shadcn/ui or shadcn MCP

Remove the recommendation to initialize shadcn or add the shadcn MCP.

Do not run:

```bash
pnpm dlx shadcn@latest ...
```

for this redesign.

Reason:

- it assumes a React-oriented component workflow;
- ApplyPack already has a server-rendered UI architecture;
- it creates unnecessary implementation pressure toward client-side components;
- the visual design goals can be achieved with Hono JSX + CSS.

If shadcn examples are ever consulted, treat them only as visual references, not as installable components.

---

# 4. Do not make 21st.dev MCP part of the implementation workflow

21st.dev can still be used manually as a source of visual inspiration, but it should not be a required implementation dependency or primary Claude workflow.

The main problem is not runtime cost; it is architectural mismatch.

Typical component examples from 21st.dev are likely to be React-oriented, which creates unnecessary translation work:

```text
React component
→ extract design idea
→ remove framework assumptions
→ rewrite in Hono JSX
```

Therefore:

- do not require 21st.dev MCP;
- do not let Claude install components from it;
- use screenshots/examples only when a specific UI pattern needs inspiration.

The repository's own design documents should remain the source of truth.

---

# 5. Keep existing repository design authority

Do **not** create a second ApplyPack-specific Claude design skill if the current agent tooling already reads the repository documentation.

The source-of-truth hierarchy should be:

```text
PRODUCT.md
    ↓
architecture constraints

DESIGN.md
    ↓
visual system and UI rules

ui-review
    ↓
verification rules

existing Claude/impeccable workflow
    ↓
implementation
```

Avoid duplicating the same rules in another skill because the documents can diverge.

## Required repository cleanup

Update `DESIGN.md` in the same PR that changes design tokens.

Also review `ui-review` for stale rules.

Known example:

```text
Fira Sans
```

should be removed if the actual dashboard font is Inter.

Repository rules must describe the UI that actually exists after the redesign.

---

# 6. Keep Inter; do not switch to Geist

Remove the recommendation to replace Inter with Geist.

Inter is already bundled and supports the weight range needed for the redesigned hierarchy.

Changing font family adds little value and creates unnecessary churn.

Keep Inter and implement the hierarchy through size, weight, line-height and color.

Recommended scale:

```text
26px — page title
18px — section title
15px — entity/title row
14px — body and normal controls
12px — metadata/helper text
```

Suggested weights:

```text
650–700 — page title
600–650 — section heading
550–600 — entity title
400–450 — body text
500–550 — field labels
```

The exact values should be implemented through existing font capabilities rather than introducing another font.

---

# 7. Correct the color palette for accessibility

The earlier palette used some values with insufficient contrast on the proposed app background.

Do not use the following as ordinary text colors without revalidation:

```text
#07875F
#8C9791
#B26014
```

especially on:

```text
#F6F8F7
```

Use the existing stronger values as the safer foundation.

Recommended revised starting tokens:

```css
--ink: #101828;
--ink-muted: #475467;
--ink-faint: #667085;

--accent: #047857;
--accent-hover: #065F46;
--accent-soft: #E7F4ED;

--warning: #A24F0A;
--warning-soft: #FFF2E3;

--danger: #B42318;
--danger-soft: #FEECEB;

--canvas: #F5F7F6;
--surface: #FFFFFF;
--surface-subtle: #EEF2F0;
--surface-selected: #E4F1EA;

--border: #D7DEDA;
--border-strong: #C8D1CC;
```

These are still design tokens to validate before final adoption.

## Required rule

Every text/status color used in `layout.tsx`, `ui.tsx`, or equivalent shared styling must be checked with an automated WCAG contrast test.

Do not rely on visual judgment alone.

Target:

```text
WCAG AA
4.5:1 for normal text
3:1 for large text where applicable
```

---

# 8. Do not rely on surface contrast alone

The previous spec suggested replacing many borders with subtle surface layers.

That principle should be softened.

If two adjacent surfaces differ only slightly, the hierarchy is not visually strong enough.

Therefore use a combination of:

```text
surface color
+
spacing
+
typography
+
subtle 1px divider/border
```

Do not assume that a small background-color change can replace structure.

Recommended approach:

```text
Canvas
→ page background

Surface
→ primary content

Surface subtle
→ grouped/secondary region

Surface selected
→ interaction/selection
```

Selected or active states should additionally use one or more of:

```text
accent text
accent icon
left indicator
stronger border
```

Do not communicate state by background color alone.

---

# 9. Keep CSS and Hono JSX as the UI component system

Instead of importing a component library, create/refine small server-side UI primitives in the current codebase.

Examples:

```text
<PageHeader />
<Section />
<Button />
<Badge />
<FitScore />
<DataTable />
<FilterChip />
<Metric />
<MetricStrip />
<EmptyState />
<Notice />
<Field />
<Disclosure />
<Status />
```

These should:

- render simple semantic HTML;
- have minimal DOM nesting;
- use central design tokens;
- work without client-side hydration;
- degrade correctly without JavaScript;
- remain reusable across pages.

Do not recreate a large framework internally. Only extract primitives that are repeated.

---

# 10. Keep existing backend-first behavior; do not rewrite what already works

The previous spec described:

- server-side pagination;
- SQL filtering;
- server-side aggregation;
- Overview preparation on the backend;
- lightweight browser state.

If these are already implemented, **do not create redesign tasks for them**.

Do not rewrite working backend behavior simply because the design document mentions it.

The design PR should preserve the existing strengths:

```text
Jobs: server pagination
Jobs: SQL facets
Overview: server-rendered
minimal client state
no unnecessary client aggregation
```

Any backend change must solve a concrete UI/performance requirement.

---

# 11. Jobs filters: first structural redesign

The first design experiment should be the Jobs page filter area.

Current problem:

- too many controls are permanently visible;
- filter dimensions compete with the table;
- visual complexity is much higher than the primary task requires.

Replace permanently expanded filter rows with progressive disclosure.

Recommended structure:

```text
[ Search jobs........................ ] [ Filters (3) ]

All   New   Alerted   Applied   Saved   Dismissed

United States ×    Remote ×    Last 7 days ×
```

Advanced filters:

```html
<details>
  <summary>Filters (3)</summary>

  <!-- server-rendered filter form -->
</details>
```

Requirements:

- must work without JavaScript;
- existing filter behavior must remain functional;
- active filters must remain visible when the disclosure is closed;
- clearing one filter must be possible directly from active filter chips;
- the filter count should reflect active criteria.

## Measurable target

Record the current number of visible filter controls above the table.

Target:

```text
~98 visible controls
→ approximately 15 primary visible controls
```

The exact final number may vary, but the reduction should be measurable.

---

# 12. Disclosure redesign for Settings, Resumes and Compare

These pages contain too much simultaneously visible explanation and/or alternative input modes.

Use progressive disclosure.

## Forms

Default:

```text
Label
one concise helper sentence
control
```

Longer explanation:

```html
<details>
  <summary>How this works</summary>
  ...
</details>
```

Do not remove information that explains important limits, caps, gates, persistence, or system behavior.

Create a **must-stay list** before editing explanatory content.

Reference the existing repository documentation where these explanations are already defined.

---

# 13. Compare page: collapse inactive input modes

Do not show all methods simultaneously.

Example:

```text
Job source

● Existing job
○ Paste job description
```

Only render/expand the fields for the active mode.

Likewise for resume selection:

```text
● Existing resume
○ Upload
○ Paste text
```

This should be implemented in a way compatible with no-JS fallback.

Prefer server-rendered form state / request parameters where possible.

JavaScript may progressively enhance the experience, but the page should remain functional without it.

---

# 14. Overview: metric strip instead of separate equal cards

Keep the earlier visual recommendation, but implement it with server-rendered HTML only.

Replace four visually equal standalone cards with one coherent metric surface.

Example:

```text
New          Alerted          Applied          Saved
0            22               1                3
—            +6 today         —                +2 today
```

The goal is:

- reduce card clutter;
- improve scanability;
- make the numbers the visual focus.

No client-side data handling is required.

---

# 15. Runs: replace raw JSON as the primary presentation

Raw JSON should remain available, but not as the main UI.

Default presentation:

```text
Fetch completed

593 fetched
55 duplicates
3 persisted
3 classified

25.3 seconds
```

Then:

```html
<details>
  <summary>Raw output</summary>
  <pre>...</pre>
</details>
```

Use the existing human-readable fetch/run summary helper if already available.

Goals:

- improve scanning;
- preserve technical detail;
- avoid removing debugging information;
- no JavaScript required.

---

# 16. Job detail page: prefer server-side navigation

Do not prioritize drawers or client-side tabs.

Preferred sequence:

## Option A — query tabs

```text
/jobs/123
/jobs/123?tab=match
/jobs/123?tab=company
/jobs/123?tab=tracking
```

## Option B — routes

```text
/jobs/123
/jobs/123/match
/jobs/123/company
/jobs/123/tracking
```

Benefits:

- shareable URLs;
- browser history works naturally;
- no client state;
- no hydration;
- simpler tests;
- no-JS compatibility.

Use visual tabs as links.

---

# 17. Defer drawers/inspectors

The previous recommendation to use a right-side inspector/drawer should be postponed.

Use, in order of preference:

```text
normal page
→ query-param tab
→ <details>
→ native <dialog>
→ tiny JS enhancement
```

Only introduce a custom drawer if there is a demonstrated UX need that cannot be solved clearly with simpler primitives.

Do not introduce client complexity only to imitate SPA interaction patterns.

---

# 18. Defer searchable comboboxes

Do not introduce a JavaScript combobox framework during the initial redesign.

Use native controls first:

```html
<select>
```

or, where appropriate:

```html
<input list="...">
<datalist>...</datalist>
```

For large datasets, prefer a server-side search/result flow.

Example:

```text
GET /jobs?query=backend
```

Only build a richer JS combobox if there is a concrete usability problem that native/server-rendered controls cannot solve.

---

# 19. Graph implementation: server-rendered SVG

Remove Recharts from the recommendation.

When analytics are implemented later, use server-rendered SVG generated by a pure function where practical.

Example architecture:

```text
SQL aggregation
→ backend data
→ pure chart function
→ SVG
→ HTML response
```

Advantages:

```text
no chart JS
no hydration
no runtime dependency
no client chart state
no external host
```

## Visual rules from the original spec remain valid

Keep:

- one primary emerald series;
- restrained neutral secondary series;
- subtle grid;
- readable labels;
- no rainbow palette;
- only meaningful charts;
- concise titles and summaries.

---

# 20. Accessible chart fallback

Every chart must expose the information without relying solely on the SVG.

Recommended structure:

```html
<figure>
  <svg aria-labelledby="chart-title chart-desc">
    ...
  </svg>

  <figcaption>
    42 jobs were found during the last 7 days, up 18% from the previous period.
  </figcaption>
</figure>
```

For data that benefits from inspection:

```html
<details>
  <summary>View chart data</summary>
  <table>
    ...
  </table>
</details>
```

This preserves:

- accessibility;
- no-JS behavior;
- inspectable raw values.

---

# 21. Graphs remain a later phase

Do not introduce charts during the initial visual cleanup.

Implement them together with the planned analytics/search-funnel functionality.

The initial redesign should first improve:

- information hierarchy;
- filters;
- typography;
- forms;
- tables;
- Overview;
- Runs;
- Job detail.

Charts should solve actual analytical questions, not decorate the dashboard.

---

# 22. Add a baseline phase before redesign PRs

Add a PR/task before visual changes whose purpose is measurement only.

Capture representative screenshots and metrics for:

```text
Overview
Jobs
Applications
Resumes
Compare
Runs
Settings
```

Record:

```text
visible controls
visible explanatory words
tab stops
HTML size
JS bytes
request count
external hosts
```

For data-heavy screens also record:

```text
rows rendered
server response size
```

This creates an objective before/after reference.

---

# 23. Use measurable redesign criteria

Every redesign PR should define at least one number it intends to improve.

Do not use only:

```text
looks cleaner
feels more modern
better UX
```

Measure three categories.

## Visual complexity

Examples:

```text
visible controls
visible words
number of equal-weight cards
number of simultaneously visible choices
```

## Interaction complexity

Examples:

```text
tab stops
clicks to primary action
number of expanded controls
number of decisions required before primary task
```

## Technical complexity

Examples:

```text
JS bytes
HTML size
request count
external requests
dependency count
```

The purpose is not to minimize every number blindly; it is to verify that a redesign solves the stated problem without creating another one.

---

# 24. Revised implementation order

Use the following order.

## PR 0 — Baseline

No visual changes.

Capture:

- screenshots;
- UI metrics;
- HTML/JS/request metrics.

---

## PR 1 — Jobs filters

Goal:

- reduce permanently visible filter controls;
- preserve functionality;
- use `<details>`;
- show active filter chips.

Primary metric:

```text
visible controls above Jobs table
```

---

## PR 2 — Tokens + hierarchy

Update:

- accessible color tokens;
- surface levels;
- typography scale;
- spacing;
- border usage;
- sidebar hierarchy;
- shared UI primitives.

Also update:

```text
DESIGN.md
ui-review
```

in the same PR.

Validate color contrast automatically.

---

## PR 3 — Disclosure

Pages:

```text
Settings
Resumes
Compare
```

Goals:

- shorten permanently visible helper text;
- collapse inactive modes;
- preserve must-stay explanations;
- maintain no-JS behavior.

Metrics:

```text
visible explanatory words
simultaneously visible controls
tab stops
```

---

## PR 4 — Overview + Runs

Overview:

- metric strip;
- clearer Recent Matches hierarchy;
- compact pipeline health.

Runs:

- human-readable summary;
- raw JSON behind `<details>`.

Metrics:

```text
equal-weight cards
visible raw JSON
scan time / visible data hierarchy
```

---

## PR 5 — Job page

Group content around a clearer decision structure.

Suggested information model:

```text
Decide
Analyze
Track
```

or use server-side tabs/routes.

Do not introduce client-side tab state.

---

## Later phases

Only after the core visual system is stable:

```text
search-funnel analytics
server-rendered SVG charts
native/dialog progressive enhancements
dark theme if already planned
other optional interaction improvements
```

---

# 25. Sidebar groups remain valid, but keep them restrained

The previous recommendation to visually group sidebar items is still useful.

Implement grouping without creating heavy section chrome.

Possible structure:

```text
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

If headings increase clutter, use spacing rather than labels for some groups.

Active state:

- emerald accent;
- subtle selected surface;
- visible text/icon distinction;
- not a giant pill.

---

# 26. Preserve the original visual design principles that still fit

The following recommendations from the original specification remain valid and do not require architectural changes:

```text
emerald brand identity
strong typography hierarchy
semantic status colors
fewer unnecessary cards
compact metric presentation
clear table hierarchy
Fit Score as a reusable visual component
reduced helper-text noise
progressive disclosure
restrained shadows
restrained border radius
minimal animation
strong empty/error/loading states
accessible focus treatment
Jobs as the prototype screen
screenshot-based visual review
```

Do not remove these simply because the frontend architecture is server-rendered.

---

# 27. Replace the old technology recommendation with this final rule

Use:

```text
Hono JSX
+
semantic HTML
+
Inter
+
central CSS/design tokens
+
small server-side UI primitives
+
native browser controls
+
server-rendered SVG for future charts
+
minimal vanilla JS only as progressive enhancement
```

Do not add another frontend framework to achieve a more polished visual design.

The redesign must prove that the existing server-rendered architecture can deliver a premium UI.

---

# 28. Final acceptance rule

Every redesigned page should satisfy all three conditions.

## Visual

- clearer hierarchy;
- more readable;
- less visually flat;
- unmistakably ApplyPack;
- emerald identity preserved.

## UX

- fewer unnecessary simultaneous choices;
- important actions remain obvious;
- required explanations remain available;
- works without JavaScript.

## Engineering

- no new client framework;
- no unnecessary third-party runtime dependency;
- no external-host requirement;
- no regression of server-side rendering behavior;
- existing self-contained test remains valid;
- measurable complexity does not regress without justification.

---

# Final North Star

> **Make ApplyPack look and feel like a premium modern data workspace while preserving its server-rendered, self-contained, no-JS-first architecture.**

The redesign should improve visual quality by better hierarchy, typography, spacing, disclosure, server-side components and native browser primitives — not by replacing the architecture with a client framework.
