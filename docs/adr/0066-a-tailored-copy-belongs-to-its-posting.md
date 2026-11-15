# 0066 — A tailored copy belongs to its posting; the resume changes from its own page

**Status:** Accepted (2026-11-15). Builds on
[0038](./0038-save-patches-the-users-docx-in-place.md),
[0059](./0059-the-tailor-page-edits-the-resume-as-a-document.md) and
[0063](./0063-the-worker-prepares-an-application-pack.md). Closes #641.

## Context

**Save as vN** on the Tailor page wrote the editor's text as the next version
of the resume itself. That version became what everything else read: the
Resumes table, the scan, the search's "Resume for this search", the next
comparison, the next letter, the next application pack. Tailored for one
employer ("Software Engineer, Backend", a backend-leaning summary), the
resume carried that wording into the next posting, where a pack had to take
it out again. After five applications the "resume" was the fifth posting's
version, and the person's neutral one survived only as the uploaded file.

A job seeker keeps one resume and a copy per application. The app kept one
line of versions.

## Decision

1. **Save on the Tailor page keeps a copy for that posting.** The row is
   `tailored_resume`, one per job (the next Save replaces it): the text, the
   file as saved — the person's own `.docx` with the edits written in, else
   the clean version, else the text — its name ("Dana Ruiz — Fernway"), the
   resume and version it was made from, and the draft comparison of its text.
   Bytes, not a recipe, for the reason a pack keeps bytes: "what did I send
   them" must have one answer a month later.
2. **The resume is not written to.** Its version, its scan and the search
   that hunts with it stay. A comparison, a letter or a pack for another
   posting starts from the resume; the copy's own comparison is a draft of
   that resume (`ResumeMatch.draft`), so the Tailor page opens it and
   Analyse again goes on from the copy's text.
3. **The copy is on the job's page** — the Resume score tab and the Tailor
   page — with its download, and it is offered, preselected, as what the
   application went out with. Recording it follows the pack's rule
   (`applied-resume.ts`): the resume's id and version, and the copy's text as
   the snapshot.
4. **One press makes a copy the resume**: *Make this my base resume*, behind
   a confirmation that says what follows. It does what Save as vN did. The
   other way the resume changes is its own page (Upload a new version, the
   editor there).
5. **Nothing is migrated.** Versions saved as vN before this stay versions.

## Alternatives considered

- **A pinned base version** the person picks, with versions kept as they
  were. One more setting on a product whose users say it has too many, and
  the list of versions would still be other employers' wording.
- **A warning before the save.** It tells the person about the damage and
  leaves it in place.
- **Columns on `resume_match`** for the bytes instead of a table. A draft
  comparison already holds the text, but Prisma reads every scalar of a row
  unless told otherwise, and comparisons are read on a dozen pages; a file
  in that table is a megabyte waiting to be selected by accident. A copy is
  also not a comparison: it outlives the one that scored it.
- **A row on `/resumes` per copy** — what the page did before v1.70.0, and
  why it stopped: four applications, eight resumes, and no idea which is
  one's own.

## Consequences

- The Resumes list holds the person's resumes and nothing else.
- A pack and a letter for the *same* posting still read the resume, not the
  copy. A pack never edited a resume and keeps its own file; a letter for
  the same job reading the copy is a follow-up.
- Applications show the resume the copy came from, with its version; the
  snapshot behind it is the copy's text.
- Deleting a job deletes its copy. Deleting the resume leaves the copy to
  download; it can no longer be made the resume.
- The tour video and its caption still say "save it as v2" until they are
  shot again.
