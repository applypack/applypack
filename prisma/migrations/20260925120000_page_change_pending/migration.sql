-- The change watch's undelivered notice (ADR 0036). lastContentHash is the
-- text as we last REPORTED it; this is the text we saw and could not report
-- yet: outside the alert hours, before the digest time, while Alerts are
-- off, or after every chat refused the message. The fetch tick sends it from
-- the top, so it no longer depends on the page being read again at an hour
-- that may send it. NULL means nothing is waiting.
ALTER TABLE "company" ADD COLUMN "pendingContentHash" TEXT;
