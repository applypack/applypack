-- Saved postings: a file whose posting shared its id with another's — one
-- opening in two cities, two postings naming one careers page — was counted
-- as read and never became a job. Such a file has no job that names it, and
-- is read again under the id rule that keeps them apart. Only files read in
-- the last 30 days: past that a dismissed job is deleted (cleanup-job.ts),
-- and its file would bring it back.
UPDATE "source_file" f SET "status" = 'waiting'
WHERE f."status" = 'done'
  AND f."kind" IN ('html', 'txt', 'md', 'pdf', 'docx')
  AND f."readAt" > now() - interval '30 days'
  AND NOT EXISTS (SELECT 1 FROM "job" j WHERE j."companyId" = f."companyId" AND j."sourceFile" = f."relPath");
