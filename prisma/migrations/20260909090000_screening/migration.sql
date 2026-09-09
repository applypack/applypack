-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "employerMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "screeningRetentionDays" INTEGER NOT NULL DEFAULT 90;

-- CreateTable
CREATE TABLE "screening" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "rubric" JSONB NOT NULL,
    "rubricVersion" INTEGER NOT NULL DEFAULT 1,
    "retainUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicant" (
    "id" SERIAL NOT NULL,
    "screeningId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "sourceFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "original" BYTEA NOT NULL,
    "text" TEXT NOT NULL,
    "redactedText" TEXT NOT NULL,
    "redactions" JSONB NOT NULL DEFAULT '[]',
    "parseStatus" TEXT NOT NULL,
    "parseNote" TEXT,
    "duplicateOfId" INTEGER,
    "textHash" TEXT NOT NULL,
    "simhash" BIGINT,
    "decision" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applicant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_verdict" (
    "id" SERIAL NOT NULL,
    "applicantId" INTEGER NOT NULL,
    "rubricVersion" INTEGER NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "breakdown" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "confidence" TEXT NOT NULL,
    "gateBucket" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screening_verdict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "screening_retainUntil_idx" ON "screening"("retainUntil");

-- CreateIndex
CREATE INDEX "applicant_screeningId_parseStatus_idx" ON "applicant"("screeningId", "parseStatus");

-- CreateIndex
CREATE UNIQUE INDEX "applicant_screeningId_number_key" ON "applicant"("screeningId", "number");

-- CreateIndex
CREATE INDEX "screening_verdict_applicantId_createdAt_idx" ON "screening_verdict"("applicantId", "createdAt");

-- AddForeignKey
ALTER TABLE "screening" ADD CONSTRAINT "screening_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant" ADD CONSTRAINT "applicant_screeningId_fkey" FOREIGN KEY ("screeningId") REFERENCES "screening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_verdict" ADD CONSTRAINT "screening_verdict_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

