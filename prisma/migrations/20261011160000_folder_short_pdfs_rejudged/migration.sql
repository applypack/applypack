-- A saved PDF with a little text was noted as one no text could be read from
-- (#362): "a scanned image, a password, or a damaged file". A file set aside
-- is settled until it changes, so that sentence would stay on the Files page
-- after the upgrade. A PDF that was set aside gave no posting, and reading it
-- again asks no engine and stores nothing twice: these wait for the next
-- look, which sets them aside again — the ones with some text as too short,
-- the rest with the note they had.
UPDATE "source_file" SET "status" = 'waiting'
WHERE "status" = 'skipped' AND "kind" = 'pdf';
