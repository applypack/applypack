# 0041 — Alerts go through a channel seam; Telegram and Discord are its first two channels

**Status:** Accepted (2026-09-05)

## Context

Every message ApplyPack sends — the instant alert, the daily digest, the
held delivery, the stale-application nudge, the changed-careers-page
notice — went through `src/notifier.ts`, which was Telegram to the bone:
MarkdownV2 escaping, a 4096-character limit, bot token + chat id pairs in
`TelegramTarget` rows, "Telegram alerts" as the master switch. Issue #24
asked for other channels, Discord first: an incoming webhook is one
outbound POST — no bot, no token dance — and plenty of people live in
Discord or Slack rather than Telegram.

## Decision

- **One table, `NotificationTarget`**, with a `kind` (`TELEGRAM` |
  `DISCORD`), the Telegram pair as nullable columns and a nullable
  `webhookUrl`. The migration renames `telegram_target` and
  `Profile.telegramTargetId` in place — constraints and the sequence too —
  so ids, the links from searches and the seeded row survive; a fresh
  `migrate diff` against the migrated database is empty.
- **The notifier composes each message once per channel**
  (`Outgoing { telegram: string[]; discord: string[] }`) and the target's
  `kind` decides which it gets. The words both channels share — the place
  line, the salary, the quiet-source items — live in `notify/lines.ts`;
  the escaping and the length limit belong to the channel
  (`notifier.ts` is the Telegram channel, `notify/discord.ts` the Discord
  one). A digest is packed under each channel's own limit by one pure
  `packMessages`.
- **A Discord target is a webhook URL on one of Discord's own hosts**,
  nothing else. The URL is a secret — anyone holding it can post to the
  channel — so it is stored like a bot token, masked to its last four
  characters on the settings page, and never put in a log line; that is
  why the POST is a raw `fetch` and not `fetchWithRetry`, which names the
  URL in its errors.
- **`allowed_mentions` is empty on every Discord message**: a posting's
  own text must not page @everyone — the untrusted-content rule (ADR 0022)
  applied to the one channel that would obey it.
- **The master switch keeps its column**, `telegramEnabled`, and is
  labelled "Alerts": renaming a boolean that already means "send anything"
  would be a migration for a name.
- **Both channels bootstrap from `.env` on first boot**
  (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`, `DISCORD_WEBHOOK_URL`), and
  then Settings → Notifications owns them, as before.

## Alternatives considered

- **A `DiscordTarget` table beside `TelegramTarget`.** Two tables, two
  selects on the search profile, two lists on the settings page — and a
  third of each for the next channel.
- **One neutral message model rendered per channel.** Cleaner in the
  abstract; in practice both formats are eight lines and the shared words
  are already one function each. Worth revisiting when the third channel
  arrives — Slack's mrkdwn is close to Discord's.
- **Discord embeds instead of content.** Prettier, but an embed is its
  own limit arithmetic (4096 per description inside 6000 per message) and
  a second markup to keep right; plain content with `<url>` (no unfurl)
  is enough for an alert.

## Consequences

- The next channel — Slack incoming webhooks, ntfy / Gotify, a generic
  JSON webhook — is a `kind`, a formatter set, a deliver function and a
  form on the settings page.
- The worker stays HTTP-server-free: webhooks are outbound POSTs.
- Existing installs: the migration runs at boot (`init.ts`), the Telegram
  row keeps working and shows under *Channel · Telegram*; nothing to
  redo.
