-- #448: what the rules turned away of a file of rows, and the rules that did
-- it, so a look reads the file again when a search, a mute or the re-apply
-- window changes. Rows read before carry no count and no key: the first look
-- after this stamps the key, so nothing is read again on the day of the
-- upgrade.
-- AlterTable
ALTER TABLE "source_file" ADD COLUMN     "rulesKey" TEXT,
ADD COLUMN     "turnedAway" INTEGER,
ADD COLUMN     "windowEndsAt" TIMESTAMP(3),
ADD COLUMN     "windowTurnedAway" INTEGER NOT NULL DEFAULT 0;
