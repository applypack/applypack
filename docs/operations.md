# Running ApplyPack: your data, the schedule, your own Postgres, hosting

> Operator notes for an install that already works. Installing is
> [install.md](./install.md); the AI engines are [ai-engines.md](./ai-engines.md).

## Your data, and how to keep it


Everything lives in one Postgres database — jobs, resumes and their versions,
comparisons, cover letters, applications, and your AI keys if you pasted them
into the dashboard instead of `.env`. Nothing is sent anywhere but the AI
engine you chose and, if you set it up, your own Telegram bot.

**`npm start`'s built-in database** lives in the data folder
(`~/Library/Application Support/ApplyPack`, `%APPDATA%\ApplyPack` or
`~/.local/share/applypack`). To back it up, stop ApplyPack and copy that
folder; to restore, stop it and put the copy back. Deleting the ApplyPack
folder keeps the data, deleting the data folder removes it. The database
listens on `127.0.0.1` only (port 5434 unless something else has it), and
its password is in the folder's `db.json`.

**Docker's database** backs up with one command; it is a plain SQL dump:

```bash
docker compose exec -T postgres pg_dump -U jobhunter jobhunter > applypack-$(date +%F).sql
```

Restore into an empty database (stop the app first so nothing writes while it
loads):

```bash
docker compose stop app web
docker compose exec -T postgres psql -U jobhunter -d jobhunter < applypack-2026-09-02.sql
docker compose start app web
```

`docker compose down` keeps the data (it lives in the `pgdata` volume);
`docker compose down -v` deletes it. There is no undo, so take a dump first.

The database port is published on **`127.0.0.1:5433`** for `psql` and Prisma on
the host — loopback only, and 5433 so it does not collide with a Postgres you
already run on 5432. The app itself never uses that port; it reaches Postgres
over the compose network.

Deletes inside the dashboard cascade, and each confirm names what it will take:
deleting a resume takes its comparisons, its cover letters and its strength
reviews; deleting a company takes every job it posted, and with each job the
application you tracked against it.


## The worker's schedule

Six cron jobs, `TZ` from `.env`.


| Cron | Job | What it does |
| --- | --- | --- |
| `mm * * * *` † | fetch | Pull all sources → filter → classify → alert |
| `0 9 * * *` | digest | Telegram digest of the last 24h of new/alerted jobs |
| `0 8 * * *` | stale-applications | Nudge for applications quiet for 14+ days |
| `0 3 * * 0` | cleanup | Drop dismissed jobs older than 30 days, trim usage counters |
| `mm 4 * * 0` † | discovery | Re-probe pending company candidates |
| `mm 6 1 * *` † | hn-hiring | Pull the monthly HN "Who is hiring" thread |

† `mm` is a fixed minute your install picks for itself, so that every
ApplyPack in your time zone doesn't ask the same free job board in the same
second. It's stable across restarts and printed at boot (`cron: registered`
in the worker log). The three jobs that reach somebody else's server get
their own minute; the ones that only touch your Telegram and your database
run at the hour written above. See
[ADR 0035](./adr/0035-many-installs-one-set-of-boards.md).

Every cron has a matching one-shot script for manual runs
(`npm run <name>:once` while ApplyPack runs, or
`docker compose exec app node dist/scripts/<name>-once.js`).


## Your own Postgres, development, and the dashboard's binding


`DATABASE_URL` in `.env` points ApplyPack at a Postgres 16 you already run;
`npm start` then leaves the built-in database alone.

For development, run the database on its own and the two processes with
watchers, from the repository root:

```bash
npm run db        # the built-in database, until Ctrl+C
npm run dev       # the cron worker
npm run dev:web   # the dashboard → http://localhost:4747
```

They find the database through `db.json` in the data folder, and so do
`npm run fetch:once` and the other scripts.

`WEB_HOST` defaults to `127.0.0.1` here on purpose. The dashboard has no
authentication unless you set `WEB_BASIC_AUTH`, so bind it wider only
together with that. (Under Docker, compose sets `0.0.0.0` for the
container and publishes the port on loopback only.)

Writes are refused when they come from another origin: a POST whose
`Origin` is not this dashboard, or whose `Sec-Fetch-Site` says
`cross-site`, gets a 403. That is what stops a page open in the same
browser from posting to your `localhost:4747`. A request with no browser
origin headers at all — `curl`, a script — is not that attack and passes.
If you put the dashboard behind a reverse proxy, pass the browser's host
through (`proxy_set_header Host $host` in nginx); a proxy that rewrites
`Host` to `localhost` makes every form look cross-origin.

CLI engines (claude / gemini / codex) are simpler locally: install them
globally, log in once in your terminal, and the probe on the AI tab turns
green. Details per engine in [docs/ai-engines.md](./ai-engines.md).

> `dev:web` compiles with `tsc` and reloads with Node's `--watch` rather
> than `tsx`, a deliberate workaround: see gotcha #2 in
> [CLAUDE.md](../CLAUDE.md#gotchas).


## Hosting this for other people


ApplyPack is built as a personal tool: one person, their own machine, their
own keys. That is also the shape its sources assume. If you're putting it in
front of other people, three things change, and none of them are in the code.

**The vendors' terms become yours.** Adzuna's API is for personal research
and for publishing its listings; an organisation deploying it is on a
14-day trial and has to arrange its own licence. France Travail's licence
does not let you pass its content on to third parties, and does not let you
charge job seekers for access to it. A hosted, multi-user ApplyPack is
exactly the case both clauses are about — read them before you point either
source at somebody else's screen. Neither is on by default, and neither
appears anywhere in the UI until you paste a credential
([ADR 0034](./adr/0034-keyed-sources.md)).

**The daily obligation doesn't pause when you do.** France Travail asks for
every stored offer to be re-checked every 24 hours; ApplyPack does that on
each tick, so leaving fetching paused for more than a day quietly puts your
stored offers out of compliance. The Sources tab says so next to the source.

**Be a good guest on the free ones.** The default sources are RSS feeds and
public APIs with no contract at all, which is a reason for more care rather
than less. Each install picks its own tick minute and its own source order,
and revalidates a feed instead of re-downloading it wherever the vendor
supports that ([ADR 0035](./adr/0035-many-installs-one-set-of-boards.md),
measurements in [docs/scale-plan.md](./scale-plan.md)). All of that is
per-install, so give each instance its own database rather than sharing one
— which is the default anyway.

One practical note: compose binds the dashboard to `127.0.0.1` on purpose.
Exposing it is your call and your reverse proxy; ApplyPack has no user
accounts and no authentication of its own.

