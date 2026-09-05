-- One table for every notification channel (#24, ADR 0041). Telegram rows
-- keep their ids, their token/chat pair and their links from profiles; a
-- Discord row carries a webhook URL instead. Renames rather than a new
-- table, so nothing is copied and nothing is lost.
CREATE TYPE "NotificationKind" AS ENUM ('TELEGRAM', 'DISCORD');

ALTER TABLE "telegram_target" RENAME TO "notification_target";
ALTER TABLE "notification_target" RENAME CONSTRAINT "telegram_target_pkey" TO "notification_target_pkey";
-- Sequence names are cosmetic to Prisma (see 20260901190000_rename_sequences).
ALTER SEQUENCE IF EXISTS "telegram_target_id_seq" RENAME TO "notification_target_id_seq";

ALTER TABLE "notification_target"
  ADD COLUMN "kind" "NotificationKind" NOT NULL DEFAULT 'TELEGRAM',
  ADD COLUMN "webhookUrl" TEXT,
  ALTER COLUMN "botToken" DROP NOT NULL,
  ALTER COLUMN "chatId" DROP NOT NULL;

ALTER TABLE "profile" RENAME COLUMN "telegramTargetId" TO "notificationTargetId";
ALTER TABLE "profile" RENAME CONSTRAINT "profile_telegramTargetId_fkey" TO "profile_notificationTargetId_fkey";
