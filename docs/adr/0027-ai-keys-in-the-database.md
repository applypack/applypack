# 0027 — Per-engine AI keys live in the database, in plaintext, with `.env` as fallback

**Status:** Accepted (2026-09-02). Extends 0013/0014 (engine configuration
resolves DB-row-first with `.env` as fallback; this adds the credential to
what resolves that way) and the CLAUDE.md secrets rule, whose one existing
carve-out is `TelegramTarget.botToken`.

## Context

The onboarding plan's target user is explicitly non-technical — someone who
can install Docker from a README but has never edited a config file. The
wizard's first step asked them to do exactly that: open `.env`, add
`ANTHROPIC_API_KEY=…`, run `docker compose up -d`, come back and press
"Check again". Every other step of the wizard is a button. Step 1 was a
detour through a text editor and a terminal, and it is the step that gates
all three steps after it — nothing scores until an engine answers.

The rest of the engine's configuration already moved into Postgres: which
backends run, in what order, with which model per role (ADR 0013, 0014). The
credential was the one field left behind, so "switch engines from the
dashboard" stopped working the moment the new engine needed a key the old
one did not.

The precedent is already in the repo. `TelegramTarget.botToken` is a bearer
token that grants full control of a Telegram bot, stored as a plain column
since phase 3, precisely so the dashboard can add a target without a restart.
CLAUDE.md names it as the exception to "secrets live in `.env`".

## Decision

- One nullable JSONB column, `AppSettings.aiKeys`: `{ <provider id>:
  "<secret>" }`, **plaintext**. Hand-written migration, no backfill — a
  missing entry means "use `.env`", so every existing deployment keeps
  working with no action.
- Four engines take a key, each mirroring the `.env` variable the backend
  already reads: `anthropic_api` → `ANTHROPIC_API_KEY`, `claude_code` →
  `CLAUDE_CODE_OAUTH_TOKEN`, `gemini_cli` → `GEMINI_API_KEY`, `openai_api` →
  `OPENAI_API_KEY`. `codex_cli` is login-only and gets no field.
- **Stored key wins, `.env` is the fallback.** Resolution is one pure
  function, `ai-keys.ts:resolveAiKey`, unit-tested for all three states.
- The key travels through the two places that already existed, not new ones:
  - `AiEngineEnv` (from `getAiEngineEnv(keys)`) — so `providerUnusable`
    stays the single decision on whether an engine can run at all, and the
    chain, the "skipped" list and the badges all follow from it;
  - `AiRequest.apiKey` — resolved per engine in `ai-runtime`, handed to the
    provider for that one call. The API backends use it instead of the
    `config` value; the CLI backends receive it as their own auth variable
    in the child environment, still filtered through the existing
    `buildCliEnv` allowlist. Provider constructors no longer hold secrets,
    which also removes the second place that decided "no key ⇒ unusable".
- **The key is never handed back.** The paste field always renders empty;
  a stored key is only ever *described* — last four characters via the
  same `maskToken` the Telegram table uses, plus where it came from. There
  is no edit-in-place field a mask could be saved over. Removal is its own
  button.
- Reads go through `settings.ts:getAiKeys()`, deliberately **not** through
  `AppSettingsView`. An ordinary settings read cannot carry a secret into a
  log line or a rendered page, because it does not contain one. Writes log
  the engine id and whether a key is now stored — never the value.

## Consequences

✅ The non-technical persona finishes step 1 without a terminal: paste,
Save, Test. The worker picks the key up on its next tick — same live-toggle
model as every other setting (gotcha 9).
✅ `.env`-only deployments are unchanged and untested-against-nothing: the
fallback is the same code path, and the CLI scripts that build a provider
directly still work with no key plumbing at all.
✅ A fifth backend needs no migration — one more entry in `AI_KEY_ENV_VARS`.

❌ **The key sits in Postgres in plaintext.** Anyone who can read the
database can read it: `psql`, a `pg_dump`, a stolen volume, a backup copied
somewhere careless. This is a real widening of the blast radius versus a
gitignored `.env`, and it is the price of the feature. What bounds it: the
dashboard binds to `127.0.0.1` by default (config.ts `WEB_HOST`), Postgres
is published on loopback only, and the dashboard is single-user. What does
not bound it: nothing else. A user who wants the key off the disk keeps
using `.env` — that path is not deprecated.

  *Correction, 2026-09-02:* this paragraph read "Postgres is not published
  beyond the compose network" and that was not true — compose published it on
  every interface with the password from the compose file, so the key in this
  row was one LAN connection away. Demonstrated and fixed in the pre-public
  audit (TASKS §14); the port is `127.0.0.1:5433` now.
✅ **Cross-origin writes are refused (issue #69).** Every mutating route,
including the key-save route, is checked against the headers a browser
attaches itself — `Sec-Fetch-Site` first, then `Origin`, with `Referer` as
the fallback and `X-Forwarded-Host` for a reverse proxy (`src/web/same-origin.ts`,
originally two implementations: PR #87 and PR #93, merged into one). A page on
another origin, or on another port of this machine, gets a 403.
❌ Encryption at rest was rejected, not overlooked: the decryption key would
have to live in `.env`, which moves the secret rather than removing it, and
reintroduces the file edit this ADR exists to delete. An OS keychain does
not exist in an alpine container.
❌ We cannot revoke a leaked key, only forget it. The "Remove" button
deletes our copy; rotation happens in the provider's console, and the UI
says so.
❌ A key pasted for `claude_code` or `gemini_cli` is exported into a child
process environment. That is how those CLIs read credentials, and the
allowlist already limited which variables a child sees, but it does mean the
secret exists in another process's environment for the duration of a call.

## Alternatives rejected

- **Keys inside the existing `aiEngine` JSON.** `setAiEngineConfig` rewrites
  that column wholesale from a zod-parsed shape that drops unknown fields,
  so saving a model would silently delete the key — and the same object is
  logged on every save.
- **One column per engine.** ADR 0013's stated extension path for a new
  backend is "one provider spec + enum value + probe entry"; a migration per
  backend contradicts it.
- **Key in the DB, but only for the API engines.** The CLI engines are the
  ones the wizard recommends first (a subscription, not a metered key), so
  leaving them out would leave the persona stuck on exactly the path we
  point them at.

## When to revisit

- If the dashboard ever binds to a non-loopback interface by default, or
  grows real multi-user accounts — the plaintext trade-off was priced for a
  single-user, loopback-only deployment and does not survive either change.
- If a hosted deployment appears, the column becomes the seam an external
  secret store would plug into (`getAiKeys` is already the only reader).
