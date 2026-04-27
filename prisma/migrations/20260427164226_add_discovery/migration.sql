-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('PENDING', 'PROMOTED', 'IGNORED', 'DEAD');

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "discoveryEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CompanyCandidate" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "atsType" "AtsType" NOT NULL,
    "atsToken" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "signal" TEXT,
    "jobsSeen" INTEGER NOT NULL DEFAULT 0,
    "status" "CandidateStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promotedAt" TIMESTAMP(3),

    CONSTRAINT "CompanyCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyCandidate_status_discoveredAt_idx" ON "CompanyCandidate"("status", "discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyCandidate_atsType_atsToken_key" ON "CompanyCandidate"("atsType", "atsToken");
