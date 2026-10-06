-- ADR 0061: the interface's language. NULL = never chosen — an install that
-- exists today stays English until its owner picks one.
ALTER TABLE "app_settings" ADD COLUMN "locale" TEXT;
