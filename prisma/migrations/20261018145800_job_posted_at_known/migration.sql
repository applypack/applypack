-- #458: whether a job's date is one its source gave. False when it gave none
-- and `postedAt` is when the posting was first seen. Rows stored before this
-- keep true: nothing recorded where their date came from.
-- AlterTable
ALTER TABLE "job" ADD COLUMN     "postedAtKnown" BOOLEAN NOT NULL DEFAULT true;
