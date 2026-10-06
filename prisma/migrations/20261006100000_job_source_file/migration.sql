-- ADR 0062, saved postings: which file of a folder source a job came from,
-- named on its page and in its alert.
-- AlterTable
ALTER TABLE "job" ADD COLUMN     "sourceFile" TEXT;
