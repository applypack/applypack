-- TASKS §18 stage 5: the resume as a shape (ADR 0039).
--
-- Three of the four resumes in a live database are PDFs and the fourth keeps
-- its skills in a 1 x 2 table, so ADR 0038's in-place patcher has nothing to
-- write into. Re-typesetting them needs the resume as data, not as a wall of
-- text — and the scan is already reading the whole document, so the block
-- rides along on a call that was happening anyway.
--
-- Nullable with no default and no backfill on purpose. NULL is a meaningful
-- state ("this resume was scanned before the block existed, or its structure
-- did not survive the verbatim guard"), and the render page answers it with
-- the deterministic reader in structure-from-text.ts rather than with an
-- empty page. `text` stays the source of truth; this column is derived.

ALTER TABLE "resume" ADD COLUMN "structure" JSONB;
