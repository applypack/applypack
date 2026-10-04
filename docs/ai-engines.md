# AI engines — setup guide

The pipeline can run on any mix of seven AI backends. You enable the ones you
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

## Two ways to hand over a key

Every setup below shows the `.env` line, because that always works. Since
ADR 0027 there is a shorter path for the four engines that take a key:
**paste it into the engine's card on `/settings` → AI engine** (or into
step 1 of `/welcome`) and press Save. No file to edit, no restart — the
dashboard applies it at once and the worker on its next tick.

| Engine | Key | `.env` equivalent |
| --- | --- | --- |
| Anthropic API | API key | `ANTHROPIC_API_KEY` |
| Claude Code CLI | `claude setup-token` token | `CLAUDE_CODE_OAUTH_TOKEN` |
| Gemini CLI | AI Studio API key | `GEMINI_API_KEY` |
| OpenAI-compatible API | API key | `OPENAI_API_KEY` |
| Codex CLI | — (`codex login` only) | — |

A pasted key **wins over** the `.env` variable and is stored in your own
Postgres, in plaintext, exactly like the Telegram bot tokens. The dashboard
binds to `127.0.0.1` by default, so it never leaves the machine — but a
database dump contains it. If you would rather keep secrets out of the
database, use `.env`: that path is unchanged and not going away. The card
only ever shows the last four characters, and **Remove** deletes the stored
copy (rotate the key itself in the provider's console).

| Engine | What it is | Billing | Needs |
| --- | --- | --- | --- |
| Anthropic API | Messages API via SDK | per token | `ANTHROPIC_API_KEY` |
| Claude Code CLI | headless `claude -p` | Claude.ai Pro/Max subscription | `claude` binary + login |
| Gemini CLI | headless `gemini -p` | Google account (free tier) or API key | `gemini` binary + login/key |
| Antigravity CLI | headless `agy -p` | Google Antigravity account | `agy` binary + login |
| OpenAI-compatible API | `POST /chat/completions` | per token (or free if local) | `OPENAI_API_KEY` (+ optional base URL) |
| Codex CLI | headless `codex exec` | ChatGPT Plus/Pro subscription | `codex` binary + login |

Three model slots per engine: the **classifier model** (cheap, runs on every
fetched job), the **resume model** (resume scan, comparison, verification
and screening: a few calls a day where judgment matters) and the **cover
letter model** (writing quality). Closed families are dropdowns, so you
cannot pick a wrong-family id. An empty slot takes the engine's default for
that role:

| Engine | Classifier | Resume | Cover letter |
| --- | --- | --- | --- |
| Anthropic API | Haiku 4.5 | Haiku 4.5 | Opus 5 |
| Claude Code CLI | Haiku 4.5 | Sonnet 5 | Opus 5 |
| Gemini CLI | `gemini-2.5-flash` | `gemini-2.5-pro` | `gemini-2.5-pro` |
| Antigravity CLI | `gemini-3.8-flash-high` | `gemini-3.1-pro-high` | `gemini-3.1-pro-high` |
| OpenAI-compatible API | `OPENAI_MODEL` | `OPENAI_MODEL` | `OPENAI_MODEL` |
| Codex CLI | the CLI's own | the CLI's own | the CLI's own |

On the two Claude engines, `CLAUDE_MODEL`, `CLAUDE_MODEL_RESUME` and
`CLAUDE_MODEL_COVER` in `.env` replace those defaults.

---

## Anthropic API

Pay-per-token Messages API. Fastest option (no process spawn). It asks for
prompt caching on every call, but the classifier's prompt is under Haiku
4.5's 4096-token floor, so the calls made per posting are never cached.

**Local:**
1. Get a key at <https://console.anthropic.com/settings/keys>.
2. Paste it into the engine card on `/settings` → AI engine, or add
   `ANTHROPIC_API_KEY=sk-ant-...` to `.env` and restart.
3. Enable the engine and press **Test**.

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
2. Paste the token into the engine card on `/settings`, or add
   `CLAUDE_CODE_OAUTH_TOKEN=...` to `.env` and `docker compose up -d`.

The card's badge tells the two apart: an installed-but-logged-out CLI reads
"not detected", because `claude --version` answers either way.

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

## Antigravity CLI (agy)

Runs `agy -p` per call on your Google account / Antigravity workspace. Fast, headless agent with zero per-token cost on supported accounts. Local only (keyring authentication is not containerised).

1. Install Antigravity CLI (`agy`).
2. Run `agy` once to log in with your Google account.
3. Enable + **Test** on `/settings`.

## OpenAI-compatible API (OpenAI, OpenRouter, Groq, local models)

One engine covers every server that speaks `POST /chat/completions`. Its
card on `/settings` → AI engine carries the **Server address** and the key;
both are stored in your database, `.env` is the fallback:

| Target | Server address | Key |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` (the default) | `sk-...` |
| OpenRouter | `https://openrouter.ai/api/v1` | `sk-or-...` |
| Groq | `https://api.groq.com/openai/v1` | `gsk_...` |
| Gemini API key, no CLI | `https://generativelanguage.googleapis.com/v1beta/openai` | the AI Studio key |
| Ollama on this machine | `http://127.0.0.1:11434/v1` | none |
| LM Studio on this machine | `http://127.0.0.1:1234/v1` | none |

The `.env` names are `OPENAI_BASE_URL` and `OPENAI_API_KEY`; an address or
a key saved on the card wins over them, and **Use .env** forgets the saved
address. A server on the internet must be `https://`, and the address never
carries a key.

**Test** first asks the server what it runs (`GET {address}/models`), then
makes one tiny call. The answer names the models, fills the model fields'
suggestions, and says why nothing worked: nothing listening, an address
without its `/v1`, a model the server does not list. The model slots stay
free text — type whatever id your server serves (`gpt-5-mini`,
`meta-llama/llama-3.3-70b-instruct`, `llama3.1:8b`). `OPENAI_MODEL` in
`.env` sets the default for empty slots; with neither, Test uses the first
model the server lists.

### A model on this computer (LM Studio, or Ollama on this engine)

A server on this machine or your own network needs no key, costs nothing
and keeps the text there: the card says **Local — free**, the spend ledger
counts its calls apart from billed and plan money, and robots.txt treats an
install whose every engine is local as no vendor's crawler (ADR 0036
addendum 2026-09-28).

For **Ollama**, use the **Local model (Ollama)** engine below instead: it
sets the context window on every call, asks for JSON, and runs one call at
a time. This engine cannot do any of that. On this engine, for LM Studio,
llama.cpp's server or vLLM, three things are by hand:

- **Context length.** Set it when you load the model (16k tokens or more).
  A server cuts a longer prompt from the start — the rules — without an
  error.
- **One call at a time.** A local server shares one GPU between the calls
  it gets; set `AI_CONCURRENCY=1` in `.env` so three do not run at a third
  of the speed each and time out together.
- **The model.** A small model scores postings less reliably than a hosted
  one, and a resume comparison or a letter asks more of it than scoring
  does. Which local models clear the bar is not measured here yet, and a
  reply that does not parse is asked again of the same engine, once.

**Docker:** the containers reach your machine as `host.docker.internal`,
so LM Studio's address is `http://host.docker.internal:1234/v1`. Docker
Desktop knows that name; `docker-compose.yml` maps it on Linux too.

## Local model (Ollama)

Ollama through its own chat route (`/api/chat`), on this machine or your own
network — ADR 0057. No key, no bill, and the text never leaves.

- **Set it up:** install Ollama, `ollama pull llama3.1:8b` (or any chat
  model), and step 1 of `/welcome` finds it and offers **Use it**. Or, on
  `/settings` → AI engine → **Local model (Ollama)**: the **Ollama address**
  (default `http://127.0.0.1:11434`, `OLLAMA_URL` in `.env`), Enable, a model
  in each field (**Test** lists what Ollama has pulled; `LOCAL_MODEL` in
  `.env` fills an empty field).
- **Context window** (8k / 16k / 32k / 64k tokens, 16k by default) is sent
  with every call, so the server's own default does not matter. A call
  whose prompt would not fit is refused before it is sent, with the size it
  needed, and the engine behind this one in the list takes it. A resume
  comparison wants 16k or more; each step up takes more memory on the
  machine running Ollama.
- **JSON mode** holds the model to valid JSON on every call that parses one.
- **One call at a time:** the rest wait their turn, so `AI_CONCURRENCY`
  keeps meaning hosted calls. Its calls get three times the usual time.
- **Docker:** `http://host.docker.internal:11434` as the address; on Linux
  Ollama must also listen beyond loopback (`OLLAMA_HOST=0.0.0.0`).

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

## When a call fails

Every engine's failure is read the same way (`ai-provider-parse.ts:failureKind`):

- **A refused key or sign-in** (HTTP 401 / 403, or the CLI saying so) is not
  retried. The next engine in the list answers, and the refused one is left
  alone for ten minutes — or until you paste a different key. The flash says
  "the key was refused" and where to fix it.
- **A spent plan or quota** ("usage limit", "exceeded your current quota")
  is not retried either: it does not clear in seconds. The next engine
  answers.
- **A rate limit or an overloaded server** (429, 529, 503) gets one more try
  on the same engine, after the wait the server asks for when it is ten
  seconds or less (two seconds when it names none), and only while the
  call's time budget has room. A longer wait goes to the next engine.

When the worker or the dashboard stops, a CLI call in flight is ended with
it instead of running on to its timeout on your plan.

## Checking the whole setup

1. `/settings` → AI engine: every engine you own shows **available**.
2. Press **Test** on each — a green flash with the response time means the
   full path works (binary, auth, model id, network).
3. The "Active now" line at the top shows who serves calls and in which
   order the rest stand by.
4. Worker side: the terminal running `npm start` (or `docker compose logs -f app`) —
   on failover you will see `ai: engine failed, trying next` followed by
   `ai: served by fallback engine`.

## What it costs, and checking it against the vendor

`/settings` → AI engine → **Usage & cost** lists every call ApplyPack made
(ADR 0055): what it was for, which model answered, the tokens the vendor
reported and the money. It keeps three totals apart and never adds them:

- **Billed** — the Anthropic API, an OpenAI-compatible server on the
  internet, the Gemini CLI with a key. Priced from `src/ai-prices.ts`, a
  table of the vendors' published rates dated on every row it priced; where
  the vendor sends its own charge (OpenRouter) and the table does not know
  the model, that charge is used.
- **Covered by your plans** — Claude Code, Codex, the Gemini CLI on a
  Google login. The figure is what the calls would cost on the API, an
  estimate: your plan is not billed per call. If a CLI is signed in with an
  API key instead of a plan, it bills that key, and this figure is your bill.
- **Local models** — an OpenAI-compatible server on this machine or your
  network. Counted, never priced.

Each engine card says which of the three it spends. A billed engine ahead
of one your plan covers gets a warning: move the plan up to spend it first.
Under **Monthly budget for billed calls** a ceiling sends one line to your
alert chats at 80 % and at 100 % of it, once each a month (UTC). Nothing is
ever stopped.

To compare with the vendor's own numbers, pick closed UTC days (their
dashboards update with a delay and cut days in UTC) and print the ledger:

```bash
npm run spend:report -- --from 2026-09-01 --to 2026-09-27
```

It prints one tab-separated row per day, engine and model — calls, the
calls that ended with no usage reported, input, cache writes (five-minute
and one-hour), cache reads, output, web searches, our figure and the
vendor-reported one — and a total for each kind of money. Paste it beside
the Claude Console's Usage page or the OpenAI usage page. The usual reasons
two correct numbers differ:

- **A call ApplyPack timed out** may have finished on the vendor's side and
  been billed; those calls are counted in the `aborted` column.
- **A key used by other software too**: the vendor's total per key includes
  it. A dedicated key per install keeps the two comparable.
- **A new model or a changed rate**: a model the table does not know is
  listed as not priced; a changed rate needs a new dated row in
  `src/ai-prices.ts`.
- **The subscription CLIs** have no bill to match: the tokens are the CLI's
  own, and the dollar figure is an estimate by definition.

The vendor's admin key, which reads an organisation's usage, never goes
into ApplyPack.

## Troubleshooting

- **"not detected" badge** — the hint in the card says exactly what is
  missing (key line, login command, or mount). Fix it and reload; the probe
  refreshes within a minute.
- **Enabled but "skipped"** — the engine is in your chain but this host
  cannot run it yet. The banner lists them; the pipeline keeps working on
  the next usable engine.
- **"last resort" badge** — nothing in your list can run here, so this
  engine answers every call anyway: the `AI_PROVIDER` engine if it can
  run, otherwise Claude Code CLI. It is not in the list, and it stops
  answering once an engine in the list works. Press **Enable** to keep it.
- **No Disable button** — the card is the only engine in the list and the
  one `AI_PROVIDER` names, so an empty list would bring it straight back.
  Enable another engine first.
- **Test fails after N seconds** — the exact error is in the web logs:
  `docker compose logs web | grep "ai:"` (Docker) or the terminal running
  the server (local).
- **Every engine failed** — the log line `ai: every engine in the chain
  failed` lists the chain that was tried. Jobs are retried on the next
  cron tick; nothing is lost.

## Measured: the Claude Code CLI thinks before it answers — and Haiku thinks a lot

Benchmarked 2026-08-31 on one job + one resume, cover-letter role only:

| Engine | Model | Time | Result |
|---|---|---|---|
| anthropic_api | haiku-4.5 | **6 s** | ok |
| anthropic_api | opus-5 | 16 s | ok |
| claude_code | opus-5 | 22 s | ok |
| claude_code | sonnet-5 | 25 s | ok |
| claude_code | haiku-4.5 | 146 s / timeout | unreliable |
| claude_code | `haiku` alias | 2 x 180 s timeout | **failed, no letter** |

The 2026-08-31 reading of this table — "the difference is prompt size" — was
wrong, and #168 measured the real cause on 2026-09-05 with the resume-scan
prompt (6.2 KB system + 5.8 KB user), one call at a time:

| Lane | Wall | Output tokens | of which thinking |
|---|---:|---:|---:|
| claude_code + haiku-4.5, CLI defaults | **227 s** | 22 515 | **18 924** |
| claude_code + haiku-4.5, `MAX_THINKING_TOKENS=0` | **34 s** | 3 512 | 0 |
| claude_code + opus-5, CLI defaults | 69 s | 6 975 | 2 020 |
| anthropic_api + haiku-4.5 | 41 s | 4 106 | 0 |

Every lane generates at ~100 tokens/s; `claude -p` turns extended thinking
on, and on "copy this resume into JSON" Haiku spends ~19 000 tokens thinking
for a 3 500-token answer. The 146 s / timeout row above was the same thing
running into our own 180 s per-attempt timeout.

**What the app does now (v1.59.1):** every tool-free call on `claude_code`
runs the child with `MAX_THINKING_TOKENS=0` (`src/ai-provider-parse.ts:
cliThinkingCap`); the verify call keeps the CLI's default, because it
reasons over search results. One `ai: reply` line per call names the model,
the API time, the output tokens and the thinking tokens on both the CLI and
the API path, so a slow call, a throttled call and a thinking call no longer
look alike in `docker compose logs web`.

**Practical rule:** Opus or Sonnet still judge resumes better than Haiku;
pick them for the resume and cover-letter roles on `claude_code`, or use
`anthropic_api` (fastest of all). Leaving the Cover letter slot empty is
safe: on both Claude engines it takes Opus 5, whatever the resume slot says.
