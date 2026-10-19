-- We Work Remotely titles every row "Company: Role", and the company was read
-- off it into "employer" (ADR 0056) while the title kept it, so every such row
-- showed the company twice. New rows store the role alone; this does the same
-- for the rows already stored. Only a title that opens with exactly its stored
-- employer and ": " changes; ids and fingerprints were made at insert and stay.
UPDATE "job" AS j
SET "title" = substring(j."title" FROM char_length(j."employer") + 3)
FROM "company" AS c
WHERE c."id" = j."companyId"
  AND c."atsType" = 'WEWORKREMOTELY'
  AND j."employer" IS NOT NULL
  AND left(j."title", char_length(j."employer") + 2) = j."employer" || ': '
  AND char_length(btrim(substring(j."title" FROM char_length(j."employer") + 3))) > 0;
