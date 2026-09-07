-- ADR 0044: the posting brief — one reading of the posting, cached against it.
--
-- Until now every comparison re-derived the posting's keywords from the
-- description, so the frame drifted between resume versions and nothing in the
-- product ever characterised the posting itself: its discipline, its seniority,
-- the industry, who reads the resume first and what would impress them. That
-- reading is now its own call with no resume in the prompt, which makes it a
-- property of the POSTING — so it is stored and the next comparison of an
-- edited resume reuses it instead of paying for it again.
--
-- `postingHash` covers title + description: a description refreshed from the
-- company's own listing (ADR 0043) asks for a new brief rather than reusing a
-- brief of text the posting no longer shows. `promptVersion` is the brief's
-- own version, so a change to the match rules does not invalidate every row.
CREATE TABLE "posting_brief" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "postingHash" TEXT NOT NULL,
    "brief" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posting_brief_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "posting_brief_jobId_postingHash_promptVersion_idx" ON "posting_brief"("jobId", "postingHash", "promptVersion");

ALTER TABLE "posting_brief" ADD CONSTRAINT "posting_brief_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
