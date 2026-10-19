-- #474: the key of a Dismissed posting the weekly cleanup deleted — its
-- source, its id and when it was first seen, no text — so a source that still
-- lists it does not bring it back to be scored again. Kept 180 days.
-- CreateTable
CREATE TABLE "dismissed_posting" (
    "companyId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dismissed_posting_pkey" PRIMARY KEY ("companyId","externalId")
);

-- AddForeignKey
ALTER TABLE "dismissed_posting" ADD CONSTRAINT "dismissed_posting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
