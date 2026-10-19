-- #590: the file the person uploaded, kept when Save as vN writes the next version.
ALTER TABLE "resume" ADD COLUMN "uploadFile" BYTEA,
ADD COLUMN "uploadName" TEXT,
ADD COLUMN "uploadMime" TEXT;
