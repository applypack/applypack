-- ADR 0062: rows the user brings in a file, and the mapping they confirmed
-- for them. Nothing in this release writes IMPORT in the same transaction,
-- which Postgres would refuse for a value added here.
-- AlterEnum
ALTER TYPE "AtsType" ADD VALUE 'IMPORT';

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "sourceConfig" JSONB;
