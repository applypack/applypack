# Job Hunter — Resume Match / Targeted Resume UX Refactor Plan

## Purpose

This document defines a UX/UI refactor plan for the current targeted-resume / resume-match page.

The goal is to make the page:

- immediately understandable;
- easier to scan;
- easier to use without learning internal scoring logic;
- focused on the user’s main task;
- less visually noisy;
- clearer about what is current, what is historical, what is editable, and what still needs AI analysis;
- safer around unsupported resume claims;
- more consistent with the rest of the Job Hunter product;
- easier to maintain with reusable UI patterns.

This is not primarily a visual-polish task.

The largest issues are:

1. the page is trying to do too many things at once;
2. analysis history is competing with the current result;
3. two scores are shown without a clear mental model;
4. actions do not have a clear hierarchy;
5. the current tab structure is organized around document views rather than user goals;
6. too many matched keywords are highlighted by default;
7. recommendations are informative but not actionable enough;
8. raw/debug-like scoring details are exposed too early;
9. resume content is rendered like a text dump rather than a structured document;
10. the page currently appears to belong to `Target`, although conceptually it belongs to a specific job.

---

# 1. Core product question

The page should answer this question:

> **How well does my resume match this specific job, what prevents a stronger match, and what should I change next?**

Everything on the page should support that goal.

The page should not behave as:

- analysis history;
- version browser;
- resume editor;
- raw score debugger;
- keyword auditor;
- AI trace viewer;
- file uploader;
- compare tool;

all at the same visual priority.

Those capabilities can remain, but they need a clear hierarchy.

---

# 2. Fix the page ownership first

## Current problem

The current route and navigation suggest that this page belongs to:

```text
Target
```

However, `Target` in the application is already a global concept describing:

- preferred technologies;
- role types;
- seniority;
- location;
- salary;
- fit thresholds;
- job matching preferences.

The resume-match page is different.

It represents:

```text
specific job
    +
specific resume/version
    +
match analysis
```

That concept belongs to the job workflow.

## Recommended navigation

The sidebar should highlight:

```text
Jobs
```

rather than:

```text
Target
```

Recommended breadcrumb:

```text
Jobs / FullStack Engineer / Resume Match
```

Possible route:

```text
/jobs/:jobId/resume-match
```

or:

```text
/jobs/:jobId/resumes/:resumeId/match
```

Use the existing routing architecture where possible. Do not create unnecessary backend complexity simply to satisfy the route suggestion.

## Recommended page name

Preferred:

```text
Resume Match
```

Alternatives:

```text
Resume Fit
Tailor Resume
```

`Resume Match` is recommended because it is direct and neutral.

---

# 3. Remove analysis history from the top-level header

## Current problem

The current header displays many historical score/version chips, such as:

```text
95 Resume v9
65 Resume v9
68 Resume v8
40 Resume v7
28 Resume v6
91 Resume v5
60 Resume v4
71 Resume v4
```

This creates several UX problems.

### Problem 1 — historical data competes with the current state

The current analysis should be the dominant information.

Historical runs should not consume the most valuable horizontal space.

### Problem 2 — repeated versions are confusing

A user can see:

```text
Resume v9 — 95
Resume v9 — 65
```

without understanding whether these represent:

- different AI runs;
- different edits;
- different models;
- different job descriptions;
- different scoring algorithms;
- stale analyses.

### Problem 3 — history creates unnecessary cognitive load

The user came to evaluate the current job/resume combination, not to inspect every previous score.

---

# 4. Separate Resume Versions from Analysis Runs

This is an important conceptual distinction.

A **resume version** and an **analysis run** are not the same thing.

Recommended model:

```text
Resume v9
├── Analysis #26 — score 95
└── Analysis #25 — score 65

Resume v8
└── Analysis #24 — score 68

Resume v7
└── Analysis #23 — score 40
```

The UI should reflect this separation.

## Main page

Display only:

```text
Senior Software Engineer Resume · v9
Last analyzed 13h ago

[History]
```

## History drawer / modal / page

Suggested structure:

```text
Analysis history

CURRENT
Aug 29 · 12:31 PM
Resume v9
AI score 95
Current estimate 97
Claude Opus 5

[View]

────────────────────────────

Aug 29 · 11:42 AM
Resume v9
Score 65

[View] [Compare]

────────────────────────────

Aug 28 · 6:15 PM
Resume v8
Score 68

[View] [Compare]
```

Optional actions:

```text
View
Compare
Restore version
```

Do not overload the primary page with this data.

---

# 5. Resolve the 95 vs 97 score ambiguity

## Current problem

The page displays two scores:

```text
95 / 100
AI match
```

and:

```text
97
Score · live estimate
```

This requires the user to know internal scoring behavior.

The natural question is:

> Is my score 95 or 97?

If the logic is:

```text
95 = last completed AI analysis
97 = current local estimate after edits
```

then the interface must explain that explicitly.

---

# 6. Create one primary score state

Recommended representation:

```text
97 / 100
Excellent match

Current estimate after your edits

Last AI analysis: 95
Changes since analysis: +2

[Re-analyze]
```

Alternative:

```text
MATCH SCORE

97
Current estimate

95 → 97
Last AI analysis → current edits
```

Status:

```text
Changes not analyzed yet
```

When re-analysis starts:

```text
Analyzing...
```

When complete:

```text
97
AI analyzed just now
```

At that point, there should no longer be two competing primary scores.

---

# 7. Remove or reduce the donut chart

The current circular score visualization is visually acceptable but low-value.

The numeric score already communicates the result.

Prefer:

```text
97 / 100   Excellent match
███████████████████░
```

or simply:

```text
97
Excellent match
```

Use the saved space for more useful information such as:

```text
Hard requirements    5/5
Primary stack        3/3
Keywords             18/18
```

The page should prioritize information density over decorative score visualization.

---

# 8. Recommended top-of-page structure

Suggested layout:

```text
← FullStack Engineer at Optum

Resume Match
Senior Software Engineer Resume · v9
Last analyzed 13h ago                         [History]
```

Then one summary card:

```text
┌──────────────────────────────────────────────────────────┐
│ 97 / 100     Excellent match                             │
│                                                          │
│ Last AI analysis      95                                 │
│ Current estimate      97  ↑2                             │
│ Hard requirements     5 / 5                              │
│ Primary stack         3 / 3                              │
│ Keywords              18 / 18                            │
│                                                          │
│ Strong match. The remaining opportunities are            │
│ troubleshooting wording and clearer Agile evidence.      │
│                                                          │
│ Changes have not been analyzed yet.                      │
│                                                          │
│                     [Save changes] [Re-analyze]           │
└──────────────────────────────────────────────────────────┘
```

The user should understand their situation in approximately five seconds.

---

# 9. Separate Eligibility, Match, and Optimization

The current interface mixes all scoring concepts.

A stronger mental model is:

```text
Eligibility
5 / 5 hard requirements passed

Match
97 / 100

Optimization
3 suggested improvements
```

This explains three different questions:

1. **Am I eligible?**
2. **How strong is the match?**
3. **What can I improve?**

This is significantly clearer than presenting one large score plus several raw sub-scores.

---

# 10. Promote hard requirements

Hard requirements currently appear too deep in the page.

They should be visible on the overview.

Example:

```text
Hard requirements

5 / 5 passed ✓

✓ JavaScript experience
✓ TypeScript experience
✓ GitHub
✓ SQL databases
✓ Technical degree

[View evidence]
```

If one fails:

```text
1 hard requirement needs attention
```

This should be visually more important than optional keyword optimization.

A hard gate matters more than gaining one or two points in keyword coverage.

---

# 11. Rework the action hierarchy

## Current actions

The current page shows:

```text
Re-analyze with AI
Save as v10
Re-upload resume
```

as peers.

These actions have different meanings and different importance.

## Recommended hierarchy

### If there are unsaved edits

Primary:

```text
Save as v10
```

Secondary:

```text
Discard
```

Then:

```text
Re-analyze with AI
```

after the save, or automatically if that is the intended workflow.

### If re-analysis can safely include unsaved edits

Use a single clear workflow:

```text
Save & re-analyze
```

Only do this if backend behavior supports it reliably.

### Re-upload

`Re-upload resume` is not part of the normal editing flow.

Move it to:

```text
•••
  Upload another resume
  Replace source file
  View version history
```

or to the Resumes page.

Do not visually treat re-upload as equally important to Save.

---

# 12. Make unsaved changes impossible to miss

## Current problem

The state:

```text
edited · not saved
```

is too small and easy to miss.

## Recommended pattern

Show a sticky save bar after the first edit:

```text
────────────────────────────────────────────────────────
Unsaved changes
Your edits haven't been saved as a resume version.

                            [Discard] [Save as v10]
────────────────────────────────────────────────────────
```

Requirements:

- visible while scrolling;
- shown only when dirty;
- keyboard accessible;
- does not cover content;
- disappears after successful save;
- warns before navigation if changes would be lost.

---

# 13. Change the page tabs to user goals

## Current tabs

```text
Side by side
Job description
Your resume
Changes
```

These are organized around documents/views.

The user’s actual questions are:

- what is the result?
- what should I change?
- where does the evidence come from?
- what keywords are missing?

## Recommended tabs

```text
Overview
Suggestions
Compare
Keywords
```

### Overview

Contains:

- primary score;
- eligibility;
- strongest matches;
- important gaps;
- top suggested actions;
- current edit state.

### Suggestions

Contains actionable recommendations.

### Compare

Contains side-by-side comparison.

Inside Compare:

```text
[Split] [Job description] [Resume]
```

### Keywords

Contains detailed keyword coverage.

This avoids having separate top-level tabs for three variations of the same document comparison.

---

# 14. Rename `Changes` to `Suggestions`

The current `Changes` content actually contains:

```text
What to change
What to remove
```

These are recommendations, not already-applied changes.

Recommended name:

```text
Suggestions
```

Alternative:

```text
Recommendations
```

`Suggestions` is shorter and clearer.

---

# 15. Make suggestions actionable

Current recommendation cards are useful, but the user still needs to translate the advice into an action.

Each suggestion should become an action card.

Example:

```text
HIGH IMPACT

Add troubleshooting evidence
Acme Corp · Experience

WHY
The job explicitly requires troubleshooting existing applications.

YOUR EVIDENCE
Payment error-handling and vulnerability fixes already
demonstrate this experience.

SUGGESTED EDIT
Troubleshot and resolved transaction failures across an
existing multi-gateway payment codebase...

[Apply suggestion]   [Edit]   [Skip]
```

The system should help the user complete the change, not just explain it.

---

# 16. Separate evidence from generated wording

This is critical for trustworthy resume generation.

The AI should not write factual resume claims unless the evidence supports them.

Create three explicit evidence states:

```text
✓ Evidence found
? Needs confirmation
× No evidence
```

## Evidence found

The system can safely propose wording based on existing resume evidence.

Example:

```text
Evidence found
Payment error handling and vulnerability fixes already
support a troubleshooting claim.

[Review suggested wording]
```

## Needs confirmation

The system should ask for missing user input before generating a final statement.

Example:

```text
Needs confirmation

How often did this Agile ceremony occur?

[Weekly ▾]

or

[Enter cadence]
```

Then generate wording after the user confirms.

## No evidence

Do not generate a claim.

Example:

```text
No evidence

The job asks for healthcare-domain experience.
No healthcare experience was found in this resume.

Do not add this unless you have real experience to support it.
```

This distinction should be preserved throughout the product.

---

# 17. Avoid placeholders inside generated resume claims

Avoid suggestions like:

```text
... [add your real number]
```

inside resume text.

Instead, request the missing data through a structured form.

Example:

```text
Additional information needed

How many releases did you typically support per month?

[                    ]

[Continue]
```

Then generate final wording only after confirmation.

This is cleaner, safer, and easier to understand.

---

# 18. Reframe `What to remove`

`What to remove` is too absolute.

Prefer:

```text
Lower-priority content
```

or:

```text
Space-saving suggestions
```

Example:

```text
LOWER PRIORITY

Vodworks — algorithm bullet

This experience is valid but less relevant to this role.
Removing it would create space for stronger troubleshooting
evidence.

[Remove] [Keep]
```

The UI should explain the trade-off rather than imply that AI removal is automatically correct.

---

# 19. Improve suggestion priority semantics

Current:

```text
high
medium
```

Better:

```text
High impact
Medium impact
Low impact
```

Possible categories:

```text
High impact
Missing required evidence

Medium impact
Preferred qualification

Low impact
Space / wording optimization
```

If the scoring model can reliably estimate effect:

```text
Estimated impact: +2
```

Only show numerical impact if it is trustworthy.

Do not invent false precision.

---

# 20. Preserve Side-by-Side Compare, but reduce noise

The side-by-side compare is one of the strongest features on the page.

Keep it.

However, the current highlighting makes too many terms green.

When nearly every line contains highlights, highlighting stops being useful.

## Recommended default filters

Show by default:

```text
[x] Missing
[x] Needs confirmation
[x] No evidence
[ ] Matched
```

This focuses attention on what requires action.

Matched keywords can be enabled manually.

---

# 21. Simplify comparison legend terminology

Current concepts include:

```text
found
missing
confirm
can't claim
```

Recommended user-facing terminology:

```text
Matched
Missing
Needs confirmation
No evidence
```

Optionally combine with symbols:

```text
✓ Matched
+ Missing
? Needs confirmation
× No evidence
```

Do not rely on color alone.

---

# 22. Improve `can't claim`

`can't claim` is technically understandable, but a more user-friendly phrase is:

```text
No evidence
```

Example:

Current:

```text
health
can't claim
No healthcare domain work in resume
```

Better:

```text
Healthcare experience

No evidence
Healthcare experience wasn't found in your resume.
```

This is clearer and less system-oriented.

---

# 23. Create linked comparison behavior

The Compare view can become much more powerful.

Example:

```text
┌ Job description ─────────┬ Resume ──────────────────────┐
│ troubleshooting          │ payment error handling       │
│ existing codebases       │ existing codebases           │
│ Azure                    │ Azure                        │
└──────────────────────────┴───────────────────────────────┘
```

When the user selects a requirement:

```text
Troubleshooting
```

both panes should scroll to the related evidence.

Useful interactions:

- click keyword → scroll both panes;
- hover keyword → highlight corresponding evidence;
- click requirement → open explanation;
- click resume evidence → show which requirement it supports.

This turns Compare into an evidence-mapping tool rather than two independent text columns.

---

# 24. Sticky compare headers

In Compare mode, keep headers visible:

```text
Job description
Optum · FullStack Engineer
```

and:

```text
Your resume
Senior Software Engineer · v9
```

Optional:

- independent scroll panes;
- synchronized scroll only where useful.

Avoid sticky UI that consumes too much vertical space.

---

# 25. Render the resume semantically

The current resume display looks like a large text dump.

Do not necessarily render the PDF exactly.

Instead, create a semantic preview.

Example:

```text
Alex Doe
Senior Full Stack Software Engineer

Professional Summary
────────────────────────────────
...

Key Skills
────────────────────────────────
Programming
Frameworks
Data Stores
AI / LLM

Professional Experience
────────────────────────────────

Acme Corp
Senior Full Stack Software Engineer
Dec 2024 – Present

• ...
• ...
```

Benefits:

- easier scanning;
- cleaner highlighting;
- easier linked comparison;
- easier section-level suggestions;
- clearer editing.

The semantic structure should be driven by parsed resume data where available.

---

# 26. Reduce the keyword table prominence

The keyword coverage table is useful for audit/detail work.

It should not dominate the default user flow.

Overview summary:

```text
Keyword coverage

18 / 21 matched

2 need attention
1 unsupported

[Review keywords]
```

Inside `Keywords`:

```text
[Needs attention 3] [Matched 18] [All 21]
```

Default filter:

```text
Needs attention
```

Do not make users scan all successful matches before seeing actual problems.

---

# 27. Make score composition understandable

The user should be able to understand why the score exists.

Add:

```text
Why this score
```

Example:

```text
Hard requirements        Passed
Primary technologies     3/3
Preferred skills         7/8
Keyword coverage         18/18
Resume alignment         Strong
Unsupported claims       0
```

Do not necessarily expose the raw mathematical formula.

Provide conceptual transparency.

---

# 28. Move raw scoring details behind a disclosure

Current values such as:

```text
Keywords 54.9/60
Alignment 40/40
strong · strong · strong
max reachable 97
```

look like internal scoring output.

Default UI should use:

```text
Keyword coverage       Excellent
Role alignment         Strong
Experience evidence    Strong
```

Then:

```text
[View score details]
```

Expanded:

```text
Keyword score     54.9 / 60
Alignment         40 / 40
```

The normal page should be written for users, not for debugging the scoring engine.

---

# 29. Clarify `max reachable`

`max reachable 97` can be confusing.

If retained, explain it.

Example:

```text
Current potential
97 / 100

3 points cannot be supported by evidence currently available
in this resume.
```

or:

```text
Why can't this reach 100?
```

with an explanation.

If the concept does not help the user make a decision, remove it from the default UI.

---

# 30. Hide model/debug details

Values such as:

```text
claude-opus-5
```

should not be primary UI.

Place them in:

```text
Analysis details
```

Example:

```text
Analysis #26
Model: Claude Opus 5
Analyzed: Aug 29, 12:31 PM
Resume version: v9
```

This information is useful for debugging/history, not normal workflow.

---

# 31. Create a completion flow

The page should always make the next step obvious.

Possible internal workflow:

```text
1. Review eligibility
2. Review suggested improvements
3. Apply or skip suggestions
4. Save new resume version
5. Re-analyze
6. Mark ready to use
```

This does not have to appear as a literal stepper.

But the UI should create a sense of progress.

Example:

```text
3 suggestions remaining
```

then:

```text
All important suggestions reviewed
```

then:

```text
Ready to re-analyze
```

then:

```text
Excellent match — ready to apply
```

---

# 32. Do not encourage endless optimization

A 95–97 score should not make the user feel that 100 is required.

For a strong result:

```text
97 · Excellent match

You're ready to apply.

Optional improvements
3 low-risk wording changes
```

The product should support stopping.

Possible final CTA:

```text
Use this version
```

or:

```text
Mark as ready
```

Do not create unnecessary anxiety around reaching a perfect score.

---

# 33. Recommended Overview wireframe

```text
Jobs / FullStack Engineer / Resume Match

Resume Match
Optum · FullStack Engineer

Senior Software Engineer Resume · v9             [History]


┌─────────────────────────────────────────────────────────┐
│ 97 / 100    Excellent match                             │
│                                                         │
│ Last AI analysis       95                               │
│ Current estimate       97  ↑2                           │
│                                                         │
│ ✓ Hard requirements    5 / 5                            │
│ ✓ Primary stack        3 / 3                            │
│ ✓ Keywords             18 / 18                          │
│                                                         │
│ Strong fit. Two wording changes could improve           │
│ troubleshooting and Agile evidence.                     │
│                                                         │
│ Changes haven't been analyzed yet.                      │
│                                                         │
│                            [Save] [Re-analyze]            │
└─────────────────────────────────────────────────────────┘


[Overview] [Suggestions 7] [Compare] [Keywords]


Needs attention
──────────────────────────────────────────────────────────

HIGH IMPACT
Troubleshooting evidence
Evidence already exists in your Acme Corp experience.
[Review suggestion]

MEDIUM IMPACT
Azure
Azure exists in Skills but not recent experience.
[Review suggestion]

MEDIUM · NEEDS INPUT
Agile cadence
Confirm your actual ceremony cadence first.
[Add information]
```

---

# 34. Recommended Suggestions wireframe

```text
Suggestions

3 recommended changes
4 lower-priority space suggestions


HIGH IMPACT
──────────────────────────────────────────────────────────
Add troubleshooting evidence
Acme Corp · Experience

Why
The job explicitly requires troubleshooting existing apps.

Evidence
Payment error-handling and vulnerability fixes already
demonstrate this work.

Suggested edit
"Troubleshot and resolved transaction failures across..."

[Apply] [Edit] [Skip]


MEDIUM IMPACT
──────────────────────────────────────────────────────────
Make Azure explicit
Acme Corp · Experience

Evidence found
Azure appears in your skills and recent stack.

[Apply] [Edit] [Skip]


NEEDS CONFIRMATION
──────────────────────────────────────────────────────────
Clarify Agile cadence

How often did this ceremony occur?

[Weekly ▾]

[Generate wording]
```

---

# 35. Recommended Compare wireframe

```text
Compare

[Split] [Job description] [Resume]

Show
[x] Missing
[x] Needs confirmation
[x] No evidence
[ ] Matched


┌────────────────────────────┬─────────────────────────────┐
│ Job description            │ Resume                      │
│ Optum                      │ Senior Software Engineer v9 │
├────────────────────────────┼─────────────────────────────┤
│                            │                             │
│ troubleshooting            │ payment error handling      │
│ existing codebases         │ existing codebases          │
│ Azure                      │ Azure                       │
│ healthcare experience      │ —                           │
│                            │                             │
└────────────────────────────┴─────────────────────────────┘
```

Selecting a concept should map requirement ↔ evidence.

---

# 36. Recommended Keywords wireframe

```text
Keywords

18 / 21 matched

[Needs attention 3] [Matched 18] [All 21]


Keyword                 Requirement         Status
─────────────────────────────────────────────────────
Troubleshooting         Must                Missing
Agile cadence           Preferred           Verify
Healthcare              Context             No evidence


Matched
─────────────────────────────────────────────────────
JavaScript              Must                Matched
TypeScript              Must                Matched
Node.js                 Must                Matched
...
```

Do not force users to scan all matched terms first.

---

# 37. Visual hierarchy

The intended order of importance should be:

1. job / page title;
2. current resume version;
3. current match result;
4. eligibility;
5. unresolved issues;
6. primary next action;
7. detailed analysis;
8. history/debug information.

Historical scores, model names and raw scoring numbers should never visually compete with the current match.

---

# 38. Status language

Use a consistent vocabulary.

Recommended:

```text
Excellent match
Strong match
Moderate match
Weak match

Matched
Missing
Needs confirmation
No evidence

Saved
Unsaved changes
Analyzing
Analysis complete
Analysis failed

Current estimate
Last AI analysis
```

Do not use different phrases for the same state across tabs.

---

# 39. Color semantics

Use color conservatively.

Suggested meaning:

```text
Green
matched / passed / strong / completed

Amber
needs attention / pending confirmation / changed since analysis

Red
failed hard requirement / error / destructive action

Blue or neutral accent
informational / selected UI state

Gray
inactive / secondary metadata
```

Do not use green highlighting everywhere.

If most text is green, green stops communicating success.

---

# 40. Accessibility

The page must remain fully usable without relying on:

- color;
- hover;
- pointer-only interaction.

Requirements:

- keyboard tab order is logical;
- tabs use correct ARIA semantics;
- sticky save bar receives accessible focus when necessary;
- status chips include text;
- compare highlights are not color-only;
- buttons have visible `:focus-visible`;
- suggestion actions have descriptive labels;
- dropdowns and dialogs restore focus;
- score changes are announced where appropriate;
- generated content controls are accessible;
- contrast meets WCAG 2.2 AA-oriented targets.

---

# 41. Responsive design

Test at minimum:

```text
390 × 844
768 × 1024
1280 × 800
1440 × 900
1792 × 1120
1920 × 1080
```

## Desktop

- side-by-side compare;
- compact score summary;
- persistent sidebar;
- sticky save state.

## Tablet

- compare panes may remain side-by-side if readable;
- otherwise switch to controlled single-pane view.

## Mobile

Do not attempt two narrow side-by-side text panes.

Use:

```text
Compare
[Job description] [Resume]
```

with linked keyword/evidence navigation.

The sticky save bar must not cover primary actions.

---

# 42. Loading and analysis states

Define clear states for AI analysis.

## Before analysis

```text
Ready to analyze
```

## Running

```text
Analyzing resume match...
This usually takes about 2 minutes.
```

Actions:

- disable duplicate analysis requests;
- allow navigation if backend processing continues;
- surface result in Runs/history if user leaves.

## Failed

```text
Analysis failed
Your saved resume version was not affected.

[Try again]
```

Technical details can be available behind:

```text
View details
```

---

# 43. Save/version states

Create explicit states.

```text
Saved as v9
```

After edit:

```text
Unsaved changes
```

After save:

```text
Saved as v10
```

Before AI refresh:

```text
v10 has not been analyzed yet
```

After analysis:

```text
v10 analyzed just now
```

This makes versioning much easier to understand.

---

# 44. Re-upload behavior

Clarify whether upload:

- replaces the current source document;
- creates a new resume;
- creates a new version;
- automatically scans;
- automatically analyzes.

Do not hide this behavior behind the button text.

Possible action:

```text
Upload new resume version
```

Then explain:

```text
This creates v10, scans the new file, and runs a new match analysis.
```

Only if that is the actual behavior.

---

# 45. Project consistency requirements

The page should use the same shared primitives established in the broader UI refactor:

```text
AppShell
PageHeader
Breadcrumbs
Card
Button
Badge
Tabs
Switch
Dropdown
Dialog
Toast
StickySaveBar
StatusBadge
ScoreSummary
EmptyState
Skeleton
```

Do not create isolated, page-specific design patterns unless necessary.

---

# 46. Recommended implementation priority

## P0 — conceptual clarity

1. move page ownership from Target to Job flow;
2. hide history from the top-level header;
3. separate resume versions from analysis runs;
4. resolve the 95 vs 97 ambiguity;
5. redesign header + summary card;
6. change tab structure to Overview / Suggestions / Compare / Keywords.

## P1 — workflow

1. promote hard requirements;
2. create sticky unsaved changes UI;
3. clarify Save → Analyze lifecycle;
4. convert recommendations into action cards;
5. separate evidence / confirmation / no-evidence states.

## P2 — readability

1. reduce matched keyword highlighting;
2. default to gaps;
3. render resume semantically;
4. simplify score labels;
5. move raw details behind disclosures.

## P3 — advanced usability

1. linked compare navigation;
2. evidence mapping;
3. history drawer;
4. analysis details;
5. final “ready to apply” state.

---

# 47. Definition of Done

The refactor is complete when:

- [ ] Page navigation makes it clear that the match belongs to a specific job.
- [ ] `Jobs` is the active sidebar context for this screen.
- [ ] Analysis history no longer occupies the main header.
- [ ] Resume versions and analysis runs are distinct concepts in UI.
- [ ] The user sees one primary current score.
- [ ] The relationship between last AI analysis and current estimate is obvious.
- [ ] Hard requirements are visible in Overview.
- [ ] The user can understand the result within five seconds.
- [ ] Tabs are `Overview / Suggestions / Compare / Keywords` or an equivalent task-oriented structure.
- [ ] `Changes` is no longer used for unapplied recommendations.
- [ ] Suggestions are actionable.
- [ ] Suggestions distinguish Evidence found / Needs confirmation / No evidence.
- [ ] Unsupported claims are never presented as safe-to-apply wording.
- [ ] Unsaved changes are obvious.
- [ ] Save/version/re-analysis flow is understandable.
- [ ] Re-upload is no longer a competing primary action.
- [ ] Matched keywords are not highlighted by default everywhere.
- [ ] Compare is readable and useful.
- [ ] Resume preview is semantically structured.
- [ ] Detailed scoring/debug/model information is secondary.
- [ ] A strong score communicates “ready to apply,” not “keep optimizing forever.”
- [ ] Keyboard navigation works.
- [ ] Responsive behavior is tested.
- [ ] Accessibility checks pass.
- [ ] Existing scoring/business logic is preserved unless an intentional change is documented.

---

# 48. Agent implementation prompt

Use this as the main prompt for the coding agents.

---

## Prompt

You are refactoring the Resume Match / targeted-resume experience in the Job Hunter project.

Your task is to make the page significantly more understandable, readable, trustworthy and easy to use without unnecessarily changing business logic.

This is not just a styling task.

### First: inspect before modifying

Analyze:

- the current route;
- navigation state;
- components;
- state management;
- resume version model;
- analysis run model;
- score calculation;
- local/live score behavior;
- AI analysis lifecycle;
- unsaved edits;
- save/version behavior;
- upload behavior;
- keyword/evidence data structures;
- existing tests.

Document any assumptions before making structural changes.

### Main UX goals

The user should understand in approximately five seconds:

1. which job they are matching;
2. which resume version is active;
3. their current match quality;
4. whether all hard requirements pass;
5. what still needs attention;
6. whether there are unsaved changes;
7. what the next recommended action is.

### Navigation

This page conceptually belongs to a specific job, not to the global Target configuration.

Prefer:

```text
Jobs / <Job Title> / Resume Match
```

and keep `Jobs` active in the application sidebar.

Do not break existing deep links unnecessarily. Add redirects if routes change.

### History

Remove the horizontal history-chip wall from the primary header.

Separate:

- Resume versions;
- Analysis runs.

Expose history through a `History` action using a drawer, modal or dedicated history view.

A user must be able to understand why the same resume version can have multiple analysis scores.

### Score model

The current UI displays a completed AI score and a live estimate at the same time.

Do not expose them as two competing primary scores.

If the underlying logic is:

```text
last AI analysis = 95
current estimate after edits = 97
```

represent it clearly:

```text
97 / 100
Current estimate

Last AI analysis: 95
Changes since analysis: +2
```

Use a visible state:

```text
Changes not analyzed yet
```

After re-analysis, normalize back to one current score.

### Summary

Create one concise top summary.

Include:

- current score;
- match quality label;
- last AI analysis where relevant;
- current estimate where relevant;
- hard requirements;
- primary stack;
- keyword status;
- concise summary;
- primary next action.

Remove or reduce decorative score visualization if it does not add information.

### Mental model

Separate:

```text
Eligibility
Match
Optimization
```

Hard requirements must be visible before optional optimization.

### Tabs

Replace document-oriented tabs such as:

```text
Side by side
Job description
Your resume
Changes
```

with task-oriented navigation:

```text
Overview
Suggestions
Compare
Keywords
```

Inside Compare, allow:

```text
Split
Job description
Resume
```

### Suggestions

Rename `Changes` to `Suggestions` or another equivalent term.

Convert recommendations into actionable cards.

Each suggestion should expose:

- impact/priority;
- affected resume section;
- why the suggestion matters;
- evidence;
- proposed edit;
- actions.

Preferred actions:

```text
Apply
Edit
Skip
```

### Evidence safety

Never generate unsupported factual claims as safe-to-apply resume text.

Every suggestion must fit one of:

```text
Evidence found
Needs confirmation
No evidence
```

For `Needs confirmation`, collect structured user input before final wording is produced.

For `No evidence`, explain the gap and do not offer to fabricate it.

Avoid placeholders such as `[add your real number]` directly inside generated bullets. Ask for the missing data first.

### Removing content

Do not label recommendations as simply `What to remove`.

Prefer:

```text
Lower-priority content
Space-saving suggestions
```

Explain the trade-off and let the user choose `Remove` or `Keep`.

### Unsaved changes

The current small `edited · not saved` label is insufficient.

Implement a visible dirty-state pattern.

For long pages use a sticky action bar:

```text
Unsaved changes
[Discard] [Save as v10]
```

Warn on navigation when changes would be lost.

### Action hierarchy

Do not present:

```text
Re-analyze
Save as v10
Re-upload
```

as equal actions.

Determine the correct workflow from existing business logic.

Make Save and Re-analyze order explicit.

Move re-upload into a secondary menu or clearly label it as:

```text
Upload new resume version
```

and explain what happens.

### Compare

Preserve the side-by-side comparison.

Improve it:

- reduce default matched highlighting;
- show issues by default;
- keep Matched optional;
- use understandable labels:
  - Matched
  - Missing
  - Needs confirmation
  - No evidence
- do not rely on color only;
- consider linked requirement ↔ evidence navigation;
- use sticky compare headers where useful.

### Keywords

Do not show the complete keyword table as the primary experience.

Overview:

```text
18 / 21 matched
2 need attention
1 unsupported
```

Keywords tab:

```text
Needs attention
Matched
All
```

Default to `Needs attention`.

### Resume rendering

Avoid rendering the resume as an undifferentiated text dump.

If parsed structure is available, render semantic sections:

- header;
- summary;
- skills;
- experience;
- education.

Keep keyword/evidence highlighting compatible with that structure.

### Scoring detail

Move raw score internals such as:

```text
54.9/60
40/40
strong · strong · strong
max reachable 97
model name
```

behind `View score details` or `Analysis details`.

Default UI should describe outcomes in user language.

### Strong-match behavior

A score in the 95–97 range should communicate that the resume is already strong.

Use language such as:

```text
Excellent match
You're ready to apply.
```

Remaining recommendations can be marked optional where appropriate.

Do not create pressure to reach 100 unless there is a genuine hard requirement.

### Shared UI

Use project-wide shared primitives and design tokens.

Do not introduce page-local styling patterns if the project already has or is creating:

- buttons;
- tabs;
- cards;
- badges;
- dialogs;
- sticky save bars;
- status indicators;
- typography;
- spacing;
- layout primitives.

### Responsive

Verify at:

```text
390x844
768x1024
1280x800
1440x900
1792x1120
1920x1080
```

On mobile, do not force two tiny compare columns. Use controlled single-pane comparison.

### Accessibility

Verify:

- keyboard navigation;
- correct tab semantics;
- visible focus;
- accessible status text;
- contrast;
- non-color-only highlighting;
- dialog focus management;
- accessible buttons;
- proper dirty-state warnings.

### Testing

Run:

- lint;
- typecheck;
- unit tests;
- integration tests;
- e2e tests;
- Playwright visual tests;
- accessibility tests if available.

Test critical flows:

- open Resume Match;
- switch tabs;
- edit resume;
- dirty state;
- discard;
- save new version;
- re-analyze;
- analysis success/failure;
- history;
- compare filters;
- evidence confirmation;
- unsupported evidence;
- upload new resume version;
- responsive layouts.

### Final review

Before completion:

1. capture before/after screenshots;
2. review the page at every target viewport;
3. verify the user can identify the current state within five seconds;
4. verify there is one obvious next action;
5. verify history/debug details no longer dominate;
6. verify unsupported claims cannot be accidentally applied;
7. verify visual and interaction consistency with the rest of Job Hunter.

### Final deliverable

Provide:

1. summary of UX changes;
2. route/navigation changes;
3. component changes;
4. score-state model;
5. history/version model;
6. suggestion/evidence model;
7. screenshots;
8. tests run;
9. accessibility results;
10. remaining known issues.

Do not claim completion while tests are failing unless the failures are clearly pre-existing and documented.

---

# 49. Suggested multi-agent workflow

```text
ORCHESTRATOR
    |
    +--> Resume Match Audit Agent
    |
    +--> UX / State Model Agent
    |
    +--> Shared Components Agent
    |
    +--> Resume Match Implementation Agent
    |
    +--> Compare / Keywords Agent
    |
    +--> History / Versioning Agent
    |
    +--> Consistency Reviewer
    |
    +--> QA / Playwright / Accessibility Agent
```

Rules:

1. Audit the real data/state model before redesigning score/history UI.
2. Decide score semantics before changing labels.
3. Decide version vs analysis-run semantics before building history.
4. Shared component changes should have one owner at a time.
5. Do not let multiple agents invent different status vocabularies.
6. Preserve honesty/evidence constraints.
7. Run final QA only after all branches are integrated.

---

# 50. Final design principle

The page should continuously answer:

> **Am I a good match, what needs attention, and what should I do next?**

Everything else is secondary.

Historical runs, raw scoring details, model names, complete keyword lists and file-management actions should be available when needed, but they should not compete with the current decision-making workflow.

The final experience should feel like a focused resume-matching assistant, not a scoring-engine debug screen.
