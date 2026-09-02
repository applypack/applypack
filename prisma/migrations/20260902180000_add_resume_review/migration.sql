-- On-demand resume strength review (docs/resumes-plan.md §B, ADR 0030).
--
-- A row per run rather than one per resume: keeping history is what makes the
-- version-over-version strength trend free, and it costs one small row per
-- button press. The same shape resume_match has used since phase 9.
--
-- "reviewScore" is written by review-score.ts, never by the model (ADR 0012) —
-- the model grades six dimensions and the code applies the caps. "breakdown"
-- carries that computation plus the prompt version, so no column is needed for
-- a marker (the trick resume_match."breakdown" already uses).
--
-- ON DELETE CASCADE: a review is about one resume and means nothing without it.
-- No backfill: reviews only exist once the user asks for one.

-- CreateTable
CREATE TABLE "resume_review" (
    "id" SERIAL NOT NULL,
    "resumeId" INTEGER NOT NULL,
    "resumeVersion" INTEGER NOT NULL DEFAULT 1,
    "model" TEXT NOT NULL,
    "reviewScore" INTEGER NOT NULL,
    "headline" TEXT NOT NULL,
    "grades" JSONB NOT NULL,
    "advice" JSONB NOT NULL,
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "breakdown" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resume_review_resumeId_createdAt_idx" ON "resume_review"("resumeId", "createdAt");

-- AddForeignKey
ALTER TABLE "resume_review" ADD CONSTRAINT "resume_review_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;
