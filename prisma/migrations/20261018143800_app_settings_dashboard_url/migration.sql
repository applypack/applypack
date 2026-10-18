-- #487: the address the dashboard is opened at, for links in messages.
-- NULL = messages carry no link to the dashboard, as before.
ALTER TABLE "app_settings" ADD COLUMN "dashboardUrl" TEXT;
