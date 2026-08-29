# 0011 — PDF resume text comes from unpdf, not a hand-rolled parser

**Status:** Accepted (2026-08-28)

## Context

Resumes are mostly sent around as PDF, but uploads only accepted
`.docx` / `.md` / `.txt`. The docx extractor is hand-rolled
(`zip.ts` + `docx-text.ts`) because OOXML text is one XML namespace away
from trivial. PDF is not: real-world resume exports (Word, Google Docs,
LaTeX, Chrome print-to-PDF) ship subsetted fonts with custom encodings, so
correct text extraction needs font CMap / ToUnicode handling — hundreds of
edge cases pdf.js already solves. A naive `Tj`/`TJ` scanner garbles exactly
the PDFs users actually upload.

## Decision

`src/resume/pdf-text.ts` wraps **unpdf** — a self-contained serverless
build of pdf.js: pure JS, no worker, no canvas, CJS entry, zero transitive
dependencies.

| Rule | |
| --- | --- |
| Import location | `src/resume/pdf-text.ts` only |
| Failure mode | `ResumeTextError` with a user-facing hint (password-protected, scanned image, corrupt) |
| Minimum text | 200 chars, same as every other format |

Web-only like the rest of `src/resume/` (ADR 0008) — the worker never loads
it. `.pdf` joins `ACCEPTED_EXTENSIONS`; the upload limit rises to 5 MB
because PDFs with a photo routinely exceed the old 2 MB.

## Consequences

✅ PDF resumes work with real-world reliability, and the extractor stays
behind the same `extractResumeText` seam and error type as docx.
❌ A ~2 MB dependency and a PDF engine we don't control; scanned or
outlined-text PDFs have no text layer and are rejected with an explanation,
not OCR'd.

## When to revisit

If unpdf goes unmaintained, or if scanned resumes ever need OCR — that is a
separate decision (external service or a native dependency).
