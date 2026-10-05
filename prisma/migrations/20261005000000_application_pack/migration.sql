-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "pack" JSONB;

-- CreateTable
CREATE TABLE "application_pack" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "trigger" TEXT NOT NULL,
    "step" TEXT,
    "stop" TEXT,
    "why" TEXT,
    "resumeId" INTEGER,
    "resumeName" TEXT,
    "matchId" INTEGER,
    "tailoredMatchId" INTEGER,
    "verificationId" INTEGER,
    "coverLetterId" INTEGER,
    "baseText" TEXT,
    "text" TEXT,
    "edits" JSONB NOT NULL DEFAULT '{}',
    "scoreBefore" INTEGER,
    "scoreAfter" INTEGER,
    "docx" BYTEA,
    "pdf" BYTEA,
    "document" TEXT,
    "fileName" TEXT,
    "sentAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "application_pack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_pack_jobId_key" ON "application_pack"("jobId");

-- CreateIndex
CREATE INDEX "application_pack_status_queuedAt_idx" ON "application_pack"("status", "queuedAt");

-- AddForeignKey
ALTER TABLE "application_pack" ADD CONSTRAINT "application_pack_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

