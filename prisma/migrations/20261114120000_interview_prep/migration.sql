-- ADR 0065: the person's own history, and the interview preparation one posting gets from it.
CREATE TABLE "career_note" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_note_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "interview_prep" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "language" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_prep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "interview_prep_jobId_key" ON "interview_prep"("jobId");

ALTER TABLE "interview_prep" ADD CONSTRAINT "interview_prep_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
