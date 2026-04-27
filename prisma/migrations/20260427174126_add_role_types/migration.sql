-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "roleTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];
