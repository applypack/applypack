-- AlterEnum
ALTER TYPE "AtsType" ADD VALUE 'HN_HIRING';

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "hnParserEnabled" BOOLEAN NOT NULL DEFAULT false;
