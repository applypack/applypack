-- A file holding one JSON object was judged wrong before v2.55.25 (#395): a
-- posting with a list inside read as that list, and a tool's stats file as a
-- row with no title. Both were recorded as files that do not fit the mapping,
-- and such a file is settled until it changes, so the folder went on failing
-- after the upgrade. A file recorded so gave no job, and judging it again
-- cannot store anything twice: these wait for the next look, which reads a
-- posting, sets a stats file aside, and fails a file that truly misfits as
-- it did before.
UPDATE "source_file" SET "status" = 'waiting'
WHERE "status" = 'failed' AND "sha256" IS NOT NULL AND "kind" = 'json';
