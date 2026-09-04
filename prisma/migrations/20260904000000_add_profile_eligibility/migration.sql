-- Stage 4 (plan §5, ADR 0033): where the candidate lives and whether they
-- would move. Both are preferences on the search, not facts about a job.
ALTER TABLE "profile" ADD COLUMN "residence" TEXT;
ALTER TABLE "profile" ADD COLUMN "relocation" TEXT NOT NULL DEFAULT 'no';
