-- #478: a folder's ledger only grew. A file the last look did not list is
-- marked gone, and its row is deleted a month later when no job names the
-- file. A row the last look of its folder already missed is gone as of that
-- look: the first one known not to have listed it.
-- AlterTable
ALTER TABLE "source_file" ADD COLUMN     "goneAt" TIMESTAMP(3);

UPDATE "source_file" f SET "goneAt" = l.last
FROM (SELECT "companyId", max("seenAt") AS last FROM "source_file" GROUP BY "companyId") l
WHERE f."companyId" = l."companyId" AND f."seenAt" < l.last;
