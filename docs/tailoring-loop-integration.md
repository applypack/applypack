# The tailoring loop: integration guide

> How to build what [tailoring-loop-plan.md](./tailoring-loop-plan.md)
> decided, in this codebase, file by file. Written 2026-09-03 before any
> code; the backlog ticks are [TASKS.md §18](./TASKS.md). One stage = one
> branch = one PR (+ an annotated tag when it changes runtime behaviour,
> `release-discipline`). Before a stage: read CLAUDE.md "File rules", the
> `testing-gate`, `commit-discipline`, `accessible-interactions` and
> `adr-writer` skills, then the stage's pre-work checklist here. Facts in
> the plan expire; the pre-work note at the top of each PR says what changed.

---

## 0. Sessions: which model, which effort

Two different things are called "model" in this repo. The **session model**
is the Claude Code model that writes the code. The **product engine** is
what ApplyPack calls at runtime (`/settings` → AI engine; the resume role
defaults to `claude-opus-5` per the ADR 0029 bench). Changing one never
touches the other.

| Stage | Session model | Effort | Why |
|---|---|---|---|
| Pre-work analysis notes (every stage) | Fable 5.1 | high | the note decides scope; a wrong assumption here costs the whole branch |
| 1 `target-copy-locate` | Opus 5 | medium; `/fast` for the markup | UI markup, DOM wiring, two pure functions with tests |
| 2 `target-apply-edits` | Opus 5 | high | text operations have edge cases (quotes spanning lines, separators, the contact line) |
| 3 `suggestion-replacements` | Fable 5.1 | high | prompt rules plus guard tests (the gotcha 8/11 class of work) and the persist-time gate |
| 4 `docx-patch` | Fable 5.1 for `docx-patch.ts`, `docx-structure.ts` and the fixtures; Opus 5 for routes and pages | max for the patcher, medium for the wiring | the patcher is the one piece with no library behind it and a byte-level correctness bar |
| 5 `resume-render` | Opus 5 for the library wiring and pages; Fable 5.1 for the `structure` prompt block and its anchoring | high | new dependencies, fonts, two renderers, one prompt change |
| `code-review-expert` pass before each PR | Fable 5.1 | high | mandatory pre-merge gate |
| ADRs 0037–0039, CLAUDE.md rows, CHANGELOG | Opus 5 | medium | mechanical |

Product engine: no change. The resume role stays Opus 5 (the ADR 0029 bench
measured Sonnet slower on the CLI engine at lower keyword-frame stability);
the new `replacement` field and the scan's `structure` block run on the same
role. Re-run `npm run bench:resume` after stage 3 and stage 5 and paste the
table into the PR.

---

## 1. Map of the change

| File | Stage 1 | Stage 2 | Stage 3 | Stage 4 | Stage 5 |
|---|---|---|---|---|---|
| `src/web/public/target.mjs` | `proposalOf`, `changeSheet`, `formatChangeSheet` | `applyReplacement`, `removeSpan`, `insertIntoSkills`, `moveLineToBlockTop` | reads `replacement` | | |
| `src/web/public/line-diff.mjs` (new) | `diffLines` | | | reused server-side | |
| `src/web/public/copy.mjs` (new) | `wireCopy` | | | | |
| `src/web/public/target-page.mjs` | Copy, Locate, `.located`, change sheet | Apply / Remove / Add / Undo, edit state | Apply enabled by `replacement` | Download button state | |
| `src/web/pages/resume-match-card.tsx` | `SuggestionCard` (Now / Proposed), removal quote, buttons | states | | | |
| `src/web/pages/target.tsx` | CSS, narrow order, toggle move, sheet buttons | | | template verdict line, Download | "Clean version" link |
| `src/web/pages/job-detail.tsx` | loads `copy.mjs` | | | | |
| `src/web/target.test.ts` | tests | tests | | | |
| `src/resume/prompts.ts` | | | `replacement`, `insert_after`, `RULE_BULLET_STYLE`, `PROMPT_VERSION 7` | | `structure` block in `SCAN_SYSTEM` + `ScanSchema` |
| `src/resume/replacement-gate.ts` (new) | | | `gateActions` | | |
| `src/resume/match.ts`, `suggestions.ts` | | | call the gate before persist | | |
| `src/resume/prompts.test.ts` | | | guard tests for both variants | | structure guard |
| `src/resume/docx-structure.ts` (new) | | | | template check | reads styles for inference |
| `src/resume/docx-text.ts` | | | | `walkDocument` + parity test | |
| `src/resume/docx-patch.ts` (new) | | | | the patcher | |
| `src/resume/docx-props.ts` (new) | | | | read / fix properties | |
| `src/resume/line-diff.ts` (new) | | | | server wrapper over the `.mjs` | |
| `src/resume/store.ts` | | | | `replaceResumeFile` reused for the patched version | `structure` column |
| `src/web/routes/resumes.tsx` | | | | branch in `POST /resumes/:id/draft`; `structure` in `GET /resumes/:id` | `/resumes/:id/render` |
| `src/web/routes/jobs.tsx` | | | | verdict for the target page | |
| `src/web/pages/resume-detail.tsx` | | | | "Template check" card | knob view link |
| `src/resume/json-resume.ts` (new) | | | | | zod model |
| `src/resume/structure-anchor.ts` (new) | | | | | verbatim guard |
| `src/resume/style-infer.ts` (new) | | | | | typography from docx / pdf |
| `src/resume/render/clean-docx.ts`, `render/clean-pdf.ts` (new) | | | | | the two renderers |
| `src/web/pages/resume-render.tsx` (new) | | | | | knobs + preview |
| `prisma/schema.prisma` + migration | | | | | `Resume.structure Json?` |
| `Dockerfile` | | | | | copy `src/resume/fonts` |
| `package.json` | | | | `@xmldom/xmldom`, `jszip` | `docx`, `pdfkit`, `@types/pdfkit` |
| `docs/adr/` (0035–0036 were taken before stage 3 shipped, so the stages moved up: stage 3 is **0037**, stage 4 **0038**, stage 5 **0039**) | | | 0037 | 0038 | 0039 |
| CLAUDE.md, SPEC.md, CHANGELOG.md, README | rows + bump | rows + bump | rows + bump | rows + bump | rows + bump |

Stages 1 and 2 need no schema and no prompt change. Stage 3 bumps
`PROMPT_VERSION`. Stage 4 adds two pure-JS dependencies and no migration.
Stage 5 adds two dependencies, one font, one column.

---

## 2. Stage 1: `target-copy-locate`

The page becomes comfortable for the manual path: copy any proposal, locate
its target without losing the card, carry the whole list out as text.

### 2.1 Pre-work (before the branch)

- [ ] Read `pages/target.tsx`, `public/target-page.mjs`, `public/target.mjs`,
      `pages/resume-match-card.tsx` (`ActionsBlock`, `RemovalsBlock`,
      `MatchReport`), `pages/job-detail.tsx` (how the match card is mounted),
      `src/web/ui.tsx` (`Button`, `Badge`, `Hint`).
- [ ] Pull every stored `actions[].what` (`select jsonb_array_elements(actions)->>'what' from resume_match`)
      and write the proposal extractor against the real shapes: `Reword as: "…"`,
      `Rewrite as: "…"`, `Change title to "…"`, `Open with: "…"`, `Add: "…"`,
      `Add a … grouping: "…"`, and the no-quote conditionals. Record the hit
      rate in the note (16 of 18 on 2026-09-03).
- [ ] Decide the narrow-screen order with one screenshot of the current tab
      at 375 px in the note.

### 2.2 Pure functions

`src/web/public/target.mjs` (dependency-free ES module, tested from
`src/web/target.test.ts` via `import()`):

```js
/** The wording an action proposes, or null when `what` is an instruction with no quoted text. */
export function proposalOf(action) → { text: string, verb: string } | null
```
Rules: prefer `action.replacement` when present (stage 3); else the longest
double-quoted span in `what` (straight or curly quotes, folded); the `verb`
is the text before the first quote with trailing colon and "as/to/with"
stripped ("Reword", "Change title", "Add"). A quoted span under 12
characters is not a proposal (it is a term mention).

`src/web/public/line-diff.mjs` (new, pure):

```js
/** Line diff of two texts: [{ op: 'keep'|'change'|'delete'|'insert', a?: {i, text}, b?: {i, text} }]. */
export function diffLines(before, after)
```
LCS over lines normalised by trim + whitespace collapse; a delete
immediately followed by an insert pairs into `change`. Blank lines are kept
as lines (paragraph gaps matter to the patcher later). Bound: 2 000 lines
per side, O(n·m) is fine at resume size.

`src/web/public/target.mjs`:

```js
/** Markdown change sheet: before editing (proposals) or after (the diff). */
export function changeSheet({ actions, removals, analysedText, editedText })
  → { entries: [{ section, where, now, next, why, kind: 'proposal'|'removal'|'edit' }] }
export function formatChangeSheet(sheet) → string   // Markdown, one block per entry
```
"Copy all suggestions" uses the proposals; "Copy my changes" uses
`diffLines(analysedText, editedText)` and ignores unchanged lines.

Tests (`src/web/target.test.ts`): the extractor against eight real shapes
plus the two conditionals; the diff on keep / change / delete / insert /
moved line (a move shows as delete + insert, documented); the sheet on an
edited fixture; Markdown output stable (snapshot string in the test).

### 2.3 DOM wiring (`target-page.mjs`)

- **Copy**: `navigator.clipboard.writeText(text)`; on rejection fall back to
  a hidden textarea + `document.execCommand('copy')`; the button text turns
  to "Copied" for 2 s and an `aria-live="polite"` region says "Copied to
  clipboard". `src/web/public/copy.mjs` exports `wireCopy(root)` that
  delegates clicks on `[data-copy]` buttons; the target page and the job
  page both import it, so Copy works on `/jobs/:id` as well.
- **Locate**: `locateQuote(editor.value, quote)`; on a hit add
  `.located` to the matching backdrop span (render marks it via a new span
  class in `resumeSpans`, or wrap after render), set the editor's own
  `scrollTop` so the span sits in the upper third, call
  `editor.focus({ preventScroll: true })` only when
  `matchMedia('(min-width: 1024px)')` matches. The page scroll position
  does not change; assert this in the manual walk. On a miss set the card's
  status line to "Couldn't find this text in the editor, it may already be
  edited" and drop the `flash-target` animation.
- Remove the `[data-quote]` click handler on list items; the buttons carry
  `data-quote` and `data-proposal` instead.
- "Copy all suggestions" and "Copy my changes" at the top of the Suggestions
  pane; the second is disabled while the editor equals the analysed text.

### 2.4 Markup

`pages/resume-match-card.tsx`: a `SuggestionCard` component used by
`ActionsBlock` (on both pages) with this anatomy: label row (priority badge
inline with the section and `where`), **Now** block (the quote, monospace
off, 14 px), **Proposed** block (the proposal text, with the Copy button on
the right), "serves: <why>" as a small line, then the button row (Copy,
Locate; Apply and friends arrive in stage 2 behind a prop). `RemovalsBlock`
gains the quote, dimmed and struck through, and a Locate button.
`interactive` replaces the `jumpable` prop and is true only on the target
page; Copy is always rendered.

`pages/target.tsx`: CSS for `.located` (2 px accent outline, fade 2 s,
`@media (prefers-reduced-motion: reduce)` disables the fade); on
`max-width: 1023px` the `.pane-resume` card comes first in the Suggestions
view with the editor at 40 vh and an "Expand editor" button that toggles
70 vh; the "show matched highlights" checkbox moves into the editor card
header; the keyword table folds into a `<details>` on narrow screens.

Copy text (DESIGN.md voice): "Copy", "Copied", "Locate", "Couldn't find this
text in the editor, it may already be edited", "Copy all suggestions", "Copy
my changes".

### 2.5 Accessibility

Buttons are `<button type="button">` from the `Button` primitive, size sm;
focus ring from the layout tokens; the aria-live region exists once per
page; the Locate outline is not the only signal (the card also says the
line number). Keyboard walk: Tab reaches every Copy and Locate in order,
Enter activates, Escape closes nothing new.

### 2.6 Verification (testing-gate: dashboard page + pure logic)

- `npm run lint:types && npm test` (new tests included).
- `docker compose build web && docker compose up -d web`; curl `/jobs/:id`
  and `/jobs/:id/target?match=…` for 200.
- Screenshots at 1200, 768, 375 of a card in its three states; the page
  scroll position before and after Locate at 800 px (the bug in the plan).
- Browser console: 0 errors; clipboard tested in the app's browser pane and
  in Safari (permission prompt behaviour differs).
- `code-review-expert` over `git diff main...HEAD`.

### 2.7 Docs and release

CLAUDE.md "Where to look": rows for `proposalOf`, `diffLines`, `copy.mjs`;
"how does the user…" rows: "Copy a suggested wording", "Take the change
list into Word". SPEC.md targeted-view paragraph. CHANGELOG + minor bump
(next minor at PR time). Release notes draft in the PR body.

### 2.8 Acceptance

A user on a phone opens Suggestions, copies a proposal in one tap, pastes
it into Google Docs, comes back and the card is still on screen. On
desktop, Locate outlines the target without moving the page. "Copy all
suggestions" pastes as readable Markdown.

---

## 3. Stage 2: `target-apply-edits`

Apply, Remove, Add to Skills, Undo, as text operations on the editor.

### 3.1 Pre-work

- [ ] Read `keyword-overrides.ts` (`effectiveKeywords`, `addKeyword` status
      rules) and `facts.ts` (confirmed / denied), because Add to Skills must
      obey them.
- [ ] Count, on the stored matches, how many actions have a quote the
      editor finds (`locateQuote`) and how many removals span more than one
      line; the note records both.

### 3.2 Pure functions (`target.mjs`)

```js
export function applyReplacement(text, quote, replacement) → { text, span } | { error: 'not-found' }
export function removeSpan(text, quote) → { text, span } | { error: 'not-found' | 'protected' }
export function insertIntoSkills(text, term, where) → { text, span } | { error: 'no-skills-line' }
export function moveLineToBlockTop(text, quote) → { text, span } | { error: 'not-found' | 'not-a-bullet' }
```
Rules:
- `applyReplacement` locates through `locateQuote`, replaces exactly that
  span, keeps the surrounding line's leading bullet marker, and returns the
  new span for `.located`.
- `removeSpan` removes the span; when the quote equals a whole line the line
  goes with its newline; when the line matches `EMAIL_RE` or a phone run
  (import the patterns from `parse-warnings.ts` by copying the two regexes
  into the module with a comment, the browser module cannot import TS) the
  result is `protected`.
- `insertIntoSkills` finds the target line: the line containing the
  `where` hint's key word ("Programming", "Frameworks", "Others"), else the
  first non-heading line under a heading matching /skills/i, else error.
  The separator is inferred from the line (", " / " | " / " · "); the term
  goes at the end; a term already present (via `findTerm`) is a no-op.
- `moveLineToBlockTop` finds the quoted line, walks up while lines start
  with `- ` to the block start, moves the line there.

Tests: each function on a fixture resume text, including the protected
line, a quote with curly apostrophes, a two-line removal quote (join with a
space before locating), a skills line with pipes.

### 3.3 DOM wiring and state

- Buttons: Apply (when `proposalOf` returns text), Edit & apply (a
  textarea inline in the card prefilled with the proposal; Save applies),
  Skip, Remove, Add to Skills on chips, Undo on applied and skipped cards.
- State per match in localStorage `target-edits:<matchId>` =
  `{ applied: { [key]: previousText }, skipped: [key] }` where `key` is
  `section|where|quote` hashed with the same short hash the routes use
  (copy the function; keep it tiny). Undo restores `previousText` when the
  editor still equals the post-apply text; otherwise it says "the text moved
  on, undo by hand" and stays disabled.
- "Reset edits" and "Discard" clear the state with the draft.
- Chips: `add` status and `ask_user` with a confirmed `CandidateFact` get
  "Add to Skills"; `ask_user` without an answer keeps the confirm flow first;
  `cannot_claim` chips render without a button and say why on hover and in
  the line under the chips on touch.

### 3.4 Verification

Unit tests above; keyboard walk (every button reachable, Undo announces
through the live region); screenshots of applied / skipped / undone; the
dirty bar reacts; Re-check with AI still posts the edited text; a reload
restores draft and state together.

### 3.5 Docs and release

CLAUDE.md rows for the four operations and the state key; SPEC; CHANGELOG +
minor bump. No ADR: no contract changed.

---

## 4. Stage 3: `suggestion-replacements`

The model returns applicable wording; the fact gate decides what is
applicable.

### 4.1 Pre-work

- [ ] Read `prompts.ts` (`RULE_ACTIONS`, `RULE_REMOVALS`, `OUTPUT_ACTIONS`,
      `REVIEW_SYSTEM`'s example / ask rules), `match.ts` (where the parsed
      result meets `createMatch`), `suggestions.ts`, `cover-letter.ts` (how
      it calls `factCheck` and what sources it passes), `fact-check.ts`
      (the `factCheck` signature and verdict shape), `prompts.test.ts`
      (the guard-test pattern for both variants),
      `prompt-fence-registry.test.ts`.
- [ ] Run `npm run bench:resume -- --mode full --out before.json` on the
      current prompt and keep the file for the after-table.

### 4.2 Schema and rules (`prompts.ts`)

```ts
actions: z.array(z.object({
  section, where, what, why, priority,
  quote: nullableText,
  replacement: nullableText,   // the exact new text for the quoted span
  insert_after: nullableText,  // verbatim anchor line for an addition
}))
```
- Extract the bullet-style rules from `RULE_ACTIONS` into
  `RULE_BULLET_STYLE` and reuse the same string in `REVIEW_SYSTEM`'s
  example rule, so one wording rule governs both surfaces.
- `RULE_ACTIONS` gains: "When the edit changes existing text, put the
  complete new text in `replacement`, ready to paste in place of `quote`;
  for an addition put the line it follows in `insert_after` and the new
  text in `replacement`; `what` says what changes in one clause." The
  NO TREADMILL and quantification rules stay word for word.
- `OUTPUT_ACTIONS` lists the two fields. `SuggestionsSchema` picks them up
  through `MatchSchema.pick`.
- `PROMPT_VERSION = 7`, one bump; stored v6 rows keep working through
  `proposalOf`'s quoted-span fallback.

### 4.3 The gate (`src/resume/replacement-gate.ts`, pure)

```ts
export interface GateSources { resumeText: string; confirmedFacts: {term, note}[]; deniedTerms: string[]; keywords: MatchKeyword[] }
export function gateActions(actions: MatchAction[], sources: GateSources): { actions: MatchAction[]; blocked: number; warned: number }
```
For every action with a `replacement`: `toPlainPunctuation` first; then
`factCheck(replacement, [resumeText, ...confirmedFactLines])` exactly as
`cover-letter.ts` calls it; `block` → `replacement` becomes null,
`why` gains " · needs a real number: <first blocked claim>"; `warn` →
kept, `note`-style suffix on `why`. Then KEEP WANTED KEYWORDS in code: if
the quote contains a keyword whose status is `present` or `add` and the
replacement does not (via the keyword matcher's `findTerm`), drop the
replacement the same way. Log counts.

Wire it in `match.ts` after `parseMatchResponse` and before `createMatch`,
and in `suggestions.ts` before `updateMatchSuggestions`, with the sources
loaded where `listFacts()` already is.

### 4.4 UI

Apply appears only when `replacement` is present after the gate; a blocked
card shows the question and Edit & apply. The removal path is unchanged.

### 4.5 Guard tests (`prompts.test.ts`)

Both variants and the suggestions prompt contain the replacement rule; the
zod schema accepts a reply without the new fields; the gate blocks an
invented "40%" and keeps a figure present in the resume; the KEEP WANTED
KEYWORDS check drops a replacement that loses "Docker".

### 4.6 Verification

`bench:resume` after-table (parse failures 0, reply size delta, status
agreement); one live full analysis and one Get suggestions on a stored
resume; count blocked replacements and paste the numbers in the PR;
`prompt-fence-registry.test.ts` green (no new call site).

### 4.7 ADR 0037 (the plan said 0035; that number was taken) and release

"Suggestions carry replacement text; the fact gate decides what is
applicable." Context: TASKS §5.15's closure and its reopen trigger, the
16/18 measurement. Decision: the two fields, the gate at persist time,
blocked proposals shown as questions, keyword additions deterministic.
Consequences: more output tokens on the full report (measured), Apply on
one click. CHANGELOG + minor bump + tag.

---

## 5. Stage 4: `docx-patch`

Save returns the user's own .docx with the edited strings, when the file
allows it; the template check tells the user beforehand.

### 5.1 Pre-work

- [ ] Read `docx-text.ts` end to end, `zip.ts`, `zip-write.ts`,
      `docx-text.test.ts` fixtures, `store.ts` (`replaceResumeFile`,
      `saveResumeTextVersion`, `getResumeOriginal`), `routes/resumes.tsx`
      (`POST /resumes/:id/draft` and its run), `pages/resume-detail.tsx`
      (where parse warnings render), `web/upload.ts`.
- [ ] Prove `@xmldom/xmldom` fidelity in a throwaway script: parse resume
      1's `document.xml`, serialise unchanged, compare text nodes and
      attribute order; decide "DOM for document.xml, raw bytes for every
      other part" (the expected outcome) and write it in the note.
- [ ] Build the structural twin fixture: take resume 1's XML, replace every
      text node with neutral prose of the same length, keep runs, tabs, the
      1×2 table, numbering and the OMML objects; commit it under
      `src/resume/fixtures/flow-fragmented.docx`. Add two more:
      `structural-table-layout.docx` (two-column table layout, a text box,
      contact in the header) built with the `docx` library from stage 5 or
      by hand in Word, and `flow-simple.docx` (paragraphs only).
- [ ] Run the parser-disagreement test by hand: `docx-text` vs
      `libreoffice --convert-to txt` on the three fixtures; note the
      differences (tabs, table rows, list markers).

### 5.2 Dependencies

`jszip` (container: list, read, write with the original compression
settings) and `@xmldom/xmldom` (DOM). Pin exact versions; they are pure JS,
so the Dockerfile stays as it is. ADR 0036 records both.

### 5.3 Template check (`src/resume/docx-structure.ts`, pure)

```ts
export interface DocxStructure {
  kind: 'flow' | 'structural' | 'unsupported';
  lines: { total: number; editable: number };
  tables: number; textBoxes: number; drawings: number; columns: number;
  headerChars: number; footerChars: number; math: number;
  hiddenRuns: number; whiteRuns: number; tinyRuns: number;
  notes: string[];   // plain sentences for the card
}
export function docxStructure(bytes: Buffer): DocxStructure
```
`kind` is `flow` when tables + text boxes + columns are 0 and the header /
footer carry no text; `structural` otherwise; `unsupported` when
`document.xml` is missing or the document has more text in text boxes than
in the body. `lines.editable` counts rendered lines whose block is a
paragraph or a table cell (stage v1 policy: cell text edits allowed; owner
question 5). `notes` are the sentences the card shows ("2 formula objects:
some parsers cannot read them", "Contact details live in the header: ATS
parsers and this editor do not see them").

Runs at upload (`web/upload.ts` after `extractResumeText`, .docx only) and
the result is not stored: it is recomputed from `original` on
`GET /resumes/:id` (43 KB, sub-millisecond) and on the target page. Tests:
the three fixtures give the three kinds; hidden / white / tiny runs are
counted from a hand-made XML string.

### 5.4 `docx-text.ts` refactor

Add `walkDocument(doc: Document) → Block[]` with
`Block = { kind: 'heading'|'bullet'|'body'|'cell'|'tabbed', node: Element, lines: string[] }`
and make `documentXmlToText` a thin fold over it (`lines.join('\n')` per
block, same blank-line rules). The parity test asserts old and new output
are identical on every existing fixture plus the three new ones. Keep the
regex reader as the fallback for the text path if xmldom throws on a file
(some producers emit invalid XML); log which path ran.

### 5.5 Line diff on the server

`src/resume/line-diff.ts` imports the browser module the way
`keyword-matcher.ts` already bridges to `target.mjs`, so the change sheet
and the patcher share one `diffLines`.

### 5.6 The patcher (`src/resume/docx-patch.ts`, pure)

```ts
export interface PatchReport { changed: number; removed: number; added: number; skipped: { line: string; reason: string }[] }
export type PatchResult =
  | { ok: true; docx: Buffer; report: PatchReport; text: string }
  | { ok: false; reason: string; report?: PatchReport };
export function patchDocx(original: Buffer, analysedText: string, editedText: string, opts?: { fixProperties?: { title: string; author: string } }): PatchResult
```
Algorithm:
1. `jszip.loadAsync(original)`; read `word/document.xml`; parse with xmldom.
2. `walkDocument` → blocks; `analysedText` must equal the fold of the
   blocks (normalised); if not, return `ok: false, reason: 'analysed text
   does not match this file'` (the user edited a different version).
3. `diffLines(analysedText, editedText)`; map each `a` line index to its
   block through a running counter over `block.lines`.
4. Apply ops in reverse document order (so indices stay valid):
   - `change` on a paragraph block: concatenate its `w:t` text nodes; find
     the old line text; write the new text into the first affected `w:t`
     (set `xml:space="preserve"`), empty the rest of the span, keep partial
     runs' outside parts. A `tabbed` block splits the line on ` | ` and
     patches each side within its tab-delimited run group. A `cell` block
     patches the cell paragraph the same way.
   - `delete`: remove the paragraph node; refuse when the block is a
     `tabbed` header or a `cell` (skipped with reason).
   - `insert`: clone the previous block's paragraph node deep, replace its
     runs with one run carrying the previous run's `rPr` and the new text;
     a bullet after a bullet keeps `numPr`. Refuse inserts inside tables in v1.
   - Hygiene on every inserted / changed string: `toPlainPunctuation`
     applied to the *new* text only; the original's characters stay.
5. Serialise `document.xml`; refresh `dcterms:modified` in
   `docProps/core.xml` (`docx-props.ts`); apply `fixProperties` when given
   (title, `dc:creator`, `cp:lastModifiedBy`; nothing else).
6. Rebuild the zip with every other entry copied byte for byte
   (`jszip` keeps them when only two files are replaced).
7. Gates, in order; any failure returns `ok: false` with the reason:
   `docxToText(docx)` equals `editedText` after the editor's normalisation;
   counts of `m:oMath`, `w:drawing`, `txbxContent` unchanged; no new
   hidden characters; `report.skipped` is empty or the caller allowed
   partial patches (v1: empty required).

`docx-props.ts` (pure): `readProps(bytes) → { title, creator, lastModifiedBy, modified, application }`,
`withProps(bytes, patch) → bytes` touching only `docProps/core.xml`; test
that `word/*` is byte-identical afterwards.

Tests (`docx-patch.test.ts`): change a fragmented bullet; change both
halves of a tabbed header; delete a bullet; insert a bullet after a bullet
(numbering kept); refuse a delete of a header; refuse an edit when the
analysed text mismatches; round trip on all fixtures; properties fix leaves
`word/*` untouched; a curly quote in new text becomes straight.

### 5.7 Store and routes

- `POST /resumes/:id/draft` (`routes/resumes.tsx`): inside the existing
  run, before `saveResumeTextVersion`: load `getResumeOriginal(id)`; if the
  filename ends with `.docx` (the stored mime is unreliable: resume 1 says
  `application/octet-stream`) and `docxStructure(original).kind !== 'unsupported'`,
  call `patchDocx(original, analysedText, text)` where `analysedText` is the
  match's `resumeText` the editor started from (post it as a hidden field
  `baseText`, or the match id and read it back). On `ok`, call
  `replaceResumeFile(id, { sourceFilename: `${slug}-v${n}.docx`, mimeType: DOCX_MIME, original: docx, text })`;
  on `ok: false`, fall back to the text version and put the reason in the
  flash ("Saved as v5 (text). The .docx could not be patched: <reason>.").
  The run's subtitle names which one happened.
- "Save as a tailored copy": a second submit value on the same form creates
  a new `Resume` row (`createResume` with the patched or text file, name
  `${resume.name} · ${job.companyName}`) instead of bumping the master;
  owner question 1 decides the default.
- `GET /resumes/:id` passes `structure` (or null for non-docx) to
  `ResumeDetailPage`; `GET /jobs/:id/target` passes the one-line verdict.
- `GET /resumes/:id/download` is unchanged: it serves the current file,
  which is now the patched one after a patched save.

### 5.8 UI

- `/resumes/:id`: a "Template check" card next to "What the ATS sees":
  kind as a badge (Editable in place / Partly editable / Text only), the
  lines line, the notes, and "Fix document properties" (a POST that calls
  `withProps`, shown only when `readProps` finds a creator or title that is
  not the candidate; the current values are printed on the button's card).
- Target page: above the editor, "This file: editable in place, 61 of 78
  lines" or "This file is a PDF: Save keeps a text version; upload the .docx
  it was printed from to get a styled file back." After a patched save the
  flash carries "Download .docx" and the export report line.
- Copy: never say "AI"; say what happened and why.

### 5.9 Verification

Unit tests above; round trip on resume 1 (real file, by hand); open the
patched output in Word, Pages and LibreOffice and compare with the original
side by side (screenshots in the PR); `docker compose build web` and the
draft flow end to end; the parser-disagreement check on the output; the
`Fix document properties` POST verified with `readProps` before and after.

### 5.10 ADR 0036 and release

"Save patches the user's .docx in place; text-only versions are the
fallback." Supersedes the "text-only versions" consequence of ADR 0010.
Records the dependencies, the DOM-for-document.xml decision, the gates, the
v1 table policy, the metadata policy. CHANGELOG + minor bump + tag. CLAUDE.md
rows: template check, patcher, properties, the `.docx`-only rule.

---

## 6. Stage 5: `resume-render`

A clean single-column .docx and .pdf in the user's typography, for files
that cannot be patched.

### 6.1 Pre-work

- [ ] Read `scan.ts`, `SCAN_SYSTEM`, `ScanSchema`, `saveResumeScan`,
      `keyword-anchor.ts` (the verbatim guard to imitate), `pdf-text.ts`
      (how the pdf.js proxy is opened and destroyed), `Dockerfile` (how
      `src/web/public` is copied).
- [ ] Render one JSON Resume sample through `docx` + pdfkit and through
      Typst (`basic-resume` or `jsume`) in a throwaway script; compare
      output, dependency size and the producer strings; the note decides
      the PDF engine (owner question 3).
- [ ] Pick the bundled font: one OFL family with Latin + Cyrillic coverage
      in regular and bold (Source Sans 3 or Liberation Sans); record the
      licence file path.

### 6.2 Model (`src/resume/json-resume.ts`)

A zod schema for the subset ApplyPack renders: `basics` (name, label,
email, phone, url, summary, location, profiles), `work[]` (name, position,
location, startDate, endDate, summary, highlights[]), `education[]`,
`skills[]` (name, keywords[]), `languages[]`, `certificates[]`,
`projects[]`. Export the type and `readStructure(json)` for the column.

### 6.3 The scan's `structure` block

`SCAN_SYSTEM` gains a `"structure"` field in the output shape with the
schema above and one rule: every `highlights[]` entry, every `summary` and
every `basics` string is copied character for character from the resume.
`src/resume/structure-anchor.ts` (pure) checks it: a string that is not a
verbatim span (after `normalise`) of the resume text is dropped and logged;
a work entry that loses all highlights is kept with an issue line.
Migration `add_resume_structure`: `Resume.structure Json?`, hand-written,
`npx prisma format`. `saveResumeScan` writes it. Guard test in
`prompts.test.ts`: the rule text is present; a reply without `structure`
still parses.

Deterministic fallback (`structure-from-text.ts`): headings from `## `,
roles from `Company | Location` + `Title | Dates` pairs, bullets from `- `;
used when the scan has not run or dropped everything.

### 6.4 Style inference (`src/resume/style-infer.ts`, pure)

```ts
export interface InferredStyle { fontFamily: string | null; bodyPt: number | null; namePt: number | null; headingPt: number | null; accentHex: string | null; marginsIn: number | null; nameCentered: boolean | null; source: 'docx' | 'pdf' | 'none' }
export function inferFromDocx(bytes: Buffer): InferredStyle
export async function inferFromPdf(bytes: Buffer): Promise<InferredStyle>
```
docx: `styles.xml` docDefaults + Normal + Heading styles for fonts and
sizes, `w:color` on heading runs for the accent, `w:pgMar` for margins,
`w:jc center` on the first paragraph. pdf: `page.getTextContent()` items
with `styles[fontName].fontFamily` and the transform's scale; body size is
the mode, name size the maximum on page 1; no colour. Map the family to the
bundled list (Arial / Helvetica / Calibri → the sans face; Georgia / Times
→ a serif face if bundled, else the sans face) and keep the original name
for the label ("Your resume uses Calibri; the closest bundled face is
Source Sans 3").

### 6.5 Renderers

`src/resume/render/clean-docx.ts`: `renderDocx(resume: JsonResume, knobs: RenderKnobs) → Buffer` with the `docx` library: one section, margins from knobs, `styles.default.document.run` font + size, headings as bold paragraphs with spacing, bullets through a single numbering definition, `creator` / `lastModifiedBy` / `title` from `basics`. No tables, no text boxes, no headers.

`src/resume/render/clean-pdf.ts`: `renderPdf(resume, knobs) → Promise<Buffer>` with pdfkit: `new PDFDocument({ size: knobs.page, margins, info: { Title, Author, Producer: '', Creator: '' } })`, the bundled TTF registered for regular and bold, `doc.text` with `width` for wrapping, bullets through `doc.list` or a manual "• " with hanging indent, page breaks automatic.

`RenderKnobs`: `{ fontFamily, bodyPt, accentHex | null, marginsIn, sectionOrder, dateFormat, nameCentered, page: 'LETTER' | 'A4' }`, defaults from `InferredStyle`, then the user's edits (stored in `AppSettings` JSON as `renderKnobs` per resume id, or in the form only; owner decides).

### 6.6 Routes and page

`GET /resumes/:id/render`: the knob form prefilled, the parsed structure
(editable text areas per section for the mis-split case), a plain-text
preview of "what the ATS sees" produced by rendering to docx and running
`docxToText` on it (sub-second). `POST /resumes/:id/render` with
`format=docx|pdf` downloads; `save=1` creates a new Resume row from the
.docx so the loop continues on it. The target page and `/resumes/:id`
link to it for PDF-only and structural files: "Clean version in your
typeface".

### 6.7 Dockerfile

Copy `src/resume/fonts/` into the runtime image beside `src/web/public`
(same COPY pattern); the licence file ships with the fonts.

### 6.8 Verification

Unit: renderers produce parseable files (round trip through `docxToText`
and `pdfToText`), the anchoring guard, the inference on the three fixtures
and on a pdf fixture. Live: render the three stored resumes, open the
outputs in Word, Pages, Preview and LibreOffice, check Cyrillic in a name,
run `parse-warnings` on the outputs; `bench:resume` unaffected (the scan
prompt is not benched; run one scan and inspect the structure).

### 6.9 ADR 0039 and release

"Resumes render from JSON Resume through `docx` and pdfkit; metadata per
library." Records the dependencies, the font, the WinAnsi limitation and
its fix, the Typst comparison result, the honest label. CHANGELOG + minor
bump + tag.

**Shipped as [ADR 0039](./adr/0039-clean-render-from-json-resume.md)**
(v1.55.0). Three things in §6 above were wrong and the branch says why:
§6.4's docx recipe reads the style sheet, which on the corpus file names a
different font and size from the runs; §6.4's PDF recipe reads
`styles[fontName].fontFamily`, which only ever returns `sans-serif`; and the
WinAnsi worry is not the failure mode — the real one was Word formula objects
leaving MATHEMATICAL ITALIC letters that no bundled face can draw
(`render/drawable.ts`).

---

## 7. Optional: the LibreOffice profile

Only if owner question 4 says the Word export step hurts. A compose service
`pdf` on a Debian-slim LibreOffice image, `profiles: [pdf]`, no ports; the
web container calls it through a shared volume and `docker compose exec`
is not available from inside a container, so the conversion runs as a tiny
HTTP shim in that image (one POST, returns the PDF) or through a watched
folder. Producer "LibreOffice"; the metadata is then stamped with pdf-lib
or left as is. Decide when needed; do not build ahead.

---

## 8. Cross-cutting rules

- **Names and copy.** "Copy", "Locate", "Apply", "Edit & apply", "Skip",
  "Remove", "Add to Skills", "Undo", "Save as vN (.docx)", "Save as a
  tailored copy", "Clean version in your typeface", "Fix document
  properties". Never "AI" in a file, never "regenerate" for a patch.
- **No-JS.** Copy, Locate, Apply are JavaScript by nature; Save, Download,
  Fix properties and the render form are plain forms.
- **localStorage keys.** `target-draft:<matchId>` (exists),
  `target-edits:<matchId>` (stage 2). Both cleared by Discard.
- **Runs.** Patched saves and renders ride the existing run registry; no
  new registry.
- **Logging.** One `logger.info` per patched save with the report counts;
  one per render with format and size; gate counts in stage 3.
- **Security.** Uploaded .docx files are user-owned bytes; `jszip` reads
  them with a cap (`MAX_UPLOAD_MB` already bounds the file; add an
  uncompressed-size cap of 50 MB against zip bombs). No external fetch
  anywhere in these stages.
- **Performance.** Template check and patch: milliseconds on a 43 KB file;
  render: under a second. Anything slower is a bug, not a run.
- **Docs per stage.** CLAUDE.md rows in both tables, SPEC.md, README feature
  list, CHANGELOG + bump, the ADR named for the stage, TASKS §18 ticks.

---

## 9. Risks and where each one is retired

| Risk | Retired by |
|---|---|
| The proposal extractor misreads a `what` | stage 1 tests on the real shapes; stage 3 makes the field explicit |
| A replacement invents a number | stage 3 gate; the question fallback |
| xmldom changes untouched XML | stage 4 pre-work fidelity proof; raw bytes for every part but `document.xml` |
| A patched file opens differently in Word and Pages | stage 4 verification opens both; the twin fixture keeps tabbed headers and the 1×2 table |
| The template check calls a flow file structural | fixtures for the three kinds; the verdict says what it counted |
| pdfkit tofu on Cyrillic | the bundled OFL face; a test renders a Cyrillic name |
| The `structure` block rewrites a bullet | the anchoring guard drops unanchored strings |
| Users expect "my template" from the re-render | the label and the preview; the plan's §5 wording in the UI |
| Dependency drift | exact pins; the ADRs list versions; `npm audit` in the PR body |

---

## 10. Release notes drafts

- **Stage 1.** Suggestions you can take with you: every proposed wording
  has a Copy button, Locate shows the line without moving the page, and
  "Copy all suggestions" / "Copy my changes" give you the edit list for
  Word, Canva or Google Docs.
- **Stage 2.** Apply a suggestion, remove a line, add a missing keyword to
  Skills, undo any of it; nothing is saved until you save.
- **Stage 3.** The analysis now proposes the exact wording and the fact
  checker decides what is safe to apply; a proposal that needs a number you
  have not given becomes a question.
- **Stage 4.** Save returns your own .docx with the edits in place when the
  file allows it; the resume page tells you beforehand what is editable in
  place, and can fix template junk in the document properties.
- **Stage 5.** A clean single-column version of any resume in your own
  typeface, as .docx and .pdf, for files that cannot be patched.
