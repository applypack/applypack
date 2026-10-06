-- ADR 0062: a folder a tool writes files of rows into, and the ledger of what
-- was read from it. Nothing in this release writes FOLDER in the same
-- transaction, which Postgres would refuse for a value added here.
-- AlterEnum
ALTER TYPE "AtsType" ADD VALUE 'FOLDER';

-- CreateTable
CREATE TABLE "source_file" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "relPath" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mtime" TIMESTAMP(3) NOT NULL,
    "sha256" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "jobCount" INTEGER NOT NULL DEFAULT 0,
    "seenAt" TIMESTAMP(3) NOT NULL,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "source_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_file_companyId_relPath_key" ON "source_file"("companyId", "relPath");

-- AddForeignKey
ALTER TABLE "source_file" ADD CONSTRAINT "source_file_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
