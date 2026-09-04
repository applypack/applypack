-- Stage 3e (ADR 0034): France Travail as a keyed source, and the three
-- columns its licence asks for — the offer as received, the board's last
-- update, and when the daily mirror last checked it.
ALTER TYPE "AtsType" ADD VALUE 'FRANCETRAVAIL';
ALTER TABLE "job" ADD COLUMN "sourcePayload" JSONB;
ALTER TABLE "job" ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3);
ALTER TABLE "job" ADD COLUMN "sourceCheckedAt" TIMESTAMP(3);
