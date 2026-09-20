-- The brief memo key becomes a real key (D12d). Two comparisons of the same
-- posting started together both missed `findFirst` and both wrote a row, so
-- the second AI call was paid for and then read by nobody.

-- Older duplicates first, or the index cannot be created. The newest row per
-- key is the one `getPostingBrief` was already returning.
DELETE FROM "posting_brief" a
USING "posting_brief" b
WHERE a."jobId" = b."jobId"
  AND a."postingHash" = b."postingHash"
  AND a."promptVersion" = b."promptVersion"
  AND (a."createdAt", a."id") < (b."createdAt", b."id");

DROP INDEX IF EXISTS "posting_brief_jobId_postingHash_promptVersion_idx";

CREATE UNIQUE INDEX "posting_brief_jobId_postingHash_promptVersion_key"
  ON "posting_brief" ("jobId", "postingHash", "promptVersion");
