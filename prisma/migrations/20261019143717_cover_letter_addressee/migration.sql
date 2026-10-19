-- #581: who a cover letter greets, so the next Generate and Regenerate keep the whole name.
ALTER TABLE "cover_letter" ADD COLUMN "addressee" TEXT;
