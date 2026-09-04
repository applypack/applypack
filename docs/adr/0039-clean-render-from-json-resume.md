# 0039 — A resume that cannot be patched is re-typeset from JSON Resume, in the user's own typography

**Status:** Accepted (2026-09-04). Extends [ADR 0038](./0038-save-patches-the-users-docx-in-place.md);
supersedes nothing.

## Context

ADR 0038 gave the user their own `.docx` back with the accepted edits in it.
It also named the hole it leaves: a file the patcher cannot write into gets a
text version and an apology. That hole is most of the corpus. Of the four
resumes in a live database, **three are PDFs** — a PDF has no paragraphs, only
glyphs at coordinates — and the fourth keeps its skills in a 1 × 2 table whose
sixteen cell paragraphs render as one line the patcher refuses to split.

The same table is why this is not only a file-format problem. Extracted as
text, that section reads as one run-on line from the `.docx` and as **eight
labels stacked above eight value lines** from the PDF: the pairing is gone in
both, and neither is readable by an ATS or a human. A deterministic parser
cannot put label 3 back with value 3 across that split. A model can.

Two measurements shaped the rest, both taken before any code was written
(the branch's pre-work note):

- **The style sheet is not the style.** Resume 1's `styles.xml` says Times New
  Roman at 12 pt with no accent; its own runs say Arial with a blue `0070C0`
  on 52 of them, and a body size of 11 pt once each run is weighted by the
  text it carries. The integration guide's recipe — read `docDefaults` and
  `Normal` — would have dressed the resume as a document it is not.
- **pdf.js does not report a font family.** `getTextContent().styles[…]
  .fontFamily` returns the CSS generic `sans-serif` for every item of both
  PDFs. The real name (`AAAAAU+ArialMT`) is in `page.commonObjs`, and only
  after `getOperatorList()` has populated it.

## Decision

1. **JSON Resume is the model**, as the subset this product renders
   (`json-resume.ts`): `basics`, `work`, `education`, `skills`, `languages`,
   `certificates`, `projects`, plus `extras` so a section we have no field for
   is carried rather than lost. Caps slice, they never reject: the corpus has a
   60-term skills line, and half a structure beats none.
2. **The scan fills it, and a guard checks it.** `SCAN_SYSTEM` gains a
   `structure` block whose one rule is COPY, NEVER WRITE;
   `structure-anchor.ts` drops every string that is not a contiguous span of
   the resume text after normalisation, counts what went, and refuses to store
   a structure it emptied. The block is **optional in `ScanSchema`** and
   `catch`es a malformed value: a bad structure must never cost a user their
   scan. `Resume.structure Json?` holds it; NULL means "read it from the text".
3. **`structure-from-text.ts` is the floor.** Deterministic, pure, and used
   whenever the column is NULL — both heading dialects (`## KEY SKILLS` from
   the `.docx` reader, a bare `KEY SKILLS` from the PDF), wrapped PDF bullets
   joined back, the trailing "Technology Stack:" line returned to its role. On
   all three stored resumes it finds the same six roles and the same bullets
   as the scan does. It deliberately does **not** guess the skills-table
   pairing — a wrong pairing is a false statement about the candidate.
4. **Typography is read from the document's own runs**, weighted by the text
   each carries (`style-infer.ts`), with `styles.xml` as the floor under a
   document that sets nothing; from a PDF, after `getOperatorList()`, with the
   subset prefix and the PostScript suffixes peeled off. All four margins and
   the page size come along. A PDF reports no accent colour, and the page says
   so rather than inventing one.
5. **One plan, two writers.** `render/sections.ts` turns a structure and the
   knobs into blocks; `clean-docx.ts` (the `docx` library) and `clean-pdf.ts`
   (pdfkit) draw the same blocks. Two layout engines would drift apart on the
   first edit, and the promise here is the same document in two formats.
6. **`docx` 9.7.1 and pdfkit 0.20.2, pinned, both pure JavaScript.** Typst
   renders better by default (hanging indents, `#h(1fr)`) and was rejected on
   three measured grounds: it stamps `Typst 0.14.2` into `/Info` **and** the
   XMP packet with no way to set either from the compile call, which breaks
   ADR 0038's metadata policy; it writes no `.docx`, so it would be a second
   layout engine beside `docx` rather than instead of it; and it is a native
   napi addon in a repo that has none. pdfkit's `Producer` and `Creator` are
   set to the empty string — measured after the change, not assumed.
7. **Liberation Sans 2.1.5 (OFL 1.1) ships in the image**, regular and bold,
   at `src/resume/fonts/` with `LICENSE-liberation.txt` beside it, copied to
   `dist/resume/fonts` by the Dockerfile. Measured with fontkit: **identical
   advance widths to Arial on all 95 printable ASCII codepoints**, and full
   Ukrainian Cyrillic. The `.docx` names the user's own family and lets Word
   supply it; the `.pdf` embeds this one; because the metrics match, the two
   files break their lines in the same places.
8. **What the face cannot draw is folded, not boxed** (`render/drawable.ts`).
   A first live render came back with a row of ☐ where a Word formula object
   had left MATHEMATICAL ITALIC letters. The kept set is a claim about the
   shipped fonts and `drawable.test.ts` walks **every codepoint in it** against
   both faces, which is how the holes in General Punctuation and Greek — and
   the missing U+2219 the corpus actually uses — were found rather than guessed.
9. **The knobs are not stored in v1** (`render/knobs.ts`). Defaults come from
   the file; the form overrides them; a column, a migration and a "for which
   resume" question would buy a setting the user changes twice.
10. **The label is honest.** "Clean version in your typeface" — never
    "AI-generated", and never a claim that this is their design back. The page
    says the layout is rebuilt from scratch, and the preview is the rendered
    `.docx` read back through the same reader an upload goes through, not a
    description of it.

## Consequences

✅ A PDF-only resume enters the tailoring loop: **Save as a new resume**
turns it into a `.docx` the template check calls *Editable in place* — 61 of
61 lines on the first live walk — so ADR 0038's patcher can write into it.

✅ A skills table stops being an unreadable line: the model pairs it and the
guard proves each half is the user's own words. First live scan of resume 5:
161 strings kept, **0 dropped**, 0 roles emptied, 6 roles, 24 bullets — the
same count the deterministic reader finds.

❌ The re-render is not the user's design. It is a plain single column, and
the copy says so in three places rather than letting anyone hope otherwise.

❌ `SCAN_MAX_TOKENS` goes 3 000 → 12 000: the scan now copies the whole
resume into its reply. On a subscription CLI that is time, not money, but it
is a longer call on every upload.

❌ Two dependencies (25 MB and 10 MB of `node_modules`) and 825 KB of fonts in
the image, for a feature a user with a flow `.docx` never needs.

❌ Anything the fold cannot decompose is dropped from the rendered file. A
resume in a script the bundled face does not cover would render empty, and
nothing warns the user beyond the preview showing it.

## When to revisit

- A resume arrives in a script Liberation Sans does not cover (CJK, Arabic,
  Devanagari). The fold would empty it. That is the trigger to bundle a second
  face and choose per document, not to widen the kept set.
- The anchor guard's drop count stops being ~0 on a scan-prompt change: that
  is the regression metric, logged on every scan, and a jump means the prompt
  started asking the model to write rather than copy.
- The owner reports wanting the knobs remembered per resume. Then, and only
  then, they earn a column.
