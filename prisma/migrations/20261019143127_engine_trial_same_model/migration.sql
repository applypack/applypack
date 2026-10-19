-- #572: how many of a trial's pairs compared the model with its own scores on record.
ALTER TABLE "engine_trial" ADD COLUMN "sameModel" INTEGER NOT NULL DEFAULT 0;
