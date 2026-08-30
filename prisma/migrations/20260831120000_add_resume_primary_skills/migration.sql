-- Resume scan now marks the candidate's primary stack (subset of skills).
ALTER TABLE "Resume" ADD COLUMN "primarySkills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
