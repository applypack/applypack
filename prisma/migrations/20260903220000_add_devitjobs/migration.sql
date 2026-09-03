-- Stage 3c (plan §4.2): the DevITjobs family (GermanTechJobs.de,
-- DevITjobs.uk, DevITjobs.nl) as a source — one fetcher, one Company row
-- per host (the atsToken).
ALTER TYPE "AtsType" ADD VALUE 'DEVITJOBS';
