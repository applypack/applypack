-- ADR 0032: a search says where it hunts with countries (ISO-2), regions
-- (group codes) and the arrangements it accepts — the same vocabulary the
-- Job columns use (ADR 0031). The three pill-era fields are migrated and
-- dropped in this one migration so there is never a moment with two models.
--
-- Mapping (plan §1.2, amended: "US" and "UK" were countries wearing a
-- region's hat):
--   remoteRegions ∋ US        → countries += US
--   remoteRegions ∋ UK        → countries += GB
--   remoteRegions ∋ Americas  → regions   += AMERICAS
--   remoteRegions ∋ EU        → regions   += EU
--   remoteRegions ∋ APAC      → regions   += APAC
--   remoteRegions ∋ Worldwide → regions   += WORLDWIDE
--   remoteOk / hybridOk / onsiteCities non-empty → workplace REMOTE / HYBRID / ONSITE
--   nothing set anywhere → nothing set anywhere = "anywhere", exactly as before.

ALTER TABLE "profile" ADD COLUMN     "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "workplace" "Workplace"[] DEFAULT ARRAY['REMOTE']::"Workplace"[];

UPDATE "profile" SET
  "countries" = COALESCE((
    SELECT array_agg(DISTINCT c ORDER BY c) FROM (
      SELECT CASE x WHEN 'US' THEN 'US' WHEN 'UK' THEN 'GB' END AS c
      FROM unnest("remoteRegions") AS x
    ) AS t WHERE c IS NOT NULL
  ), ARRAY[]::TEXT[]),
  "regions" = COALESCE((
    SELECT array_agg(DISTINCT r ORDER BY r) FROM (
      SELECT CASE x
        WHEN 'Americas' THEN 'AMERICAS'
        WHEN 'EU' THEN 'EU'
        WHEN 'APAC' THEN 'APAC'
        WHEN 'Worldwide' THEN 'WORLDWIDE'
      END AS r
      FROM unnest("remoteRegions") AS x
    ) AS t WHERE r IS NOT NULL
  ), ARRAY[]::TEXT[]),
  "workplace" = array_remove(ARRAY[
    CASE WHEN "remoteOk" THEN 'REMOTE' END,
    CASE WHEN "hybridOk" THEN 'HYBRID' END,
    CASE WHEN cardinality("onsiteCities") > 0 THEN 'ONSITE' END
  ]::"Workplace"[], NULL);

ALTER TABLE "profile" DROP COLUMN "hybridOk",
DROP COLUMN "remoteOk",
DROP COLUMN "remoteRegions";
