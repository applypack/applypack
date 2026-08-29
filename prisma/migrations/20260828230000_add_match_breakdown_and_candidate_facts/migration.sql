-- ResumeMatch: deterministic score breakdown + hard-requirement gates (ADR 0012).
ALTER TABLE "ResumeMatch" ADD COLUMN "breakdown" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ResumeMatch" ADD COLUMN "hardRequirements" JSONB NOT NULL DEFAULT '[]';

-- CandidateFact: user-confirmed / denied facts behind "ask_user" keywords.
CREATE TABLE "CandidateFact" (
    "id" SERIAL NOT NULL,
    "term" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateFact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CandidateFact_term_key" ON "CandidateFact"("term");
