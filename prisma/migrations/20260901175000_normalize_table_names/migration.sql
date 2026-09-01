-- Normalize table names to lowercase with snake_case (SQL best practice)
-- This migration renames all tables without dropping or recreating data

-- Rename tables
ALTER TABLE "AppSettings" RENAME TO "app_settings";
ALTER TABLE "CandidateFact" RENAME TO "candidate_fact";
ALTER TABLE "Company" RENAME TO "company";
ALTER TABLE "CompanyCandidate" RENAME TO "company_candidate";
ALTER TABLE "CoverLetter" RENAME TO "cover_letter";
ALTER TABLE "CronRun" RENAME TO "cron_run";
ALTER TABLE "Job" RENAME TO "job";
ALTER TABLE "JobStageEvent" RENAME TO "job_stage_event";
ALTER TABLE "JobVerification" RENAME TO "job_verification";
ALTER TABLE "Profile" RENAME TO "profile";
ALTER TABLE "Resume" RENAME TO "resume";
ALTER TABLE "ResumeMatch" RENAME TO "resume_match";
ALTER TABLE "TelegramTarget" RENAME TO "telegram_target";

-- Rename indexes
ALTER INDEX "AppSettings_pkey" RENAME TO "app_settings_pkey";
ALTER INDEX "CandidateFact_pkey" RENAME TO "candidate_fact_pkey";
ALTER INDEX "Company_pkey" RENAME TO "company_pkey";
ALTER INDEX "CompanyCandidate_pkey" RENAME TO "company_candidate_pkey";
ALTER INDEX "CoverLetter_pkey" RENAME TO "cover_letter_pkey";
ALTER INDEX "CronRun_pkey" RENAME TO "cron_run_pkey";
ALTER INDEX "Job_pkey" RENAME TO "job_pkey";
ALTER INDEX "JobStageEvent_pkey" RENAME TO "job_stage_event_pkey";
ALTER INDEX "JobVerification_pkey" RENAME TO "job_verification_pkey";
ALTER INDEX "Profile_pkey" RENAME TO "profile_pkey";
ALTER INDEX "Resume_pkey" RENAME TO "resume_pkey";
ALTER INDEX "ResumeMatch_pkey" RENAME TO "resume_match_pkey";
ALTER INDEX "TelegramTarget_pkey" RENAME TO "telegram_target_pkey";

-- Rename unique key constraints
ALTER INDEX "Company_atsType_atsToken_key" RENAME TO "company_atsType_atsToken_key";
ALTER INDEX "CompanyCandidate_atsType_atsToken_key" RENAME TO "company_candidate_atsType_atsToken_key";
ALTER INDEX "CandidateFact_term_key" RENAME TO "candidate_fact_term_key";
ALTER INDEX "Job_companyId_externalId_key" RENAME TO "job_companyId_externalId_key";

-- Rename foreign key constraints
ALTER TABLE "app_settings" RENAME CONSTRAINT "AppSettings_activeProfileId_fkey" TO "app_settings_activeProfileId_fkey";
ALTER TABLE "cover_letter" RENAME CONSTRAINT "CoverLetter_jobId_fkey" TO "cover_letter_jobId_fkey";
ALTER TABLE "cover_letter" RENAME CONSTRAINT "CoverLetter_resumeId_fkey" TO "cover_letter_resumeId_fkey";
ALTER TABLE "job" RENAME CONSTRAINT "Job_companyId_fkey" TO "job_companyId_fkey";
ALTER TABLE "job" RENAME CONSTRAINT "Job_crossListedOfJobId_fkey" TO "job_crossListedOfJobId_fkey";
ALTER TABLE "job_stage_event" RENAME CONSTRAINT "JobStageEvent_jobId_fkey" TO "job_stage_event_jobId_fkey";
ALTER TABLE "job_verification" RENAME CONSTRAINT "JobVerification_jobId_fkey" TO "job_verification_jobId_fkey";
ALTER TABLE "profile" RENAME CONSTRAINT "Profile_telegramTargetId_fkey" TO "profile_telegramTargetId_fkey";
ALTER TABLE "resume_match" RENAME CONSTRAINT "ResumeMatch_jobId_fkey" TO "resume_match_jobId_fkey";
ALTER TABLE "resume_match" RENAME CONSTRAINT "ResumeMatch_resumeId_fkey" TO "resume_match_resumeId_fkey";

-- Rename indexes (only those that exist)
ALTER INDEX "CompanyCandidate_status_discoveredAt_idx" RENAME TO "company_candidate_status_discoveredAt_idx";
ALTER INDEX "CoverLetter_jobId_createdAt_idx" RENAME TO "cover_letter_jobId_createdAt_idx";
ALTER INDEX "CronRun_name_startedAt_idx" RENAME TO "cron_run_name_startedAt_idx";
ALTER INDEX "CronRun_startedAt_idx" RENAME TO "cron_run_startedAt_idx";
ALTER INDEX "Job_fetchedAt_descriptionSimhash_idx" RENAME TO "job_fetchedAt_descriptionSimhash_idx";
ALTER INDEX "Job_pipelineStage_appliedAt_idx" RENAME TO "job_pipelineStage_appliedAt_idx";
ALTER INDEX "Job_status_fetchedAt_idx" RENAME TO "job_status_fetchedAt_idx";
ALTER INDEX "JobStageEvent_jobId_recordedAt_idx" RENAME TO "job_stage_event_jobId_recordedAt_idx";
ALTER INDEX "JobVerification_jobId_createdAt_idx" RENAME TO "job_verification_jobId_createdAt_idx";
ALTER INDEX "ResumeMatch_jobId_createdAt_idx" RENAME TO "resume_match_jobId_createdAt_idx";
ALTER INDEX "ResumeMatch_resumeId_createdAt_idx" RENAME TO "resume_match_resumeId_createdAt_idx";
