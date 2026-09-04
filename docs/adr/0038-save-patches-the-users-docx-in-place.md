# 0038 — Save patches the user's .docx in place; text-only versions are the fallback

**Status:** Accepted (2026-09-04). Supersedes the "a saved version is a text
file" consequence of [ADR 0010](./0010-two-scores-live-keywords-vs-ai-match.md).

## Context

Since ADR 0010 "Save as vN" on the targeted view stored the editor's text as a
`.md` version: the loop worked, and the user then retyped every accepted edit
into the Word file their resume actually lives in. TASKS §5.10 closed ".docx
export" on 2026-09-01 because a plaintext-to-docx dump saves one paste and
loses the design; it named the useful version — format-preserving patching of
the user's own file — and called it big-ticket XML surgery. §18 reopened it,
narrowly: the user picks each edit (stages 1–3), the file keeps its design.

Nothing in Node does this off the shelf. `docx`'s `patchDocument` wants
`{{placeholders}}`, docxtemplater's search-and-replace is a paid module, and
LibreOffice is a 240 MB image for a job that touches two XML parts
(tailoring-loop-plan.md §5). What the job needs is a faithful XML DOM and a
faithful zip container, and both were measured on the one `.docx` in the
corpus before a line was written (the branch's pre-work note): xmldom
reproduces `word/document.xml` — 440 text nodes, 5 439 element tags with
their attribute order, 33 namespace declarations — to one byte, the CRLF Word
writes after the XML declaration; jszip returns all 30 other parts byte for
byte. The same file has 235 of 432 `<w:t>` nodes without `xml:space="preserve"`
and keeps its skills in a 1 × 2 table, which set two of the rules below.

## Decision

1. **`@xmldom/xmldom` and `jszip`, exact versions, both pure JS.** The DOM is
   used for `word/document.xml` only; every other part is carried over as
   bytes. `docProps/core.xml` is the one exception, rewritten as a string.
2. **One reader.** `docx-text.ts` walks the DOM (`walkDocument` → blocks with
   their `w:p` nodes → `renderLines`) and the old regex reader is the
   fallback for XML the parser refuses. A parity test holds the two to the
   same text on every fixture, quirks included: a soft break inside a table
   cell splits the row's line, because every stored resume text was rendered
   that way and the patcher's first gate compares against exactly that text.
3. **The template check decides beforehand** (`docx-structure.ts`, pure, never
   stored): `flow` when there are no tables, text boxes, columns or header /
   footer text; `structural` otherwise, patched where a paragraph can be
   found; `unsupported` when the document part is missing, unparseable, or
   most of the text sits in text boxes. Resume 1 is `structural` — the
   skills table — and the card says what that means in sentences.
4. **The patcher is a line diff written back into paragraphs**
   (`docx-patch.ts`, pure): the same `diffLines` the change sheet uses, each
   `a` line mapped to the paragraph that rendered it. A change rewrites only
   the window that differs, run by run, so a bold fragment outside the edit
   keeps its run; a tabbed header is split on ` | ` and each side written into
   its own tab group; a delete removes the paragraph; an insert clones the
   paragraph above it, keeping `numPr` so a bullet after a bullet stays in the
   list. Every node written gets `xml:space="preserve"`. New text passes
   `toPlainPunctuation`; the original's characters are never touched.
5. **Refuse rather than guess.** A table row, a line inside a text box, a line
   that shares its paragraph with another, an edit that changes a line's tab
   layout, an insert inside a table — each is refused with a reason, and in
   v1 one refusal makes the whole save a text version that says why. Cell
   text edits are allowed (owner question 5); rows are not added or removed.
6. **Four gates before the bytes leave:** the analysed text must be exactly
   what the file renders to; the patched file must read back as exactly the
   edit; the counts of `oMath`, `drawing`, `txbxContent` and `vanish` must not
   move; no line may have been skipped.
7. **Save as a tailored copy is the primary action** (owner question 1, the
   plan's recommendation): a new resume named `<resume> · <company>`, the
   master untouched. "Save as vN" stays.
8. **Document properties are fixed on click only**, with the current values
   printed (owner question 2), through a bytes-only swap that bumps no version
   and triggers no re-scan — the words did not change. The metadata policy
   stands: no tool name, no hidden text, `dcterms:modified` stamped on every
   patched save.

## Consequences

- A user with a flow or structural `.docx` gets their own file back with the
  accepted edits in it, formatting intact outside the edited runs; a user
  with a PDF gets the sentence saying so and the advice to upload the `.docx`
  it was printed from.
- The v1 refusals are wide: the skills table of the only real `.docx` we have
  cannot be edited through this path, because its 8 + 8 cell paragraphs
  render as one line that cannot be split back. That line was never sanely
  editable as text anyway; it is the shape stage 5 exists to re-render.
- The parity test pins the old reader's quirks. Fixing them is a prompt-bump
  class change: every stored `resumeText` would stop matching its file.
- Two dependencies (jszip 3.10.1, @xmldom/xmldom 0.9.12), no native code, no
  Dockerfile change, no migration.
- Alternatives considered: writing the whole paragraph's text into its first
  run (loses every bold word; rejected in favour of the changed-window
  write); allowing partial patches with a report (rejected for v1 — a file
  half-edited and a text version that says why are not the same promise);
  LibreOffice for the PDF (deferred to the plan's optional profile).
