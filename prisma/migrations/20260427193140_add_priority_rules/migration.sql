-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "priorityRules" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "priorityRulesApplied" TEXT[] DEFAULT ARRAY[]::TEXT[];
