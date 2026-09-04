-- Salary in the posting's own money (plan §5.1 / §6.7). NULL on both columns
-- reads as USD a year, which is what every row stored so far means.
ALTER TABLE "job" ADD COLUMN "salaryCurrency" TEXT;
ALTER TABLE "job" ADD COLUMN "salaryPeriod" TEXT;
