-- #412: the last engine trial per engine and model; counts only.
CREATE TABLE "engine_trial" (
    "engine" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postings" INTEGER NOT NULL,
    "compared" INTEGER NOT NULL,
    "agreed" INTEGER NOT NULL,
    "falseMatches" INTEGER NOT NULL,
    "missed" INTEGER NOT NULL,
    "meanDistance" DOUBLE PRECISION,
    "msPerPosting" INTEGER,
    "unparsed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "stale" INTEGER NOT NULL,

    CONSTRAINT "engine_trial_pkey" PRIMARY KEY ("engine","model")
);
