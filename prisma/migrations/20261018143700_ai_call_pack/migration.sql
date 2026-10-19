-- #487: the application pack whose preparation made an AI call, so AI usage
-- can say what packs cost. Calls made before this stay unmarked.
ALTER TABLE "ai_call" ADD COLUMN "packId" INTEGER;

-- CreateIndex
CREATE INDEX "ai_call_packId_idx" ON "ai_call"("packId");
