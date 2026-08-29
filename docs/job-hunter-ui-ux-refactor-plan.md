# Job Hunter UI/UX Refactor — Settings + Project-wide Design Audit

## 1. Goal

Refactor the Job Hunter interface so it feels like a focused, production-quality internal SaaS tool:

- easy to scan;
- obvious where each setting belongs;
- low cognitive load;
- compact without feeling cramped;
- consistent across every page;
- readable on laptop and wide desktop screens;
- responsive on smaller screens;
- accessible with keyboard and screen readers;
- no unnecessary explanatory copy;
- no visual noise;
- no duplicated configuration in multiple places;
- no one-off component styling that slowly drifts from the rest of the product.

The biggest issue visible in the screenshots is **not the color palette**. The current light theme is already a workable foundation. The main problems are:

1. information architecture;
2. visual hierarchy;
3. page density;
4. duplicated responsibilities;
5. inconsistent interaction patterns;
6. too much helper text shown all the time;
7. configuration/actions that are placed together even though they have very different risk and frequency.

The redesign should first fix structure, then typography/spacing/components, then polish.

---

# 2. What is currently working

Do not throw the current UI away. Several foundations are already good:

- the left application sidebar is simple and understandable;
- the light neutral background works well for an admin/productivity tool;
- the green brand/accent color is restrained;
- cards have simple borders and do not rely on excessive shadows;
- destructive actions already use red;
- status badges such as `Enabled`, `Paused`, and `default` are useful;
- most controls use familiar native/SaaS patterns;
- the interface is already visually calmer than a dashboard overloaded with charts.

The redesign should preserve this restrained character.

Target visual direction:

> **Quiet, high-density SaaS admin UI.**
> Think clarity and hierarchy before decoration.  
> Use whitespace deliberately, not excessively.  
> Make the interface feel engineered rather than “designed for a Dribbble screenshot.”

---

# 3. Main problems found on the Settings page

## 3.1 Settings is acting as a dumping ground

The current page contains:

- job fetching;
- active matching profile;
- technologies;
- role types;
- excluded titles;
- classifier notes;
- seniority;
- remote/location configuration;
- salary;
- fit score;
- priority rules;
- classifier mode;
- job sources;
- resumes;
- discovery;
- application tracking;
- stale digest;
- Telegram alerts;
- Telegram destinations.

These are several different products/workflows placed on one long page.

The result is a page that technically contains everything but makes the user work too hard to understand:

- where they are;
- what they are changing;
- whether a setting is global or profile-specific;
- whether a setting affects fetching, classification, applications, or notifications;
- whether an action is immediate, expensive, destructive, or just a normal save.

### Recommendation

**Do not solve this only by adding more cards.**

The first fix must be information architecture.

---

# 4. Recommended information architecture

## Preferred approach: domain ownership

The main navigation already contains:

- Jobs
- Applications
- Resumes
- Target
- Companies
- Discovery
- Runs
- Settings

That means Settings should **not duplicate entire workflows that already have their own page**.

### Recommended ownership

| Current setting/workflow | Recommended home |
|---|---|
| Pipeline pause/resume | Settings → General |
| Classifier mode | Settings → General or Advanced |
| Matching profile | Target |
| Tech stack / role types | Target |
| Seniority | Target |
| Location / remote rules | Target |
| Salary / minimum fit | Target |
| Priority rules | Target → Advanced matching |
| Re-classify all jobs | Target → Advanced actions OR Runs |
| Job sources | Discovery |
| Auto-discover | Discovery |
| HN “Who is hiring” parser | Discovery |
| Resume upload/default resume | Resumes |
| Application tracking | Applications |
| Stale application digest | Notifications or Applications |
| Telegram alerts | Settings → Notifications |
| Telegram targets | Settings → Notifications |
| Runtime/system metadata | Settings → Advanced / About |

### Result

The Settings page becomes a small control center instead of a 6-screen form.

Suggested Settings sub-navigation:

```text
Settings
├── General
│   ├── Job fetching
│   └── Classification mode
├── Notifications
│   ├── Telegram alerts
│   ├── Telegram destinations
│   └── Stale application digest
└── Advanced
    ├── Runtime / persistence information
    ├── Maintenance actions
    └── Expensive bulk operations
```

This is the strongest recommendation.

---

## Fallback approach: settings sub-navigation

If architecture constraints require all configuration to remain under `/settings`, do not keep a single scrolling document.

Use a settings-local navigation:

```text
Settings
├── General
├── Matching
├── Sources & Discovery
├── Resumes
├── Applications
├── Notifications
└── Advanced
```

Possible route structure:

```text
/settings/general
/settings/matching
/settings/sources
/settings/resumes
/settings/applications
/settings/notifications
/settings/advanced
```

Avoid a tab bar with 7 tiny tabs across the top. Prefer:

- a compact secondary vertical navigation on desktop; or
- a responsive select/dropdown on mobile.

---

# 5. Proposed Settings landing page

The `/settings` root should become a simple overview instead of immediately displaying every control.

Example structure:

```text
Settings
Manage global behavior and integrations.

┌─────────────────────────────────────────────────────────────┐
│ Job fetching                                  Paused         │
│ New jobs are not being fetched.                              │
│ Last run 11:02 AM · Next run after resume         [Resume]  │
└─────────────────────────────────────────────────────────────┘

General
Pipeline, classifier mode
[Open]

Notifications
Telegram destinations and application reminders
[Open]

Advanced
Maintenance and bulk operations
[Open]
```

Keep it useful, not decorative.

Do not add analytics cards just to fill space.

---

# 6. Detailed redesign of each current section

## 6.1 Job fetching

### Current problems

- the paused state appears twice: once in the banner and again in the card;
- the banner uses a success-like green treatment even though fetching is paused;
- copy explains internal implementation details (`cron`, `Docker`) that most users do not need during normal operation;
- global operational state is mixed into the same long page as profile editing.

### Recommended design

Use one status card:

```text
Job fetching                              Paused

New jobs and alerts are paused.
Existing jobs, applications and saved data are unaffected.

Last fetch: 11:02 AM
Schedule: Hourly

[Resume fetching]
```

If paused, use a neutral/amber status rather than “success green.”

Technical details such as:

> dashboard, digest, cleanup and discovery probe keep running

should be moved to:

- a tooltip;
- “Technical details” disclosure;
- Advanced page.

### Interaction

Use an explicit button for a global operational action. A switch can be too easy to trigger accidentally.

For pause:

```text
[Pause fetching]
```

Optionally show a small confirmation:

> Pause new job fetching? Existing data will remain available.

No modal is needed unless this has a meaningful downstream cost.

---

# 7. Target / Matching Profile redesign

The current `Active profile` section is the most overloaded part of the page.

It should become its own workspace.

Suggested page:

```text
Target
Define the jobs you want the system to prioritize.

[ PHP/Laravel + JS Full-Stack ]  Active
                                      [Duplicate] [More ▾]

Role & stack
────────────────────────────────────────────────────────

Location
────────────────────────────────────────────────────────

Compensation & fit
────────────────────────────────────────────────────────

Advanced matching
────────────────────────────────────────────────────────
```

## 7.1 Profile selector

Current controls:

- dropdown;
- Activate;
- New profile;
- Re-classify all jobs.

These have different importance and risk but are displayed as peers.

### Better

```text
Profile
[ PHP/Laravel + JS Full-Stack ▾ ]  [Active]

[+ New profile]   [•••]
```

In the overflow menu:

```text
Duplicate
Rename
Set as active
Delete profile
```

`Re-classify all jobs` must not live beside normal profile navigation.

Move it to **Advanced actions**.

---

## 7.2 Group profile fields by user intent

Do not show one uninterrupted form.

### Group 1 — Role & technologies

```text
Role & technologies

Required technologies
[ PHP ] [ Laravel ] [ Symfony ] [ TypeScript ] [+ Add]

Role types
[ Backend ] [ Full-stack ] [+ Add]

Nice to have
[ PostgreSQL ] [ Redis ] [ React ] [ Docker ] [+ Add]

Exclude by title
[ Junior ] [ Intern ] [ Entry-level ] [+ Add]
```

Rename fields to shorter labels.

Current:

> Tech stack — required (real technologies)

Better:

> **Required technologies**

Current:

> Stack — nice to have (boosts fit score)

Better:

> **Nice to have**

Then put a concise helper text only when it adds necessary behavior information.

---

## 7.3 Avoid synonym spam in chips

The screenshot contains:

```text
full-stack
fullstack
full stack
backend
```

This exposes normalization concerns to the user.

The product should normalize synonyms internally.

The UI should ideally display:

```text
Full-stack
Backend
```

and the matcher should map common variants automatically.

If exact variants are intentionally required, provide an advanced option rather than making the normal UI look like a regex/configuration editor.

---

## 7.4 Seniority

The current checkbox chips are readable, but use a proper multi-select semantic group.

Preferred:

```text
Seniority
[ ] Mid
[x] Senior
[ ] Staff
[ ] Lead
[x] Principal
```

Do not include `Junior` if it is already globally excluded unless there is a clear reason. Avoid contradictory configuration.

If combinations are allowed, keep checkbox behavior.

If only one level should be selected, use radios/segmented control instead.

---

# 8. Location section

Only display controls that are relevant to the selected location modes.

Example:

```text
Location

[x] Remote
[ ] Hybrid
[ ] On-site
```

If Remote is enabled:

```text
Remote regions
[x] United States
[x] Americas
[ ] Europe
[ ] UK
[ ] APAC
[ ] Worldwide
```

If Hybrid or On-site is enabled:

```text
Cities
[ Austin, TX ] [+ Add city]
```

This is **progressive disclosure**: the interface hides configuration that currently has no effect.

Avoid displaying a large empty “On-site cities” field when on-site work is not selected.

---

# 9. Priority rules are too technical

The current rule syntax:

```text
LABEL | techs,csv | regions,csv | MIN_FIT
```

is powerful, but it is not an appropriate default UI for a polished product.

It requires the user to understand:

- separators;
- CSV semantics;
- matching syntax;
- phrase semantics;
- comments;
- minimum-fit override behavior.

This is developer-facing DSL leaking into the UI.

## Recommended rule builder

```text
Priority rules

PHP remote-US
Technologies     PHP
Region           US, Remote, United States, Worldwide
Minimum fit      90

[Edit] [Delete]

[+ Add priority rule]
```

Rule editor:

```text
Rule name
[ PHP remote-US ]

Technologies
[ PHP ] [+ Add]

Regions
[ United States ] [ Worldwide ] [+ Add]

Minimum fit
[ 90 ]

[Save rule]
```

Optionally provide:

```text
Advanced: Edit raw rules
```

inside a disclosure for power users.

This preserves power without forcing syntax knowledge.

---

# 10. Compensation and fit score

Current row is conceptually good but should be clearer.

Recommended:

```text
Minimum salary
[$ 110,000] / year

Minimum fit
[60] / 100

Notification destination
[All active Telegram targets ▾]
```

Consider formatting numeric salary input while preserving a numeric stored value.

Explain `Minimum fit` via tooltip:

> Jobs below this score are stored but not alerted.

If that is the actual behavior, state it exactly. Do not write generic helper copy.

---

# 11. Saving behavior

The page currently has:

- Save mode
- Save sources
- Save profile
- Save & re-classify
- Enable/Disable
- Resume
- Run now
- Upload & scan

This produces inconsistent mental models.

## Establish project-wide rules

### Immediate actions

Use immediate persistence for simple toggles:

- enable/disable a feature;
- select a source;
- turn notifications on/off.

Show a small toast:

> Job source enabled.

Do not require a second `Save sources` button unless several settings are intentionally edited as one transaction.

### Explicit save

Use Save only for forms with multiple related fields:

- matching profile;
- Telegram destination;
- advanced rule;
- resume metadata.

### Dirty state

When a form has unsaved changes:

```text
Unsaved changes                       [Discard] [Save changes]
```

Use a sticky bottom action bar inside the content area for long forms.

Only show it while dirty.

### Bulk/expensive actions

Separate from normal save actions:

```text
Advanced actions
Re-classify existing jobs using this profile.
This can trigger AI processing for 428 stored jobs.

[Re-classify jobs]
```

Require confirmation.

If cost can be estimated, show it before running.

Never visually present `Save` and `Re-classify everything` as equivalent actions.

---

# 12. Classifier mode

The radio-card pattern is good.

Improve the wording.

Current labels such as:

> Two stage (cheaper)

are understandable but can be more decision-oriented.

Example:

```text
Classification mode

● Full classification
  Best accuracy. Every fetched job runs through the full classifier.

○ Prefilter + classification
  Lower AI usage. Obviously irrelevant jobs are rejected first.
  Typical AI usage reduction: ~30–40%.
```

If the 30–40% figure is not measured reliably, do not display it as a confident number.

Add a short recommendation marker only if the product actually has a recommended default:

```text
Recommended
```

Avoid a separate `Save mode` button if switching modes can safely persist immediately. If not, keep explicit Save but apply the same form-save pattern used everywhere else.

---

# 13. Job sources

The current checkbox-chip wall works at small scale but becomes harder to scan as sources grow.

Also, raw identifiers such as:

```text
LARAJOBS_RSS
HN_HIRING
WEWORKREMOTELY
GOLANGPROJECTS
```

look like internal enum names.

## Better source list

Display product names:

```text
Greenhouse                Enabled
Lever                     Enabled
Ashby                     Enabled
Laravel Jobs              Enabled
Remote OK                 Enabled
Hacker News — Hiring      Enabled
We Work Remotely          Enabled
GoLangProjects            Enabled
```

Keep internal keys in code only.

For 10+ sources, use a compact 2-column list/card:

```text
Search sources...
[Enabled only ▾]

Greenhouse                         [on]
Lever                              [on]
Ashby                              [on]
Remote OK                          [on]
...
```

Optional useful metadata:

- source type: ATS / board / aggregator;
- last successful fetch;
- error status.

Do not show metadata that the user cannot act on.

Move this entire configuration to `Discovery`.

---

# 14. Resumes

The sidebar already has a dedicated `Resumes` page.

The Settings page should not duplicate the upload workflow.

Recommended Settings/Target summary at most:

```text
Default resume

Senior Backend PHP
Nazar Boyko Senior Software Engineer Resume

[Manage resumes]
```

Actual upload, scan, rename, default-selection and resume analysis belong on the Resumes page.

This is one of the easiest ways to shorten Settings immediately.

---

# 15. Discovery

The screenshot contains:

- Auto-discover;
- HN “Who is hiring” parser;
- Run now.

These controls belong on the existing `Discovery` page.

Recommended Discovery page sections:

```text
Discovery

Sources
Source availability and fetch status.

Automatic discovery
[on] Discover company job boards from supported sources

Hacker News
[on] Parse “Who is hiring?” threads
Last run: ...
Next scheduled run: ...
[Run now]

Discovered companies
...
```

`Run now` is an operational action and should sit near run metadata, not at the far right of a generic setting row.

---

# 16. Application tracking

Because the product already has an `Applications` page, global tracking configuration should be located there or be represented as a compact setting on that page.

Example:

```text
Application tracking                         [on]

Track status and follow-up timing for jobs you apply to.
```

The stale digest is a notification behavior, so it can live under:

```text
Notifications → Application reminders
```

This produces clearer ownership:

- Applications owns workflow.
- Notifications owns delivery.

---

# 17. Telegram / Notifications redesign

The current layout is functional but too configuration-table-like.

## Recommended structure

```text
Notifications

Telegram alerts                                      [on]
Send matching-job alerts to configured destinations.

Destinations

My phone                              Active
Chat ending in …7623
Last tested 3 hours ago
[Test] [Edit] [•••]

[+ Add destination]
```

### Add destination

Use a modal or dedicated form only when adding/editing:

```text
Add Telegram destination

Name
[ My phone ]

Bot token
[ ••••••••••••••••••• ]

Chat ID
[ -100... ]

[Test connection]

[Cancel] [Save destination]
```

Testing before save is useful, but it should not feel like implementation documentation.

Current text:

> The bot token is validated (getMe + sendMessage) before saving.

Better normal UI copy:

> We’ll test the connection before saving.

Put API method names in technical logs, not primary UI.

### Secret handling

- Never display the full bot token after saving.
- Prefer only the last 4 characters if identification is needed.
- Add explicit `Replace token` rather than exposing/editing the old value.
- Ensure secrets never appear in frontend logs, error messages, analytics, DOM snapshots, or screenshots.
- If a target is loaded from `.env`, make its ownership explicit:
  - `Managed by environment`
  - edit/delete controls should reflect what the UI can actually change.

---

# 18. Page width and layout

A major visual issue in the screenshots is inefficient use of horizontal space.

On a ~1790 px viewport:

- the left sidebar is relatively narrow;
- the settings content occupies only part of the available page;
- a large empty area remains on the right;
- the current left-description/right-card layout increases eye travel.

## Recommended desktop shell

```text
Sidebar:          224–240 px
Main max width:   1180–1320 px
Main padding:     32–48 px
Form readable max width: ~760–840 px
```

Do **not** simply stretch every input to 1400 px.

Use the extra width for better grouping.

Example:

```text
┌─────────────────────────────────────────────────────────────┐
│ Section title                                               │
│ Brief description                                           │
│                                                             │
│ [form/content 760px]       [optional compact context 260px] │
└─────────────────────────────────────────────────────────────┘
```

Or use a centered single column for configuration pages:

```text
main content max-width: 1040–1120 px
```

The exact dimensions should be derived from the existing code and tested visually, not hard-coded blindly.

---

# 19. Remove the “label column + card column” pattern where it hurts scanning

The Settings screenshots repeatedly use:

```text
[section title + description]   [large card]
```

This pattern can work for short preference panels, but on this page it creates:

- unnecessary left/right eye movement;
- long empty areas;
- descriptions far away from the controls they explain;
- awkward responsive behavior.

Prefer:

```text
Section title
One concise sentence.

[card / controls]
```

or:

```text
Section title                              status/action
Short description
────────────────────────────────────────────────────────
controls
```

The interface will become noticeably easier to scan.

---

# 20. Typography system

Create explicit typography tokens/classes instead of choosing sizes independently per component.

Suggested hierarchy:

```text
Page title            24px / 32px, semibold
Section title         16px / 24px, semibold
Card/item title       14px / 20px, medium/semibold
Body                  14px / 20px
Helper                13px / 18px
Meta/status           12px / 16px
```

Avoid using small gray text for important behavioral information.

Text colors should have clear semantic roles:

```text
text-primary
text-secondary
text-muted
text-disabled
text-danger
text-warning
text-success
```

Do not create many near-identical gray values.

### Readability rule

If the user needs the sentence to decide what a control does, it is not “muted metadata.” It must have sufficient contrast.

---

# 21. Copywriting: aggressively remove UI “water”

Every line should answer one of these:

1. What is this?
2. Why would I change it?
3. What happens if I change it?
4. What do I need to enter?
5. Is there a risk/cost?

If a sentence answers none of those, remove it.

## Examples

### Current style

> What a matching job looks like: stack, role types, regions, salary floor. The classifier scores every job against this.

### Better

> Define which jobs should be prioritized.

### Current style

> The funnel board and the nudge that keeps it honest.

### Better

> Track applications and follow-ups.

### Current style

> Telegram bots and chats that receive job alerts.

### Better

> Choose where job alerts are sent.

### Current style

> Finding new company boards automatically from HN threads.

### Better

> Discover company job boards automatically.

Avoid product copy that sounds clever when the user is trying to configure a system.

---

# 22. Forms

Apply one consistent field anatomy:

```text
Label
Optional short helper
[Control]
Validation / error
```

or:

```text
Label
[Control]
Helper/error
```

Pick one convention and use it everywhere.

## Rules

- labels must always remain visible;
- placeholders are examples, not labels;
- required/optional behavior should be consistent;
- validation belongs beside the field;
- avoid huge textareas for small structured values;
- auto-grow textareas when appropriate;
- inputs should have consistent heights;
- field groups should use consistent vertical rhythm;
- do not put several unrelated fields into one row only to save vertical space.

---

# 23. Buttons

Create a strict hierarchy.

## Primary

Use for the main commit/action on a screen:

```text
Save changes
Resume fetching
Add destination
Upload resume
```

## Secondary

```text
Cancel
Test
Duplicate
Run now
```

## Tertiary / text

```text
Manage resumes
Learn more
Advanced
```

## Destructive

```text
Delete
Remove
Disable permanently
```

Do not use a special purple button for arbitrary operations unless purple has a defined semantic meaning in the design system.

The screenshots currently make `Re-classify all jobs` visually special but do not explain why. Either:

- make it a normal secondary/advanced action; or
- define a real semantic “AI/processing” accent used consistently throughout the product.

Prefer the former.

---

# 24. Toggles versus buttons

Use **switches** for persistent boolean preferences:

```text
Telegram alerts          [on]
Auto-discover            [on]
Application tracking     [on]
```

Use **buttons** for commands:

```text
Run now
Test connection
Re-classify jobs
Resume fetching
```

Avoid representing a persistent boolean with repeated `Enable`/`Disable` action buttons unless there is a strong operational reason.

This distinction immediately makes the UI more understandable.

---

# 25. Status badges

Normalize status badges.

Suggested semantic set:

```text
Active
Paused
Enabled
Disabled
Default
Running
Failed
Needs attention
```

Rules:

- status color cannot be the only information;
- use text + optional icon/dot;
- green = healthy/active/success;
- amber = paused/warning/attention;
- red = failure/destructive;
- neutral gray = disabled/inactive/default metadata.

Avoid a green information banner for a paused system.

---

# 26. Cards, borders and surfaces

The existing low-shadow style is good.

Recommended:

- one app background;
- one primary surface;
- subtle border;
- small or zero shadow for normal cards;
- stronger elevation only for overlays/modals;
- consistent radius;
- no nested cards unless they represent genuinely nested information.

Suggested tokens:

```css
--bg-app: #f8fafc;
--bg-surface: #ffffff;
--bg-subtle: #f1f5f9;

--border-default: #e2e8f0;
--border-strong: #cbd5e1;

--text-primary: #0f172a;
--text-secondary: #475569;
--text-muted: #64748b;

--accent: #059669;
--accent-hover: #047857;

--warning: #d97706;
--danger: #dc2626;
--focus: #2563eb;
```

These are starting points, not a requirement to replace an already coherent palette.

Prefer semantic tokens over literal colors in component code.

---

# 27. Spacing system

Use a small spacing scale.

Example:

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

- field-to-field: 16–20 px;
- related item-to-item: 8–12 px;
- card padding: ~20–24 px;
- section gap: ~32–40 px;
- major page section gap: ~48 px;
- page horizontal padding: 24–48 px depending on viewport.

Do not introduce arbitrary values like `17px`, `27px`, `37px` unless there is a measured reason.

---

# 28. Sidebar improvements

The sidebar is already one of the stronger parts.

Keep:

- icon + label structure;
- restrained background;
- Settings separated near the bottom.

Improve:

- ensure the active item has more than a faint background difference;
- normalize icon optical size;
- ensure all icons align to the same 20/24 px box;
- use one active-state treatment throughout;
- preserve visible focus state;
- collapse to a mobile drawer when necessary.

The footer text:

> Runs locally · data stays in your Postgres

is technically useful but visually disconnected.

Options:

1. move it to Settings → About/Advanced;
2. convert it into a small system indicator;
3. keep it but improve alignment/contrast.

Do not let tiny footer copy become permanent visual noise.

---

# 29. Responsive behavior

Test at minimum:

```text
390 × 844   mobile
768 × 1024  tablet
1280 × 800  small laptop
1440 × 900  desktop
1792 × 1120 wide desktop
1920 × 1080 wide desktop
```

## Desktop

- persistent sidebar;
- main content uses available width;
- avoid extremely long text lines;
- forms remain at a readable width.

## Tablet

- sidebar may collapse;
- settings-local navigation can become top select/menu;
- 2-column rows collapse to one column.

## Mobile

- no horizontal scrolling;
- chips wrap cleanly;
- tables become cards or horizontally scroll only when truly tabular;
- action groups stack intelligently;
- primary action stays easy to reach;
- dialogs fit viewport;
- touch targets at least ~44 px where practical.

---

# 30. Accessibility requirements

Agents must verify, not assume.

Minimum:

- WCAG 2.2 AA-oriented implementation;
- text contrast ≥ 4.5:1 for normal text;
- UI component/focus contrast appropriate for AA;
- full keyboard navigation;
- visible `:focus-visible`;
- form labels programmatically associated;
- field errors connected with `aria-describedby`;
- status changes announced where appropriate;
- switches have accessible names and state;
- dialogs trap and restore focus correctly;
- no interaction only available on hover;
- no color-only status communication;
- table actions reachable by keyboard;
- icon-only buttons have labels/tooltips.

Use automated accessibility testing plus manual keyboard review.

---

# 31. Empty, loading, error and success states

Every significant component should define:

```text
loading
empty
loaded
error
saving
saved
disabled
permission/availability state if relevant
```

Examples:

### Source fetch error

Do not show only a generic red toast.

```text
Remote OK
Fetch failed 12 minutes ago
HTTP 429 · Retry scheduled at 1:00 PM
[Retry now]
```

Only expose technical error details when useful.

### Save

Use a short non-blocking confirmation:

```text
Profile saved
```

Do not use a success modal.

### Long operations

For scanning a resume or re-classifying many jobs:

- show progress or clear running state;
- prevent duplicate submissions;
- allow the user to leave the page if the backend job continues;
- show completion/failure in Runs if appropriate.

---

# 32. Destructive and expensive actions

Create a standard pattern.

Examples:

- delete Telegram destination;
- delete profile;
- re-classify all jobs;
- purge/reset operations if any exist elsewhere.

For destructive actions:

```text
Delete profile?
This removes the profile but does not delete existing jobs.

[Cancel] [Delete profile]
```

For expensive actions:

```text
Re-classify 428 jobs?
This will re-run the classifier using the current profile.

Estimated jobs: 428
Estimated processing: ...
Estimated AI cost: ...  // only if reliably known

[Cancel] [Re-classify]
```

Do not use confirmation dialogs for harmless everyday toggles.

---

# 33. Project-wide design system audit

The agents should not fix pages independently with local CSS patches.

They must first inventory the current design implementation.

## Audit

Find:

- global CSS files;
- reset/base styles;
- CSS variables;
- Tailwind/theme config if present;
- component library if present;
- shared layout components;
- button variants;
- input components;
- select components;
- cards;
- badges;
- tables;
- modals;
- dropdowns;
- toast system;
- navigation components;
- typography helpers;
- spacing utilities;
- inline styles;
- duplicated class strings;
- page-specific CSS overrides;
- hard-coded colors;
- hard-coded widths/heights;
- `!important`;
- uncontrolled z-index values;
- custom focus removal;
- inconsistent border radii;
- inconsistent shadows.

Create a report before large-scale implementation.

---

# 34. Build reusable primitives before page polishing

A project-wide refactor should establish shared primitives such as:

```text
AppShell
Sidebar
PageHeader
PageSection
SettingsNav

Card
Surface
Divider

Button
IconButton
ButtonGroup

Badge
StatusBadge

Input
Textarea
Select
Checkbox
Radio
Switch
TagInput

Field
FieldGroup
FormSection

Alert
Toast
Dialog
DropdownMenu

DataTable
EmptyState
Skeleton

StickySaveBar
DangerZone
```

Names can change to match the project conventions.

The principle is more important than the exact component list.

Do not build an abstract component for every `<div>`. Extract primitives only when they create consistent behavior or styling.

---

# 35. Component states must be designed centrally

For every primitive, define:

```text
default
hover
active
focus-visible
disabled
loading
error
success where relevant
```

For inputs additionally:

```text
empty
filled
placeholder
read-only
invalid
```

For buttons:

```text
primary
secondary
tertiary
danger
```

Avoid page-local button colors.

---

# 36. Tables

The Telegram target table reveals a broader need for table standards.

Use:

- consistent header typography;
- sensible row height;
- aligned actions;
- compact status badges;
- no excessive borders;
- sticky header only when the table is actually long;
- right-align numbers;
- avoid centered body text unless semantically useful.

On mobile:

- convert simple records to stacked cards;
- or provide a deliberate horizontal scroll area with visible affordance.

Do not let the entire page overflow horizontally.

---

# 37. Content width / readable line length

Helper copy currently stretches across broad card widths.

For prose, target approximately 60–80 characters per line where practical.

The form can be wider than the explanatory text.

Example:

```css
.settings-description {
  max-width: 68ch;
}
```

Do not apply this blindly to tables or structured forms.

---

# 38. Visual hierarchy test

Each screen should pass the “5-second scan” test.

Within five seconds the user should be able to identify:

1. page title;
2. primary purpose;
3. current state;
4. main action;
5. section boundaries;
6. whether there are unsaved changes or problems.

If everything has the same font weight, border, color and visual prominence, hierarchy has failed.

---

# 39. Project-wide copy audit

Search the project for:

- long helper paragraphs;
- implementation details in UI;
- inconsistent capitalization;
- labels ending with punctuation;
- internal enum names;
- internal database/config terminology;
- jargon that can be replaced with user language;
- playful copy that reduces clarity;
- duplicate descriptions;
- vague buttons such as `Submit`, `OK`, `Action`.

Button labels should describe the result:

```text
Save profile
Add destination
Run discovery
Retry fetch
Delete profile
```

---

# 40. Naming consistency

Choose one vocabulary and use it everywhere.

Examples to resolve:

```text
profile vs target
fit vs match
job source vs source family
tracking vs application tracking
alert vs notification
destination vs Telegram target
classifier vs matching
```

Create a small glossary in the repository.

Example:

```text
Target = the user’s desired job criteria
Profile = a saved Target configuration
Fit score = classifier score from 0–100
Source = system that provides jobs
Destination = notification endpoint
```

The exact terms can differ, but one concept must not have three names.

---

# 41. Icons

Use icons only when they improve scanning.

Rules:

- one icon library;
- consistent stroke width;
- consistent optical size;
- no decorative icons beside every heading;
- icons should never replace important text labels;
- destructive icons should not be the only warning signal.

---

# 42. Motion

Keep motion minimal.

Good:

- 120–180 ms hover/focus transitions;
- small dropdown/dialog transitions;
- subtle loading spinner;
- skeletons for content loading.

Avoid:

- card lift animations;
- animated gradients;
- bouncing icons;
- excessive motion on every toggle.

This is a productivity application.

---

# 43. Dark mode readiness

Even if only the light theme is implemented now, styles should use semantic tokens so a dark theme does not require rewriting every component later.

Do not hard-code:

```css
background: white;
color: #111;
border: #ddd;
```

throughout components.

Use tokens:

```css
background: var(--surface);
color: var(--text-primary);
border-color: var(--border-default);
```

Do not spend implementation time building dark mode unless it is part of the requested scope.

---

# 44. Recommended Settings page wireframe

## Settings → General

```text
Settings
General

Job fetching
─────────────────────────────────────────────────────────────
Status                                            Paused
New jobs and alerts are currently paused.
Last fetch 11:02 AM · Schedule hourly               [Resume]

Classification
─────────────────────────────────────────────────────────────
● Full classification
  Best accuracy. Every job uses the full classifier.

○ Prefilter + classification
  Lower AI usage. Clearly irrelevant jobs are filtered first.
```

## Settings → Notifications

```text
Settings
Notifications

Telegram alerts                                      [on]
Send matching-job alerts to configured destinations.

Destinations
─────────────────────────────────────────────────────────────
My phone                                          Active
Chat …7623 · Last tested 3h ago
[Test] [Edit] [•••]

[+ Add destination]

Application reminders
─────────────────────────────────────────────────────────────
Stale application digest                             [on]
Remind me after 14 days without recruiter contact.
```

## Settings → Advanced

```text
Settings
Advanced

System
─────────────────────────────────────────────────────────────
Storage          PostgreSQL
Scheduler        Running
Last background run  11:02 AM
[Open Runs]

Maintenance
─────────────────────────────────────────────────────────────
Re-classify existing jobs
Run matching again using the active Target profile.
[Re-classify jobs]
```

---

# 45. Recommended Target page wireframe

```text
Target
Define the jobs you want Job Hunter to prioritize.

Profile
[ PHP/Laravel + JS Full-Stack ▾ ]  Active
[+ New profile]  [•••]

Role & technologies
─────────────────────────────────────────────────────────────
Required technologies
[PHP] [Laravel] [Symfony] [TypeScript] [+ Add]

Role types
[Backend] [Full-stack] [+ Add]

Nice to have
[PostgreSQL] [Redis] [React] [Vue] [Docker] [+ Add]

Exclude titles
[Junior] [Intern] [Entry-level] [+ Add]


Seniority
─────────────────────────────────────────────────────────────
[ ] Mid   [x] Senior   [ ] Staff   [ ] Lead   [x] Principal


Location
─────────────────────────────────────────────────────────────
[x] Remote    [ ] Hybrid    [ ] On-site

Remote regions
[x] United States
[x] Americas
[ ] Europe
[ ] UK
[ ] APAC
[ ] Worldwide


Compensation & fit
─────────────────────────────────────────────────────────────
Minimum salary               Minimum fit
[$110,000 / year]            [60 / 100]


Advanced matching
─────────────────────────────────────────────────────────────
Priority rules                                         [2]
[Manage rules]

Classifier notes
[optional collapsed field]


              Unsaved changes    [Discard] [Save changes]
```

---

# 46. What NOT to do

Do not:

- simply increase font sizes everywhere;
- add gradients and shadows to “modernize” the UI;
- put every section into an accordion;
- use modals for normal editing;
- redesign each page separately;
- rewrite the whole frontend framework without a technical need;
- add a large component library just to fix spacing;
- hide critical behavior behind tooltips;
- convert all actions to icon buttons;
- stretch forms to the full width of a 1920 px monitor;
- keep raw backend enum names in the UI;
- preserve every existing helper sentence;
- add tabs inside tabs inside cards;
- use color as the only status indicator;
- introduce a different interaction pattern on each page;
- change business behavior silently during a style refactor.

---

# 47. Agent workflow

Use multiple agents, but do not let them independently modify the same design foundations.

## Phase 1 — Audit agent

Read-only first.

Tasks:

1. inspect repository structure;
2. identify frontend stack;
3. list all routes/screens;
4. identify shared layout/components;
5. identify styling architecture;
6. locate design tokens;
7. find duplicate component implementations;
8. find hard-coded colors/sizing;
9. find responsive issues;
10. find accessibility issues;
11. find inconsistent copy;
12. inspect current test setup;
13. capture screenshots of every major page.

Deliver:

```text
docs/ui-audit.md
```

No broad style changes yet.

---

## Phase 2 — Design-system agent

Using the audit:

1. define typography;
2. define spacing scale;
3. define semantic color tokens;
4. define border/radius/shadow tokens;
5. define standard page widths;
6. define button variants;
7. define form controls;
8. define status badges;
9. define section/card patterns;
10. define responsive breakpoints;
11. define focus/accessibility states.

Deliver:

```text
docs/ui-design-system.md
```

and implement the minimal shared primitives needed to support the refactor.

Do not polish individual pages before primitives are stable.

---

## Phase 3 — Information-architecture agent

Focus on navigation and Settings.

Tasks:

1. move duplicated workflows to their owning pages where appropriate;
2. split `/settings` into General / Notifications / Advanced;
3. move matching configuration to Target;
4. move source configuration to Discovery;
5. move resume upload to Resumes;
6. place application-specific preferences near Applications;
7. preserve existing backend behavior and stored data;
8. preserve backward-compatible redirects where useful.

Deliver:

```text
docs/ui-information-architecture.md
```

---

## Phase 4 — Page implementation agents

After shared primitives and IA are agreed, pages can be split among agents.

Example parallelization:

```text
Agent A: Overview + Jobs
Agent B: Applications + Resumes
Agent C: Target
Agent D: Companies + Discovery
Agent E: Runs + Settings
```

Rules:

- agents must use shared primitives/tokens;
- no new local design language;
- no duplicated button/input/card implementations;
- no broad global CSS changes without coordination;
- preserve functionality;
- add/update tests for changed behavior.

---

## Phase 5 — UI review agent

Review all pages together.

Look for cross-page inconsistency:

- page title spacing;
- content width;
- card padding;
- button sizes;
- icon sizes;
- helper text;
- table density;
- empty states;
- status colors;
- field spacing;
- modal width;
- toast behavior;
- mobile layout;
- long labels;
- loading states.

This agent should mostly review and file specific fixes, not redesign everything again.

---

## Phase 6 — QA agent

Run automated and visual checks.

Required:

- typecheck;
- lint;
- unit tests;
- integration tests;
- Playwright/e2e tests if available;
- accessibility checks;
- visual screenshots;
- responsive matrix;
- keyboard-only walkthrough;
- form persistence verification;
- navigation verification;
- destructive-action confirmation tests.

---

# 48. Visual regression strategy

Before modifying styles:

1. capture baseline screenshots for all main routes;
2. use deterministic seed/test data where possible;
3. freeze animation in screenshots;
4. use consistent viewport sizes;
5. capture light-theme pages;
6. compare after every large phase.

Suggested routes:

```text
/
overview
/jobs
/jobs/:id
/applications
/resumes
/target
/companies
/discovery
/runs
/settings
/settings/general
/settings/notifications
/settings/advanced
```

Use actual project routes.

Do not invent routes purely to satisfy this document.

---

# 49. Recommended Playwright visual checks

Create or extend visual tests around:

```text
1440 × 900
1792 × 1120
390 × 844
```

For each major page verify:

- no horizontal overflow;
- sidebar state;
- page title alignment;
- content max-width;
- controls not clipped;
- chips wrap;
- buttons do not collide;
- dialogs fit;
- tables remain usable;
- sticky save bar does not hide fields.

Do not require pixel-perfect equality across OS font rendering if the current CI environment makes it unstable. Use sensible snapshot thresholds.

---

# 50. Accessibility test tooling

If the stack supports it, consider:

- `@axe-core/playwright`;
- eslint accessibility rules appropriate to the framework;
- browser accessibility tree inspection;
- manual keyboard testing.

Automated accessibility checks are necessary but not sufficient.

---

# 51. Performance and CSS cleanup

While refactoring:

- avoid unnecessary JS for pure styling;
- avoid layout thrashing;
- avoid loading icon/font packages for one component;
- remove dead CSS;
- remove unused variants;
- avoid deeply nested selectors;
- avoid excessive specificity;
- eliminate duplicated style definitions;
- avoid expensive blur/backdrop effects in the main application shell.

Do not sacrifice maintainability for micro-optimizations.

---

# 52. Definition of Done — Settings

The Settings refactor is complete only when:

- [ ] Settings is no longer one giant page.
- [ ] Every configuration item has a clear domain owner.
- [ ] Resume upload is not duplicated in Settings.
- [ ] Discovery workflow is not duplicated in Settings.
- [ ] Matching profile editing has a dedicated structured page/section.
- [ ] Priority rules have a human-friendly editing experience or an explicit advanced mode.
- [ ] Expensive bulk actions are separated from normal save actions.
- [ ] Persistent booleans use a consistent toggle pattern.
- [ ] Saving behavior is consistent.
- [ ] Unsaved changes are obvious.
- [ ] Paused/warning states use correct semantics.
- [ ] Helper copy is concise.
- [ ] Internal implementation details are hidden unless needed.
- [ ] Wide desktop space is used more effectively.
- [ ] Mobile layout has no horizontal overflow.
- [ ] Keyboard navigation works.
- [ ] Accessibility checks pass.
- [ ] Existing functionality and data are preserved.

---

# 53. Definition of Done — Entire project

- [ ] All major routes use the same AppShell and page spacing.
- [ ] Typography hierarchy is consistent.
- [ ] Shared button component is used everywhere possible.
- [ ] Shared form controls are used everywhere possible.
- [ ] Status badge semantics are consistent.
- [ ] Colors use semantic tokens.
- [ ] No obvious one-off hard-coded colors remain.
- [ ] Border radius/shadow patterns are normalized.
- [ ] Tables share common density and header styling.
- [ ] Empty/loading/error states are designed.
- [ ] Destructive actions use one confirmation pattern.
- [ ] Copy terminology is consistent.
- [ ] Internal enum/config names are not exposed unnecessarily.
- [ ] Responsive behavior is verified at target viewports.
- [ ] Visual regression screenshots exist for major pages.
- [ ] Lint/typecheck/tests pass.
- [ ] Accessibility automated checks pass.
- [ ] Manual keyboard review is complete.
- [ ] No business logic was accidentally changed by the visual refactor.
- [ ] Dead CSS/components introduced by the old design are removed after verification.

---

# 54. Priority order

Do the work in this order.

## P0 — structure

1. audit project;
2. decide ownership of each settings section;
3. split Settings;
4. move duplicate workflows;
5. establish page/container layout.

## P1 — shared visual system

1. typography;
2. spacing;
3. buttons;
4. inputs;
5. switches;
6. cards;
7. badges;
8. forms;
9. dialogs;
10. tables.

## P2 — readability

1. shorten copy;
2. normalize names;
3. improve field grouping;
4. hide advanced controls by default where appropriate;
5. improve error/status messages.

## P3 — responsive/accessibility

1. mobile/tablet;
2. keyboard;
3. focus;
4. contrast;
5. screen reader semantics.

## P4 — polish

1. empty states;
2. loading skeletons;
3. subtle transitions;
4. final visual consistency;
5. dead code cleanup.

Do not start with P4.

---

# 55. Master prompt for Claude Code / multi-agent implementation

Copy the prompt below into the orchestrating agent.

---

## Prompt

You are the lead frontend/UI refactoring engineer for this repository.

Your goal is to make the entire Job Hunter application significantly more readable, consistent, compact, accessible and pleasant to use **without changing business behavior unnecessarily**.

This is not a cosmetic “make it prettier” task.

The priority is:

1. information architecture;
2. visual hierarchy;
3. readability;
4. component consistency;
5. interaction consistency;
6. responsive behavior;
7. accessibility;
8. visual polish.

### Critical requirements

- Inspect the repository before changing code.
- Detect the existing frontend stack and styling architecture.
- Reuse the current framework and libraries unless there is a strong technical reason not to.
- Do not replace the frontend framework.
- Do not introduce a major UI library simply to make the page look better.
- Preserve backend behavior and stored data.
- Do not silently change classifier/fetching/application logic.
- Do not redesign each page with independent CSS.
- Build/fix shared primitives and tokens first.
- Avoid unnecessary helper copy.
- Hide implementation details that a normal user does not need.
- Keep the interface restrained: no gratuitous gradients, shadows, glass effects or animation.
- Maintain a light, professional SaaS-admin visual style.
- Use available width better on wide screens, but do not stretch forms to unreadable widths.
- Ensure the UI works on mobile, laptop and wide desktop.
- Ensure full keyboard usability and accessible focus states.

### Step 1 — Audit before implementation

Create `docs/ui-audit.md`.

Inventory:

- all routes/pages;
- shared layouts;
- navigation;
- typography;
- colors/tokens;
- spacing;
- buttons;
- form controls;
- cards;
- badges;
- tables;
- dialogs;
- toasts;
- empty/loading/error states;
- responsive rules;
- inline styles;
- duplicated CSS/classes;
- hard-coded colors;
- hard-coded widths;
- `!important`;
- accessibility issues;
- inconsistent wording;
- exposed internal enum/config names;
- current UI/e2e/visual tests.

Capture baseline screenshots for major routes before large changes.

Do not start a broad refactor until this audit exists.

### Step 2 — Establish a small design system

Create `docs/ui-design-system.md`.

Define:

- application background/surface colors;
- semantic text colors;
- accent/success/warning/danger/focus colors;
- typography hierarchy;
- spacing scale;
- radius;
- borders;
- shadows;
- content widths;
- breakpoints;
- buttons;
- inputs;
- select;
- checkbox;
- radio;
- switch;
- tag input;
- cards;
- badges;
- alert;
- table;
- dialog;
- dropdown;
- toast;
- form section;
- sticky unsaved-changes bar.

Use semantic tokens/variables instead of scattering literal colors throughout components.

Implement or normalize shared primitives.

### Step 3 — Fix Settings information architecture

The current Settings page is too long and mixes unrelated domains.

Preferred architecture:

- Settings → General
  - job fetching/pipeline;
  - classifier mode.
- Settings → Notifications
  - Telegram alerts;
  - Telegram destinations;
  - stale application reminders.
- Settings → Advanced
  - runtime/system information;
  - maintenance;
  - expensive bulk actions.

Move domain workflows to their existing pages:

- matching profile → Target;
- source configuration + discovery toggles → Discovery;
- resume upload/default resume management → Resumes;
- application tracking preferences → Applications where appropriate.

If moving routes would create unacceptable architectural risk, use a Settings secondary navigation instead, but do not keep one giant scrolling page.

### Step 4 — Refactor Target

Break matching configuration into clear groups:

1. Role & technologies
2. Seniority
3. Location
4. Compensation & fit
5. Advanced matching

Shorten labels:

- `Tech stack — required (real technologies)` → `Required technologies`
- `Role types (job category hints)` → `Role types`
- `Stack — nice to have (boosts fit score)` → `Nice to have`
- `Stack — exclude (auto-reject in title)` → `Exclude titles`

Normalize user-facing synonyms internally where possible. Do not force the UI to contain `full-stack`, `fullstack`, and `full stack` as separate normal choices unless this is strictly required by backend behavior.

Use progressive disclosure:

- show remote regions only when Remote is enabled;
- show city selection only when Hybrid/On-site is enabled.

Move `Re-classify all jobs` into an Advanced actions section. Add confirmation and show affected-job count/cost estimate when reliably available.

### Step 5 — Replace raw priority-rule editing

The current pipe/CSV DSL should not be the default UI.

Build a simple rule editor with:

- rule name;
- technologies;
- regions;
- minimum fit;
- edit;
- delete.

If raw syntax must remain supported, place it behind `Advanced: Edit raw rules`.

Preserve backward compatibility with existing stored rules.

### Step 6 — Improve component semantics

Use:

- switches for persistent booleans;
- buttons for commands;
- primary buttons for main commit actions;
- secondary buttons for non-primary commands;
- red destructive buttons only for destructive actions;
- consistent status badges.

Remove arbitrary special button coloring unless it has defined product-wide semantic meaning.

### Step 7 — Standardize save behavior

Simple toggles may autosave if backend behavior supports it.

Multi-field forms should use explicit Save.

For long forms, show a sticky action bar only while dirty:

`Unsaved changes  [Discard] [Save changes]`

Do not mix normal Save and expensive bulk operations as peer actions.

### Step 8 — Reduce copy

Audit every helper paragraph.

Keep text only when it explains:

- purpose;
- effect;
- required input;
- risk/cost.

Move low-value implementation details to tooltips, technical details disclosures or Advanced.

Examples of implementation-level copy that should not dominate normal UI:

- database/environment implementation;
- method names such as `getMe + sendMessage`;
- cron/Docker internals;
- raw enum names.

### Step 9 — Project-wide page consistency

Refactor all pages to use shared:

- AppShell;
- PageHeader;
- section spacing;
- content widths;
- cards;
- buttons;
- form controls;
- status badges;
- tables;
- dialogs;
- toasts.

Do not apply page-specific patches when a shared component is the correct fix.

### Step 10 — Responsive QA

Verify at least:

- 390x844
- 768x1024
- 1280x800
- 1440x900
- 1792x1120
- 1920x1080

Check:

- no horizontal overflow;
- chips wrap correctly;
- forms remain readable;
- action groups do not collide;
- sidebar behavior is correct;
- tables remain usable;
- modals fit;
- sticky controls do not cover content.

### Step 11 — Accessibility QA

Verify:

- keyboard navigation;
- focus-visible states;
- labels;
- accessible switch state;
- errors connected to fields;
- dialog focus trapping/restoration;
- contrast;
- no color-only status;
- icon-only button labels;
- no hover-only functionality.

Use automated accessibility tests if the project stack supports them, plus manual keyboard testing.

### Step 12 — Tests

Run all existing:

- lint;
- typecheck;
- unit tests;
- integration tests;
- e2e tests.

Add/update Playwright coverage for critical UI flows and visual screenshots.

At minimum test:

- pipeline pause/resume;
- profile editing and persistence;
- location conditional fields;
- source toggles;
- resume navigation/upload flow;
- discovery toggles;
- application tracking;
- Telegram destination add/test/delete;
- classifier mode;
- re-classification confirmation;
- responsive navigation.

### Step 13 — Final review

Before finishing, run a dedicated review pass against every page.

Look for:

- inconsistent spacing;
- inconsistent typography;
- duplicate primitives;
- page-local colors;
- misaligned icons;
- weak contrast;
- long helper text;
- internal identifiers exposed to users;
- inconsistent status wording;
- awkward empty space;
- clipped/overflowing content;
- mobile problems;
- missing loading/error states.

Then remove dead CSS/components made obsolete by the refactor.

### Required final output

Provide:

1. summary of changes;
2. architectural decisions;
3. list of shared primitives created/updated;
4. Settings IA before/after;
5. routes changed;
6. screenshots of major redesigned pages;
7. tests executed and results;
8. accessibility checks;
9. known remaining issues;
10. files changed;
11. any behavior that intentionally changed and why.

Do not claim completion while lint/typecheck/tests are failing unless the failure is clearly pre-existing and documented.

---

# 56. Suggested multi-agent orchestration prompt

If the environment supports multiple coding agents, use this structure.

```text
ORCHESTRATOR
    |
    +--> Audit Agent (read-only)
    |
    +--> Design System Agent
    |
    +--> IA / Settings Agent
    |
    +--> Page Agents in parallel
    |       ├── Overview + Jobs
    |       ├── Applications + Resumes
    |       ├── Target
    |       ├── Companies + Discovery
    |       └── Runs + Settings
    |
    +--> Consistency Reviewer
    |
    +--> QA / Playwright / Accessibility Agent
```

Rules for orchestration:

1. Audit must complete first.
2. Design-system decisions must be merged before page agents start broad styling work.
3. IA changes must be agreed before Settings/Target/Discovery implementation.
4. Parallel page agents should edit disjoint page areas where possible.
5. Shared primitives require ownership by one agent at a time.
6. Reviewer should not introduce a second design system.
7. QA runs after integration, not only inside each agent branch.
8. Failed visual/a11y/function tests generate concrete follow-up tasks.
9. Finish only after a final integrated screenshot review.

---

# 57. Short implementation brief

If a smaller prompt is needed:

> Audit the full Job Hunter frontend and refactor it into a consistent, restrained, high-readability SaaS UI. The first priority is information architecture, not decoration. The current Settings page is overloaded: move matching to Target, sources/discovery to Discovery, resumes to Resumes, and application-specific configuration to Applications where appropriate. Keep Settings focused on General, Notifications and Advanced. Establish shared design tokens and reusable buttons/forms/cards/statuses before page-level styling. Normalize typography, spacing, content widths, form behavior, toggles, saving, errors, responsive layouts and accessibility across every route. Replace raw/internal labels and excessive helper copy with concise user-facing language. Build a human-friendly priority-rule editor and move bulk re-classification into Advanced actions. Preserve business logic. Capture before/after screenshots, run lint/typecheck/tests/Playwright/accessibility checks, and perform a final cross-page consistency audit.

---

# 58. Final product principle

Every screen should feel as though it answers:

> **What do I need to see or do here right now?**

Anything that does not help answer that question should be:

- moved;
- collapsed;
- simplified;
- renamed;
- or removed.

The project does not need more visual decoration.  
It needs **stronger structure, consistent components, less text, clearer actions and better information density**.
