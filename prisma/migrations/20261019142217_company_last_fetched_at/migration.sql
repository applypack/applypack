-- #547: when a source was last read, whatever it answered.
ALTER TABLE "company" ADD COLUMN "lastFetchedAt" TIMESTAMP(3);

-- Until its next read, a source keeps the newest moment known of it: its last read that brought postings, or its newest stored posting.
UPDATE "company" c
SET "lastFetchedAt" = GREATEST(c."lastOkAt", (SELECT max(j."fetchedAt") FROM "job" j WHERE j."companyId" = c."id"));
