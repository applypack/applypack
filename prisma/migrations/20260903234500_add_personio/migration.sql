-- Stage 3d (plan §4.2): Personio as a per-company ATS — the public XML feed
-- at {slug}.jobs.personio.de/xml, one Company row per slug.
ALTER TYPE "AtsType" ADD VALUE 'PERSONIO';
