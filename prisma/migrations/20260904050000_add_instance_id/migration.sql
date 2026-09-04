-- The install's own identity, seed for the per-instance cron minute
-- (src/schedule.ts). Existing rows get one from the database; the default is
-- then dropped, because Prisma generates the value for new rows itself.
ALTER TABLE "app_settings" ADD COLUMN "instanceId" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "app_settings" ALTER COLUMN "instanceId" DROP DEFAULT;
