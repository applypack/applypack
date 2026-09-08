-- ADR 0046: the resume's own domains, read at scan time. The posting brief
-- already names the employer's sector; with the candidate's sectors beside it
-- a posting from another domain can be marked as such on the page, and the
-- advice told to reframe transferable work rather than claim the sector.
-- Empty until the resume is scanned again (scripts/rescan-resumes.ts).
ALTER TABLE "resume" ADD COLUMN "industries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
