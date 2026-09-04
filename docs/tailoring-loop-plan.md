# The tailoring loop: apply, copy, save, export (plan)

> Analysis 2026-09-03, nothing built. Answers four questions the owner asked
> about `/target` → `/jobs/:id/target`: can the user apply the AI's edit
> suggestions with a click and save the result as a file; is the
> linkedin-radar "resume regeneration service" worth reusing; do ATS block
> "AI-generated" files; and how should the page serve someone who edits by
> hand, with every user on a different template. Backlog ticks live in
> [TASKS.md §18](./TASKS.md); the file-by-file build guide is
> [tailoring-loop-integration.md](./tailoring-loop-integration.md). Pairs with
> [ADR 0010](./adr/0010-two-scores-live-keywords-vs-ai-match.md),
> [ADR 0012](./adr/0012-deterministic-match-score.md),
> [ADR 0020](./adr/0020-fact-gate-blocks-fabrication-not-imprecision.md),
> [ADR 0029](./adr/0029-quick-check-and-lazy-suggestions.md),
> [ADR 0030](./adr/0030-resume-strength-review.md), the
> [resume-match UX audit](./archive/applypack-resume-match-ux-refactor.md)
> and [resume-ats-blueprint.md §29–30](./resume-ats-blueprint.md).
> The published report this plan condenses: «The Tailoring Loop»
> (claude.ai artifact 3715b171-b31e-4911-af4e-126caa75cc5b).

**Ground rules for everything below**

- **Analyse before every stage, in writing.** Each stage in the integration
  guide opens with a pre-work checklist; its result is a 10–20 line analysis
  note at the top of the PR body (what the plan assumed, what differs today,
  which simpler alternative lost and why).
- **The user's own file first.** A tailored resume is the user's document
  with edited strings, never a re-typeset copy, wherever the file allows it.
  When it does not, the page says so before the user starts.
- **The fact gate stays in code.** Wording the model proposes enters the
  resume only after `fact-check.ts` has read it (ADR 0020). A proposal the
  gate blocks is shown as a question, never as an Apply button.
- **Libraries where a library exists.** `docx`, `pdfkit`, `@xmldom/xmldom`
  and `jszip` do their jobs; the one piece no library does (replacing text
  inside an arbitrary existing .docx with its formatting intact) stays
  in-house and small.
- **No hidden text, no tool name in a file, no external service.** The
  metadata policy in §2 binds every writer; the resume never leaves the box.
- **Facts expire.** Every count and library fact below was observed on
  2026-09-03. Re-verify at implementation time.

---

## 0. Facts established (don't re-derive)

### 0.1 What `/jobs/:id/target` does today

| Capability | State | Where |
|---|---|---|
| Plain-text editor with live highlights | shipped | `pages/target.tsx`, `public/target-page.mjs` |
| Live score while typing, same formula as the AI score | shipped | `public/score.mjs`, parity test vs `score.ts` (ADR 0012) |
| Click a suggestion → its quoted text is selected in the editor | shipped | `locateQuote` in `target.mjs`; audit §6.1/6.2 |
| Missing-keyword chips jump to the section the AI named | shipped | `jumpToSection` |
| Draft survives reloads; Re-check with AI; Save as vN | shipped | localStorage per match; `POST /resumes/:id/draft` |
| Copy the proposed wording | **missing** | the wording sits inside an instruction sentence in a clickable list item; no Copy anywhere |
| Apply a suggestion to the text | **missing** | the audit specified `[Apply] [Edit] [Skip]`; only the jump shipped |
| Add a missing keyword into the text | **missing** | chips only navigate |
| A file after Save | text only | Save writes a `.md` version; Download returns the original upload, never the edit (ADR 0010: "there is no .docx to update") |
| `.docx` export | closed 2026-09-01 | TASKS §5.10: a plaintext dump loses the design; format-preserving patching is "big-ticket XML surgery"; reopen trigger: the paste workflow hurting |
| AI-written tailored resume | closed 2026-09-01 | TASKS §5.15: auto-rewriting reopens the hallucination surface; reopen trigger: manual tailoring too slow |

This request is the reopen trigger for both closed items, in a narrower
form than either: the user picks each edit, the model only proposes wording,
and the file keeps the user's design.

### 0.2 The suggestion contract

| Field | Shape | Applicable as-is? |
|---|---|---|
| `actions[]` | `section · where · what · why · priority · quote\|null` | partly. `quote` is verbatim (the editor finds it), `what` is prose: "Reword as: "…"", "Change title to "…"", "Add: "…"". Measured on the two stored full analyses (matches 59 and 68): **16 of 18 actions carry the proposal as a quoted string inside `what`**; the two that do not are conditional ("if accurate, add RabbitMQ…"). No `replacement` field exists. |
| `removals[]` | `section · where · what · why · quote` | yes. The quote is the text to delete (5–182 characters on match 59); two prompt rules protect the contact line and wanted keywords. The card does not show the quote. |
| `keywords[]` | `term · requirement · status present\|add\|ask_user\|cannot_claim · where · aliases` | yes, deterministically. `add` = evidenced but unwritten; `ask_user` has a confirm flow; `cannot_claim` must never get a button. |
| `review.advice[]` | `… example\|null · ask\|null · quote` | the precedent (ADR 0030): a rewrite built only from facts in the resume, or a question for the missing number. Exactly the contract the actions need. |

### 0.3 Building blocks already in the tree

| Module | What it does | Reused for |
|---|---|---|
| `resume/zip.ts`, `zip-write.ts` | read one zip entry; write a deterministic STORED zip | the letter writers keep them; the patcher uses `jszip` (§4) |
| `resume/docx-text.ts` | WordprocessingML → text: one line per paragraph, `- ` for list items, `## ` for headings, table rows as `cell \| cell`, tabs as ` \| ` | the paragraph ↔ editor-line map; the round-trip gate; the template check |
| `resume/docx-write.ts`, `pdf-write.ts` | letter → minimal .docx (no docProps) / PDF 1.4 Helvetica-only (no /Info) | stay for letters; resumes go through libraries |
| `resume/fact-check.ts` | pure fabrication gate: pass / warn / block over numbers, denied terms, employers (ADR 0020) | every replacement the model proposes |
| `prompts.ts:toPlainPunctuation` | NFKC, dashes, curly quotes, NBSP, zero-width, emoji → plain keyboard text | the hygiene gate on inserted text |
| `resume/parse-warnings.ts` | deterministic "what the ATS sees" checks over the text | the export report; gains a structural sibling for .docx (§5) |
| `target.mjs:locateQuote` | exact, then whitespace/punctuation-insensitive match of a quote in the text | Locate and Apply; the "couldn't find it" fallback |
| `resume/pdf-text.ts` (unpdf) | PDF text via pdf.js; the same proxy exposes per-item font names and sizes | typography inference for PDF-only users (§5) |
| `web/target-runs.ts`, `draft-stash.ts` | in-memory run registry and one-shot draft hand-off | patched saves ride the existing draft run |

### 0.4 The live corpus (port 5433, read-only)

| id | Resume | ver | Stored file | bytes | chars | Patchable in place? |
|---|---|---|---|---|---|---|
| 1 | Senior Backend PHP | 4 | `.docx` (mime stored as `application/octet-stream`) | 43 440 | 6 004 | yes |
| 4 | scratch row (hidden, /target) | 19 | `.pdf` | 122 856 | 5 975 | no |
| 5 | PHP/JS/React | 1 | `.pdf` | 122 631 | 5 908 | no |
| 8 | with photo | 1 | `.pdf`, 1 image | 269 098 | 6 338 | no |

Two of three visible resumes are PDFs printed from macOS. A docx patcher
alone covers a third of today's corpus; the product has to ask for the .docx
source when it wants to return a styled file.

**Resume 1, the one .docx, measured:** 89 paragraphs, 527 runs, 31 of 65
non-empty paragraphs split into more than three runs (Word fragmentation:
string replacement must map across runs); 24 numbered bullets; one table
(KEY SKILLS as a single row with two cells, every label stacked in the left
cell); 2 Office Math objects; 100 literal tabs aligning company/location and
title/dates; 2 hyperlinks; 2 non-breaking spaces; no text boxes, drawings,
headers or footers; Arial throughout. `docx-text` renders it as 78 lines:
four section headings, 24 bullets, role headers as `Company | Location`
lines, the skills table as one glued label line plus one value line.

Its `docProps/core.xml` still carries a third-party template's junk: a
street address as the title, a stranger's first name as the creator, "a
draft of … Resume Template" as the description; `app.xml` says Microsoft
Office Word 16. This is the defect linkedin-radar's `clean_docx_metadata.py`
exists for, live in the database today.

The three PDFs carry `/Producer (macOS Version 26.3.1 … Quartz PDFContext)`,
no Creator, no Author, no Title, no XMP: a Pages or Preview export, and the
most "human" fingerprint a PDF can have.

**ApplyPack's own exports carry nothing.** `pdf-write.ts` emits no `/Info`
dictionary; `docx-write.ts` emits no `docProps` part.

---

## 1. The linkedin-radar `job-apply` skill, checked

What the request calls "the service that regenerates PDFs" is
`.claude/skills/job-apply/` in `~/main/linkedin-radar`: a `SKILL.md`
pipeline, two rulebooks (`ats-rules.md`, `us-resume-format.md`), a ghost-job
checklist and nine stdlib-Python scripts. Last used 2026-08-02 (six rows in
its applications log). The pipeline, in its own order:

1. Verify the posting is real (job-verifier subagent).
2. Pick a master from six markdown masters, each naming its styled source .docx.
3. Write the analysis first: recruiter appeal + ATS keyword map (present / add / cannot claim).
4. Tailor per the analysis only: title, summary, skills order, top-2 roles' bullets, stack lines; older roles verbatim.
5. `patch_resume_docx.py`: paragraph-level text replacement mapped back onto fragmented runs; styles / numbering / settings byte-identical.
6. `set_skills_table.py`, `fix_role_header_tabs.py`, `tighten_layout.py`, `replace_math_with_text.py`, `insert_role_block.py`, `delete_paragraphs.py`: structural repairs of one specific template.
7. `clean_docx_metadata.py`: rewrite core.xml / app.xml only; `word/*` byte-identical.
8. `check_text_hygiene.py`: every run printable ASCII plus the template's two separators; NBSP, soft hyphen, zero-width and curly quotes fail the build.
9. ATS gates: extracted text equals the markdown; every P1 keyword present or listed as "missing, no evidence"; exactly 2 pages; human voice.
10. `resume.pdf`: Word render preferred, Pages export via `osascript` as fallback, PDFKit stamps Title/Author. macOS only.

| Piece | Generic? | Take it? |
|---|---|---|
| Run-mapped paragraph replacement | yes, any .docx | the idea; rewritten over a DOM in TS |
| Byte-identical style parts gate | yes | port |
| Extracted-text round-trip gate | yes | port; the extractor exists |
| Hygiene gate | yes | port, over new text only |
| Metadata cleaning | yes | port as an opt-in "fix document properties" |
| Skills-table rebuild, role-header tables, layout tightening, the page-2 break | no: hard-coded labels, colours, twips, a company name that must start page 2 | leave; a generic patcher must not restyle |
| Math-to-text flattening | yes | later: a warning first |
| Word / Pages PDF render | no: AppleScript | impossible in Docker; LibreOffice is the container equivalent (§4) |
| Rulebooks | mostly | already absorbed into `prompts.ts`; one claim does not hold up (§2) |

House rule: other `~/main` projects are studied for logic and implemented
independently. Here the rule has a second reason: the Python is regex over
XML tuned to one file.

---

## 2. The "AI-marked file" question, answered

| Claim | Status | Sources say |
|---|---|---|
| ATS reject AI-written resumes | myth | Jobscan (25 US recruiters) and Enhancv (ten largest systems) found no authorship feature in any major ATS in 2026; Workday scores fit, Greenhouse's 2025 AI suite has no authorship filter, Lever's AI is sourcing. Vendors avoid it because false positives on human text would be catastrophic. [S1, S2] |
| A "generated" PDF or DOCX carries a mark | half true | the mark is the library's: python-docx writes creator `python-docx` [S5], pdf-lib names itself in Producer [S6], `docx` writes creator "Un-named" [S17], pdfkit writes Producer and Creator "PDFKit" [S18]; ChatGPT's sandbox uses python-docx and ReportLab [S7]. Parsers do not reject on those fields; a recruiter opening File → Properties reads them. [S7, S8] |
| Hidden or white keywords are detected | fact | Greenhouse: about 1% of ~300 million resumes in H1 2025 carried white-text messages [S3]; 2026 guides report Workday's 2025 "content integrity check" and iCIMS data on flagged resumes [S4]. No vendor-primary source for the Workday check; treat the mechanism as reported, the risk as real. |
| Formatting breaks the parse | fact, the real risk | single-column .docx 97.4% of seeded fields vs two-column PDF 71.2% in one 2026 test; DOCX parses at least as well as PDF on Workday, Taleo and iCIMS, equally on Greenhouse. [S9, S10] |
| Text-level AI detectors on the prose | human-side risk | some recruiters run GPTZero-class tools on the text. Keep the candidate's own phrasing; the prompt rules already enforce that. |

One rulebook claim does not hold up: linkedin-radar's `ats-rules.md` says
"since late 2025 major ATS vendors ship AI-content classifiers … 77% of
employers scan for AI-generated content". No 2026 source supports
vendor-side classifiers; the 77% is survey talk about recruiters. Keep the
human-voice rule, drop the vendor claim if the rulebook is ever ported.

**So the generation method is not the risk. Three things are:** hidden text
(this design writes only visible text and refuses zero-width / NBSP / soft
hyphen in inserted text); layout the parser cannot walk (patching changes no
layout; re-rendering is single-column by construction); metadata that names
a tool (policy below).

### Metadata policy for every file ApplyPack writes

| File | Do | Never |
|---|---|---|
| Patched .docx | keep the user's `core.xml` creator and `app.xml`; refresh `dcterms:modified`; offer a one-click "fix document properties" (title = resume name, creator / lastModifiedBy = candidate) when the file carries template junk | write "ApplyPack", a model name or "AI" anywhere; touch `word/*` when only properties change |
| Generated .docx (`docx` library) | pass `creator`, `lastModifiedBy`, `title` from the resume so "Un-named" never ships | invent an Application value; an empty field is honest, a spoofed "Microsoft Office Word" is not |
| Generated .pdf (pdfkit or Typst) | write `/Title` and `/Author` from the resume; set pdfkit `info.Producer` and `info.Creator` to empty; check what Typst leaves in `/Producer` before choosing it | spoof a Word or Quartz producer string |
| Any file | plain visible text only; the export report lists what was checked | white text, tiny fonts, keyword blocks, injected instructions for screeners |

---

## 3. Where the file comes from

| Option | Keeps the user's design | Covers | Hallucination surface | Effort / deps | Verdict |
|---|---|---|---|---|---|
| A · text version only (today) | n/a | everything | none | 0 | the status quo the request rejects |
| A′ · change sheet: the edits as a copyable list | n/a, the user applies them in their own tool | everything, Canva and Google Docs included | none | small; pure line diff + Copy | **build first**; the universal manual path |
| B · re-render from a structured model into a clean template | typography yes, layout no | every original, once parsed | parsing errors, not fabrication | medium with libraries: `docx` + pdfkit, JSON Resume as the model | the offer for PDF-only users, labelled "clean version in your typeface" |
| C · patch the user's .docx in place | yes, byte-identical styles | flow .docx fully; structural .docx partly; PDF users upload the .docx source | none added; the text is what the user accepted | medium: ~250 lines over xmldom; no new runtime | **recommended** |
| D · recreate the user's own layout automatically | promises what it cannot keep | — | — | a layout engine; endless | no; §5 says what "like theirs" can mean |
| E · external tailoring service or API | none preserve it | — | theirs | the resume leaves the box | no; contrary to "your data in your own Postgres" |

**Decision.** A′ and C, then B for everyone C cannot serve, with a clear
label. DOCX is the primary deliverable: ATS parse it best, and the user's
own Word or Pages turns it into the most natural PDF there is.

Commercial tools (Jobscan Power Edit, Teal, Rezi, Kickresume, Enhancv) all
show the resume as plain text or in their own builder, accept or reject per
suggestion with a live match rate, and export their own rendering; none
preserves the original file [S11, S12]. Open-source builders (Reactive
Resume, OpenResume, RenderCV, JSON Resume) replace the file too [S13, S14].
The UX pattern is worth copying; the file model is not.

---

## 4. Libraries, not hand-rolled writers

| Job | Library | Licence · size | Metadata it writes by default | Verdict |
|---|---|---|---|---|
| Generate a .docx from a structured resume | [`docx`](https://github.com/dolanmiu/docx) (dolanmiu) 9.7.x: paragraphs, numbering, tables, styles, fonts by name | MIT · pure JS, a few deps (jszip among them) | `dc:creator` "Un-named" unless `creator` is set [S17] | **adopt** for resumes |
| Change text inside an existing .docx, formatting intact | `docx.patchDocument` replaces `{{placeholders}}` only [S19]; docxtemplater core is tags only, its search-and-replace lives in the paid Meta module [S20]; python-docx has a run-level API with the same fragmentation problem and needs a Python runtime | — | — | **no fit**; the patcher stays in-house |
| Walk and edit WordprocessingML safely | [`@xmldom/xmldom`](https://www.npmjs.com/package/@xmldom/xmldom) (DOM) + `jszip` for the container | MIT · small | none | **adopt for the patcher**; prove untouched-part fidelity in the first test |
| Generate a PDF from a structured resume | [`pdfkit`](https://pdfkit.org/): text layout, wrapping, bold/italic by font, TTF embedding; pdfmake sits on top with a declarative layout | MIT · ~2 MB with fontkit | Producer and Creator "PDFKit", overridable via `info` [S18] | **adopt pdfkit**; the standard 14 fonts are WinAnsi only, so a Ukrainian name needs one embedded OFL face (about 1 MB per face) |
| Typeset PDF with real typography | Typst via [`@myriaddreamin/typst-ts-node-compiler`](https://www.npmjs.com/package/@myriaddreamin/typst-ts-node-compiler) (WASM, no sidecar); Typst Universe has `basic-resume`, `simple-technical-resume`, `jsume` (takes JSON Resume) [S21] | Apache-2.0 · tens of MB plus fonts you supply | a Typst producer string; check whether it can be blanked | alternative to pdfkit; decide in stage 5 by rendering the same JSON Resume both ways |
| .docx → .pdf with Word-like fidelity | LibreOffice headless as a compose service | MPL · about 240 MB as a Debian-slim image [S22] | Producer "LibreOffice x.y" | optional profile, only if "export the PDF from Word yourself" hurts |
| HTML → PDF | Puppeteer / Playwright with Chromium | the Alpine Chrome image alone is 423 MB compressed [S14] | Producer "Skia/PDF" | no |
| Low-level PDF editing | pdf-lib | MIT | Producer names itself [S6] | not needed |
| Parse a resume into a structure | OpenResume's parser is AGPL-3.0 [S23]; resume-parsing APIs send the file out | AGPL | — | no; the AI scan already reads the resume and gains a `structure` block (§5) |
| The structured model itself | [JSON Resume](https://jsonresume.org/schema): an open schema with a DOCX renderer (`jsonresume-docx`) and Typst templates written against it [S24, S21] | open standard | — | **adopt as the model** |

What this changes against the first draft of this plan: stage 5 renders
JSON Resume through `docx` and pdfkit instead of extending `pdf-write.ts`;
the patcher gets a DOM; the in-house letter writers stay because they work
and carry no fingerprint; one ADR records the dependencies and the metadata
rule per library.

---

## 5. Every user has a different template

"Users have different templates" hides three situations.

| The file the user has | How common | In-place patch | What the user gets |
|---|---|---|---|
| Flow-based .docx | the "Simple / Traditional / Chronological" template family; anything written top to bottom [S25] | full | the styled file back, every edited line in place |
| Structural .docx: tables for layout, text boxes, sidebars, two columns, contact in the header | most of Word's own gallery and most "ATS-friendly" downloads, which real parsers read badly too [S25] | partial: table-cell text yes; text boxes, headers and footers no (the extractor never showed them, so the editor never had them) | the file back with the patchable lines changed, the change sheet for the rest, a warning that text-box content is invisible to ATS parsers as well |
| PDF only: Canva, Pages, Google Docs export, a designer's file | two of the three resumes in the live database | none | the change sheet, and the offer of a clean single-column re-render in their typography |

**The check that sorts a file into a row is deterministic and cheap:**
counts of `w:tbl`, `txbxContent`, `w:drawing`, `w:cols`, header and footer
text, `m:oMath`, hidden runs (`w:vanish`), white-on-white runs
(`w:color FFFFFF`), tiny sizes (`w:sz` under 12). It is the DOCX half of the
blueprint's parseability analyser (§29.2) that `parse-warnings.ts` never
got. It runs at upload, so `/resumes/:id` can say "In-place editing: 61 of
78 lines. The skills table is editable; the header block is not", and the
target page repeats the one-line verdict above the editor.

**"Analyse their template and make one like it", honestly.** Inferable and
reproducible: typeface family and sizes for name, headings and body (from
`styles.xml` in a .docx; from pdf.js font names and transforms in a PDF,
which unpdf exposes); accent colour (docx only; pdf.js text content carries
no fill colour); margins; section order and headings; date format; bullet
glyph; whether the name is centred. Not reproducible and not to be promised:
two-column and sidebar layouts, icons, skill bars, photos, decorative rules,
exact line breaks and pagination. Those are the ATS-hostile parts anyway.

So the third path is **style inference → a handful of knobs → preview →
export**: the inferred values pre-fill the knobs (font, size, colour,
margins, section order), the user adjusts nothing or one thing, the preview
shows "how it looks" and "what the ATS sees", the export goes through
`docx` and pdfkit. The button says "Clean version in your typeface", never
"Your template". A user who wants their exact Canva design keeps Canva and
the change sheet beside it. "Tell users to configure everything" fails for
the same reason a template language would: the daily user will not learn
it; the knobs are the whole configuration surface.

**Getting the structure for the re-render.** The scan prompt gains a
`structure` block shaped as JSON Resume (`basics`, `work[]`, `education[]`,
`skills[]`); `docx-text`'s headings, bullets and `Company | Location` lines
give a deterministic fallback. Every string in the structure must be a
verbatim span of the resume text, checked in code the way keyword terms are
anchored today, so the model cannot rewrite a bullet on the way through.
The user sees the parsed structure once, in the knob view, and fixes a
mis-split role there.

**Verification, whichever path produced the file:** run the app's own
extractor on the output and compare with the editor text; show "what the
ATS sees" of the exported file; run `parse-warnings` plus the structural
check on the output; once, by hand, the blueprint's parser-disagreement test
(our extractor against `libreoffice --convert-to txt`) on the real files.

---

## 6. The page today, reviewed

Reviewed live on 2026-09-03: `/jobs/1393/target?match=59` (full analysis,
10 edits, 8 removals, 26 keywords) in the desktop app's browser pane at
800 px and 375 px, plus the source of `target.tsx`, `target-page.mjs` and
`resume-match-card.tsx`. Format per the `ui-review` skill.

**Overall impression.** The decision layer above the tabs (score, verdict
sentence, breakdown chips, gates, confirm questions) reads in one pass and
matches the product. The Suggestions tab explains every edit well and helps
with none of them; on anything narrower than a wide desktop its one
interaction moves the user away from the advice.

**First-screen verdict.** Desktop: 66 of 100, moderate, primary stack 2/2,
ten edits and eight removals one click away. 375 px: the ring, the number
and the verdict land first; "Re-upload resume" is the only visible button,
so the first screen says "upload something" to a user who came to edit; the
Suggestions tab sits below the fold and, once opened, puts every card and
the whole keyword table above an editor the user reaches after four screens.

**Critical**

1. *Clicking a card takes the user away from the proposal.* The handler
   calls `select()`, which focuses the textarea; the browser scrolls the
   focused control into view. At 800 px and below the editor sits under the
   whole advice column, so the screen jumps past the card (observed live);
   on a wide desktop focus leaves the card. Nothing on the page copies the
   proposal. Fix: split the click into **Copy** (clipboard, "Copied" inline)
   and **Locate** (outline the span in the backdrop, scroll the editor's own
   `scrollTop`, `focus({ preventScroll: true })` on wide screens only).
2. *The wording is buried in an instruction sentence.* "Reword as: "…"" is
   one 14 px paragraph; copying the quoted part means precise selection
   inside a line, a fight with selection handles on a phone. Fix: each card
   renders **Now** (the quote) and **Proposed** (the quoted string parsed
   out of `what` today, the `replacement` field after prompt v7) as two
   blocks with Copy on Proposed; the leading verb becomes the label.
   Removals show their quote under **Remove**.
3. *The cards are not keyboard-reachable.* A list item with a click handler
   has no role, no focus state, no key handling; the only hint is a `title`
   tooltip touch screens never show (`accessible-interactions`). Fix: real
   `<button>` elements from the `Button` primitive; the list item stops
   being clickable.

**High impact**

4. *The selection is invisible.* The textarea text is transparent and its
   `::selection` is a 25% tint under the backdrop marks; the located title
   line showed only its green "matched" mark. Fix: a `.located` class on the
   backdrop span (2 px accent outline, 2 s fade, reduced-motion aware) and
   "line N" on the card; on a miss the card says "Couldn't find this text in
   the editor, it may already be edited" instead of the 1.2 s pulse.
5. *Advice and editor cannot be seen together on a phone.* With Copy on
   every card the manual path no longer needs the editor. For the Apply
   path: on narrow screens the editor card comes first, collapsed to about
   40 vh with "Expand"; the keyword table folds behind a disclosure.
6. *Chips navigate and do nothing else.* Fix: a chip's click inserts the
   term into the skills line for `add` and confirmed terms (stage 2); until
   then a Copy affordance and the weight / count shown as a line under the
   chips on touch.
7. *There is no way to take the work out of the page.* A user editing in
   Word, Canva or Google Docs needs the edit list beside their document.
   Fix: a **change sheet**: "Copy all suggestions" (Markdown: section, Now,
   Proposed, why) and, after edits, "Copy my changes" from a line diff of
   analysed against edited text (Now → New). Pure functions; the same diff
   later feeds the .docx patcher.

**Polish.** The 64 px priority column holds one word; "why:" in 12 px faint
ink names the posting requirement, which is the reason to accept the edit:
badge inline with the section label, the requirement as a small pill under
Proposed. "show matched highlights" lives on the tab row far from the panes
and wraps as an orphan at 375 px: move it into the editor header. The
primary button says "Re-upload" on a page whose task is editing: once Apply
exists, "Save as vN (.docx)" in the dirty bar is the primary and Re-upload
moves into the menu. Removal cards hide the quote they point at in a data
attribute: show it dimmed and struck through.

**Quick wins.** Copy per action with the quoted span extracted by one
regex; `focus({ preventScroll: true })` and editor-internal scrolling;
`<button>` semantics on cards and chips; the removal quote on the card;
"Couldn't find this text" as inline copy; the toggle moved.

**Score.** Hierarchy 7, consistency 8, accessibility 5, polish 6.

---

## 7. Decisions this plan makes

1. Copy and Locate are separate controls; Locate never moves the page.
2. Every action card shows Now and Proposed; the proposal is a first-class
   string (parsed from `what` until prompt v7 adds `replacement`).
3. The change sheet is the universal manual path and ships before Apply.
4. Apply, Remove, Add to Skills, Undo are client-side text operations over
   the plain-text editor; nothing is saved until Save.
5. The model returns `replacement` and `insert_after`; `fact-check.ts`
   decides at persist time whether a proposal is applicable; blocked
   proposals become questions.
6. Keyword additions are deterministic; only `add` and confirmed
   `ask_user` terms get a button; `cannot_claim` never does.
7. Save patches the user's .docx in place when the template check allows
   it; every other case saves a text version and says why.
8. The patcher is in-house over `@xmldom/xmldom` + `jszip`; generation uses
   `docx` and `pdfkit`; JSON Resume is the structured model; no external
   service; LibreOffice only as an optional profile.
9. The metadata policy in §2 binds every writer; no hidden text, ever.
10. For PDF-only and structural files the product offers a clean
    single-column re-render in the user's typography, labelled as such.
11. A tailored edit saves as a copy per posting by default (owner to
    confirm, §8).

---

## 8. Open questions for the owner

1. **Copy or version** when saving a tailored edit? Recommendation: a
   tailored copy per posting, the master untouched.
2. **Fix junk document properties** on the first patched save, or only on
   click? Recommendation: on click, with the current values shown.
3. **PDF engine for stage 5:** pdfkit (small, plain output) or Typst through
   WASM (typeset, heavier)? Recommendation: pdfkit first.
4. **PDF from a patched .docx:** accept "export it from Word or Pages" as the
   v1 answer, or is the LibreOffice profile a launch requirement?
5. **Tables in v1 of the patcher:** cell text edits only, or refuse tables
   until v2?
6. **Reordering scope:** "Make this the first bullet" only, or free ↑ ↓ on
   any line?
7. **Stage order:** stages 1 and 2 could ship as one branch; separate keeps
   the page fixes releasable in a day.

---

## 9. Sources

- S1 [Jobscan, "Can ATS Detect AI Resumes in 2026?"](https://www.jobscan.co/blog/can-ats-detect-ai-resume/)
- S2 [Enhancv, "Does ATS Detect AI Resumes? We Researched the Top 10 Systems"](https://enhancv.com/blog/ats-detect-ai-resume/)
- S3 [AI and You, on Greenhouse's white-text disclosure](https://aiandyou.org/news/recruiters_say_hiding_ai-friendly_white_text_in_your_resume_is_not_going_to_work_these_new_hires_say_otherwise/)
- S4 [The Interview Guys](https://blog.theinterviewguys.com/job-seekers-are-hiding-secret-text-in-their-resumes/), [Hiration](https://www.hiration.com/blog/white-text-resume-hack/), [Resume Optimizer Pro](https://resumeoptimizerpro.com/blog/ats-friendly-resume-tips) on hidden-text detection (secondary sources)
- S5 [python-docx, Core Document Properties](https://python-docx.readthedocs.io/en/latest/dev/analysis/features/coreprops.html)
- S6 [pdf-lib issue #1571](https://github.com/Hopding/pdf-lib/issues/1571)
- S7 [DEV, "From Prompts to Real Files"](https://dev.to/imaginex/your-llm-can-write-files-now-4c6e)
- S8 [SanitiDOC, "Does Your DOCX Reveal It Was Written by AI?"](https://sanitidoc.com/blog/ai-metadata.html)
- S9 [ATS Verification, "PDF vs Word Resume for ATS (2026)"](https://atsverification.com/blog/pdf-vs-word-for-ats/)
- S10 [scale.jobs, "PDF vs Word: which format ATS reads correctly"](https://scale.jobs/blog/pdf-vs-word-resume-format-ats-reads-correctly)
- S11 [Jobscan Power Edit](https://www.jobscan.co/power-edit), [One-Click Optimize](https://www.jobscan.co/one-click-optimize)
- S12 [Jobscan vs Teal (2026)](https://www.jobscan.co/blog/jobscan-vs-teal/)
- S13 [DEV, "5 Open-Source Resume Builders (2026)"](https://dev.to/srbhr/5-open-source-resume-builders-thatll-help-get-you-hired-in-2026-1b92); [Reactive Resume](https://github.com/amruthpillai/reactive-resume); [OpenResume](https://www.open-resume.com/)
- S14 [RenderCV](https://rendercv.com/); [Typst, "Automated PDF Generation"](https://typst.app/blog/2025/automated-generation/); [zenika/alpine-chrome](https://hub.docker.com/r/zenika/alpine-chrome)
- S15 [dolanmiu/docx](https://github.com/dolanmiu/docx)
- S16 [docxtemplater](https://github.com/open-xml-templating/docxtemplater)
- S17 [dolanmiu/docx discussion #2584](https://github.com/dolanmiu/docx/discussions/2584) (default creator "Un-named")
- S18 [PDFKit, Getting Started](https://pdfkit.org/docs/getting_started.html) (`info` defaults and overrides)
- S19 [docx, patchDocument](https://docx.js.org/api/functions/patchDocument.html); [issue #2855](https://github.com/dolanmiu/docx/issues/2855)
- S20 [docxtemplater Meta module](https://docxtemplater.com/modules/meta/)
- S21 [jsume](https://typst.app/universe/package/jsume/), [basic-resume](https://typst.app/universe/package/basic-resume/), [typst-jsonresume-cv](https://github.com/fruggiero/typst-jsonresume-cv), [@myriaddreamin/typst-ts-node-compiler](https://www.npmjs.com/package/@myriaddreamin/typst-ts-node-compiler)
- S22 [docx-pdf-converter-libreoffice](https://hub.docker.com/r/beladevos/docx-pdf-converter-libreoffice); [OneUptime, LibreOffice in Docker](https://oneuptime.com/blog/post/2026-02-08-how-to-run-libreoffice-in-docker-for-document-conversion/view)
- S23 [OpenResume](https://github.com/xitanggg/open-resume) (AGPL-3.0)
- S24 [jsonresume-docx](https://github.com/panasenco/jsonresume-docx); [JSON Resume projects](https://jsonresume.org/projects)
- S25 [Resume Optimizer Pro, "Microsoft Word Resume Templates: Which Ones Are ATS-Safe"](https://resumeoptimizerpro.com/blog/microsoft-word-resume-template); [ATS Verification, "Resume Templates That Pass ATS in 2026"](https://atsverification.com/blog/resume-templates-that-pass-ats-2026/)
