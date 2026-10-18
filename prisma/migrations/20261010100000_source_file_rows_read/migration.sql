-- A folder's long file is read a look's worth of rows at a time, and a file
-- that only grew is read on from its old end: how many of its rows were read.
-- AlterTable
ALTER TABLE "source_file" ADD COLUMN     "rowsRead" INTEGER NOT NULL DEFAULT 0;

-- Until now a file of rows was read to its 2,000th row and marked done, and
-- the only note a done file of rows carried said so ("The first 2,000 of N
-- rows", in the language of that run). Those wait again, and the next look
-- reads on from row 2,000.
UPDATE "source_file" SET "status" = 'waiting', "rowsRead" = 2000
WHERE "status" = 'done' AND "detail" IS NOT NULL AND "kind" IN ('json', 'jsonl', 'csv', 'tsv');
