-- CreateTable
CREATE TABLE "tailored_resume" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "resumeId" INTEGER NOT NULL,
    "resumeName" TEXT NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "matchId" INTEGER,
    "text" TEXT NOT NULL,
    "file" BYTEA NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tailored_resume_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tailored_resume_jobId_key" ON "tailored_resume"("jobId");

-- AddForeignKey
ALTER TABLE "tailored_resume" ADD CONSTRAINT "tailored_resume_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

