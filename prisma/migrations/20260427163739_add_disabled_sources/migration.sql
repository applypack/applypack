-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "disabledSources" TEXT[] DEFAULT ARRAY[]::TEXT[];
