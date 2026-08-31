-- F8 (ADR 0021): generated cover letters, one row per accepted generation.
-- Additive only: a new table, no existing row is touched, so a revert
-- strands no data. Only pass|warn letters are ever inserted — a blocked
-- generation persists nothing.
CREATE TABLE "CoverLetter" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "resumeId" INTEGER NOT NULL,
    "resumeVersion" INTEGER NOT NULL DEFAULT 1,
    "kind" TEXT NOT NULL DEFAULT 'letter',
    "tone" TEXT NOT NULL DEFAULT 'warm',
    "text" TEXT NOT NULL,
    "editedText" TEXT,
    "model" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "keywordsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gapsAcknowledged" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "usedVerification" BOOLEAN NOT NULL DEFAULT false,
    "gateVerdict" TEXT NOT NULL,
    "gateNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverLetter_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CoverLetter_jobId_createdAt_idx" ON "CoverLetter"("jobId", "createdAt");

ALTER TABLE "CoverLetter" ADD CONSTRAINT "CoverLetter_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoverLetter" ADD CONSTRAINT "CoverLetter_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE CASCADE ON UPDATE CASCADE;
