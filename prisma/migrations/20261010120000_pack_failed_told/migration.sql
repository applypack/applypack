-- The "packs" message now names the automatic packs that could not be
-- prepared. The ones that failed before this are not news: they are marked
-- as told, so the first message after the upgrade does not list them all.
UPDATE "application_pack" SET "notifiedAt" = now()
WHERE "trigger" = 'auto' AND "status" = 'failed' AND "notifiedAt" IS NULL;
