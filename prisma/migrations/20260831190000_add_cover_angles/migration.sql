-- F8.1: standing angle inputs for the cover-letter card, saved on every
-- generation so the user never retypes them. Additive only.
ALTER TABLE "AppSettings" ADD COLUMN "coverAngles" JSONB;
