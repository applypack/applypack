-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AtsType" AS ENUM ('GREENHOUSE', 'LEVER', 'ASHBY', 'LARAJOBS_RSS');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('NEW', 'ALERTED', 'APPLIED', 'DISMISSED', 'SAVED');

-- CreateEnum
CREATE TYPE "CronRunStatus" AS ENUM ('RUNNING', 'OK', 'FAILED');

-- CreateTable
CREATE TABLE "Company" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "atsType" "AtsType" NOT NULL,
    "atsToken" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "careerUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fitScore" INTEGER,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "techMatch" TEXT[],
    "redFlags" TEXT[],
    "summary" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'NEW',
    "alertedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronRun" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "CronRunStatus" NOT NULL DEFAULT 'RUNNING',
    "stats" JSONB,
    "errorMessage" TEXT,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "telegramEnabled" BOOLEAN NOT NULL DEFAULT false,
    "activeProfileId" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramTarget" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "botToken" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsed" TIMESTAMP(3),

    CONSTRAINT "TelegramTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "stackRequired" TEXT[],
    "stackNiceToHave" TEXT[],
    "stackExclude" TEXT[],
    "notes" TEXT,
    "seniority" TEXT[],
    "remoteOk" BOOLEAN NOT NULL DEFAULT true,
    "remoteRegions" TEXT[],
    "onsiteCities" TEXT[],
    "hybridOk" BOOLEAN NOT NULL DEFAULT false,
    "minSalaryUsd" INTEGER NOT NULL DEFAULT 0,
    "minFitScore" INTEGER NOT NULL DEFAULT 70,
    "telegramTargetId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_atsType_atsToken_key" ON "Company"("atsType", "atsToken");

-- CreateIndex
CREATE INDEX "Job_status_fetchedAt_idx" ON "Job"("status", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_companyId_externalId_key" ON "Job"("companyId", "externalId");

-- CreateIndex
CREATE INDEX "CronRun_name_startedAt_idx" ON "CronRun"("name", "startedAt");

-- CreateIndex
CREATE INDEX "CronRun_startedAt_idx" ON "CronRun"("startedAt");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSettings" ADD CONSTRAINT "AppSettings_activeProfileId_fkey" FOREIGN KEY ("activeProfileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_telegramTargetId_fkey" FOREIGN KEY ("telegramTargetId") REFERENCES "TelegramTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

