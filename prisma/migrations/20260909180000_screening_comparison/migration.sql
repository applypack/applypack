-- CreateTable
CREATE TABLE "screening_comparison" (
    "id" SERIAL NOT NULL,
    "screeningId" INTEGER NOT NULL,
    "applicantIds" INTEGER[],
    "rubricVersion" INTEGER NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "readings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screening_comparison_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "screening_comparison_screeningId_createdAt_idx" ON "screening_comparison"("screeningId", "createdAt");

-- AddForeignKey
ALTER TABLE "screening_comparison" ADD CONSTRAINT "screening_comparison_screeningId_fkey" FOREIGN KEY ("screeningId") REFERENCES "screening"("id") ON DELETE CASCADE ON UPDATE CASCADE;
