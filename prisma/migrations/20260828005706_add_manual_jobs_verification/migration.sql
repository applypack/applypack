-- AlterEnum
ALTER TYPE "AtsType" ADD VALUE 'MANUAL';

-- AlterTable
ALTER TABLE "Resume" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ResumeMatch" ADD COLUMN     "removals" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "resumeVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "JobVerification" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "redFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companySnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobVerification_jobId_createdAt_idx" ON "JobVerification"("jobId", "createdAt");

-- AddForeignKey
ALTER TABLE "JobVerification" ADD CONSTRAINT "JobVerification_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
