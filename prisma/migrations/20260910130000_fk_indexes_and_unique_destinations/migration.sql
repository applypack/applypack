-- Audit 2026-09-10 (DATA-2, DATA-7, DATA-8; ADR 0053).

-- The referencing side of four foreign keys, so a delete on the referenced
-- row no longer scans the referencing table.
CREATE INDEX "job_crossListedOfJobId_idx" ON "job"("crossListedOfJobId");
CREATE INDEX "job_appliedResumeId_idx" ON "job"("appliedResumeId");
CREATE INDEX "screening_jobId_idx" ON "screening"("jobId");
CREATE INDEX "cover_letter_resumeId_idx" ON "cover_letter"("resumeId");

-- One row per destination. Duplicates collapse onto the oldest row; a search
-- routed to a later copy follows it, so no alert changes chat.
WITH ranked AS (
  SELECT id, FIRST_VALUE(id) OVER (PARTITION BY "kind", "botToken", "chatId", "webhookUrl" ORDER BY id) AS keep
  FROM "notification_target"
)
UPDATE "profile" p SET "notificationTargetId" = r.keep
FROM ranked r WHERE p."notificationTargetId" = r.id AND r.id <> r.keep;

WITH ranked AS (
  SELECT id, FIRST_VALUE(id) OVER (PARTITION BY "kind", "botToken", "chatId", "webhookUrl" ORDER BY id) AS keep
  FROM "notification_target"
)
DELETE FROM "notification_target" t USING ranked r WHERE t.id = r.id AND r.id <> r.keep;

CREATE UNIQUE INDEX "notification_target_botToken_chatId_key" ON "notification_target"("botToken", "chatId");
CREATE UNIQUE INDEX "notification_target_webhookUrl_key" ON "notification_target"("webhookUrl");

-- The same document twice in one screening is one row: later copies go (their
-- verdicts cascade), the first stays with its number.
DELETE FROM "applicant" a USING "applicant" b
WHERE a."screeningId" = b."screeningId" AND a."textHash" = b."textHash" AND a.id > b.id;

CREATE UNIQUE INDEX "applicant_screeningId_textHash_key" ON "applicant"("screeningId", "textHash");
