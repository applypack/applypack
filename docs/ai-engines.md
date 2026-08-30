# AI engines — setup guide

The pipeline can run on any mix of five AI backends. You enable the ones you
have, put them in priority order on **`/settings` → AI engine**, and the app
does the rest:

- **Engine #1 serves every call** (job classification, resume analysis,
  verification).
- If it errors, runs out of quota, or hits a rate limit, the call
  **automatically retries on engine #2**, then #3, and so on.
- The switch is per call — as soon as #1 recovers, it serves again. No
  restarts, no manual flipping.
- An enabled engine that is not set up yet (no key / not logged in) is
  simply **skipped** and joins the chain the moment its auth appears.

Every engine card has a **Test** button — it sends one tiny live request
through that engine and reports success or the exact failure. Use it after
every setup step below.

| Engine | What it is | Billing | Needs |
| --- | --- | --- | --- |
| Anthropic API | Messages API via SDK | per token | `ANTHROPIC_API_KEY` |
| Claude Code CLI | headless `claude -p` | Claude.ai Pro/Max subscription | `claude` binary + login |
| Gemini CLI | headless `gemini -p` | Google account (free tier) or API key | `gemini` binary + login/key |
| OpenAI-compatible API | `POST /chat/completions` | per token (or free if local) | `OPENAI_API_KEY` (+ optional base URL) |
| Codex CLI | headless `codex exec` | ChatGPT Plus/Pro subscription | `codex` binary + login |

Two model slots per engine: the **classifier model** (cheap, runs on every
fetched job) and the **resume model** (a few calls a day where judgment
matters). Closed families are dropdowns — you cannot pick a wrong-family id.
"Default" means the engine's own default (for CLIs, whatever the CLI is
configured to use).

---

## Anthropic API

Pay-per-token Messages API. Fastest option (no process spawn, prompt cache).

**Local:**
1. Get a key at <https://console.anthropic.com/settings/keys>.
2. Add to `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. Restart the app (`npm run dev` / your process manager). Enable the engine
   on `/settings` → AI engine and press **Test**.

**Docker:** same `.env` line — both containers read `.env` via `env_file`.
Recreate them so the new variable lands:
```
docker compose up -d
```

## Claude Code CLI (Claude.ai subscription)

Runs `claude -p` per call on the subscription the CLI is logged into. Slower
(~7 s per call locally, 15–30 s in Docker), no per-token bill.

**Local:**
1. `npm install -g @anthropic-ai/claude-code`
2. Run `claude` once and log in with your Claude.ai account.
3. Enable + **Test** on `/settings`.

**Docker:** the image already ships the CLI. macOS keeps the interactive
login in the Keychain, so mounting `~/.claude` does **not** carry auth into
the container. Instead:
1. On the host: `claude setup-token` (opens a browser login, prints a token).
2. Add to `.env`: `CLAUDE_CODE_OAUTH_TOKEN=...`
3. `docker compose up -d`

## Gemini CLI (Google account or API key)

Runs `gemini -p` per call. The free Google-account tier is generous enough
for the classifier.

**Local — choose one:**
- *Subscription/free tier:* `npm install -g @google/gemini-cli`, run
  `gemini` once, pick "Login with Google".
- *API key:* get one at <https://aistudio.google.com/apikey> and add
  `GEMINI_API_KEY=...` to `.env`. No login needed.

**Docker:** the image ships the CLI. Either:
- add `GEMINI_API_KEY=...` to `.env` and `docker compose up -d` (simplest), or
- log in locally first, then mount the credentials — uncomment in
  `docker-compose.yml` under both `app` and `web`:
  ```yaml
  volumes:
    - ~/.gemini:/home/node/.gemini
  ```

## OpenAI-compatible API (OpenAI, OpenRouter, Groq, local models)

One engine covers every server that speaks `POST /chat/completions`:

| Target | `.env` |
| --- | --- |
| OpenAI | `OPENAI_API_KEY=sk-...` (base URL default is `https://api.openai.com/v1`) |
| OpenRouter | `OPENAI_API_KEY=sk-or-...`, `OPENAI_BASE_URL=https://openrouter.ai/api/v1` |
| Groq | `OPENAI_API_KEY=gsk_...`, `OPENAI_BASE_URL=https://api.groq.com/openai/v1` |
| Gemini API key, no CLI | `OPENAI_API_KEY=<AI Studio key>`, `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai` |
| Local (LM Studio / Ollama) | `OPENAI_API_KEY=local`, `OPENAI_BASE_URL=http://localhost:1234/v1` |

The model slots here are free text — type whatever id your endpoint serves
(`gpt-5-mini`, `meta-llama/llama-3.3-70b-instruct`, …). `OPENAI_MODEL` in
`.env` sets the default for empty slots.

**Local:** add the lines, restart, **Test**.
**Docker:** add the lines, `docker compose up -d`. For a local model server,
use `http://host.docker.internal:1234/v1` as the base URL so the container
can reach your host.

## Codex CLI (ChatGPT subscription)

Runs `codex exec` per call on a ChatGPT Plus/Pro subscription.

**Local:**
1. `npm install -g @openai/codex`
2. `codex login` (browser sign-in with your ChatGPT account).
3. Enable + **Test**.

**Docker:** the image ships the CLI. Log in locally first, then mount the
credentials — uncomment in `docker-compose.yml` under both services:
```yaml
volumes:
  - ~/.codex:/home/node/.codex
```
(Codex stores auth in `~/.codex/auth.json` — a plain file, so the mount
works on macOS too.)

---

## Checking the whole setup

1. `/settings` → AI engine: every engine you own shows **available**.
2. Press **Test** on each — a green flash with the response time means the
   full path works (binary, auth, model id, network).
3. The "Active now" line at the top shows who serves calls and in which
   order the rest stand by.
4. Worker side: `docker compose logs -f app` (or your local worker output) —
   on failover you will see `ai: engine failed, trying next` followed by
   `ai: served by fallback engine`.

## Troubleshooting

- **"not detected" badge** — the hint in the card says exactly what is
  missing (key line, login command, or mount). Fix it and reload; the probe
  refreshes within a minute.
- **Enabled but "skipped"** — the engine is in your chain but this host
  cannot run it yet. The banner lists them; the pipeline keeps working on
  the next usable engine.
- **Test fails after N seconds** — the exact error is in the web logs:
  `docker compose logs web | grep "ai:"` (Docker) or the terminal running
  the server (local).
- **Every engine failed** — the log line `ai: every engine in the chain
  failed` lists the chain that was tried. Jobs are retried on the next
  cron tick; nothing is lost.
