-- /target scratch resumes: hidden from every list, replaced in place.
ALTER TABLE "Resume" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
