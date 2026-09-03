-- Stage 3c (plan §4.2): JobTech JobSearch (Arbetsförmedlingen, Sweden) as a
-- source — one Company row per search filter string (the atsToken).
ALTER TYPE "AtsType" ADD VALUE 'JOBTECH';
