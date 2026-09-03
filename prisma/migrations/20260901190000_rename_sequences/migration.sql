-- Finish 20260901175000_normalize_table_names: rename the autoincrement
-- sequences it left behind. A separate migration because the rename one is
-- already merged and possibly applied — editing an applied migration file
-- breaks its checksum in _prisma_migrations.
-- Column defaults reference sequences by OID, not by name, so nextval()
-- keeps working. IF EXISTS because sequence names are cosmetic — Prisma
-- neither tracks nor drifts on them, and a missing one must not abort the
-- (transactional) migration.
ALTER SEQUENCE IF EXISTS "CandidateFact_id_seq" RENAME TO "candidate_fact_id_seq";
ALTER SEQUENCE IF EXISTS "Company_id_seq" RENAME TO "company_id_seq";
ALTER SEQUENCE IF EXISTS "CompanyCandidate_id_seq" RENAME TO "company_candidate_id_seq";
ALTER SEQUENCE IF EXISTS "CoverLetter_id_seq" RENAME TO "cover_letter_id_seq";
ALTER SEQUENCE IF EXISTS "CronRun_id_seq" RENAME TO "cron_run_id_seq";
ALTER SEQUENCE IF EXISTS "Job_id_seq" RENAME TO "job_id_seq";
ALTER SEQUENCE IF EXISTS "JobStageEvent_id_seq" RENAME TO "job_stage_event_id_seq";
ALTER SEQUENCE IF EXISTS "JobVerification_id_seq" RENAME TO "job_verification_id_seq";
ALTER SEQUENCE IF EXISTS "Profile_id_seq" RENAME TO "profile_id_seq";
ALTER SEQUENCE IF EXISTS "Resume_id_seq" RENAME TO "resume_id_seq";
ALTER SEQUENCE IF EXISTS "ResumeMatch_id_seq" RENAME TO "resume_match_id_seq";
ALTER SEQUENCE IF EXISTS "TelegramTarget_id_seq" RENAME TO "telegram_target_id_seq";
