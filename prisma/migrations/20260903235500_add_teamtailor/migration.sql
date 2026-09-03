-- Stage 3d (plan §4.2): Teamtailor as a per-company ATS — the public JSON
-- Feed at {slug}.teamtailor.com/jobs.json (or a custom career domain), one
-- Company row per board.
ALTER TYPE "AtsType" ADD VALUE 'TEAMTAILOR';
