-- A posting pasted on New screening is the employer side's (ADR 0049 addendum, #567).
ALTER TABLE "job" ADD COLUMN "forScreening" BOOLEAN NOT NULL DEFAULT false;
