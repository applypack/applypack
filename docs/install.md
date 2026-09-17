# Installing ApplyPack

ApplyPack runs on your own computer. **The only thing to install is
[Node.js](https://nodejs.org) 22 or newer** (the 24 LTS is recommended).
The database comes with ApplyPack: `npm start` creates it on the first run
and starts and stops it for you ([ADR 0054](./adr/0054-npm-start-runs-a-built-in-database.md)).
You do not need Docker, PostgreSQL, or an AI key before the first start.

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| **Node.js** (required) | the **macOS Installer (.pkg)** from [nodejs.org](https://nodejs.org/en/download), or `brew install node` | the **Windows Installer (.msi)** from [nodejs.org](https://nodejs.org/en/download), or `winget install OpenJS.NodeJS.LTS` | [nodejs.org/en/download](https://nodejs.org/en/download) (nvm or NodeSource) — the `nodejs` in many distributions' own repositories is too old |
| **Git** (optional) | typing `git` in Terminal offers to install it | [git-scm.com](https://git-scm.com/download/win) | `sudo apt install git` or your distribution's package |
| Open a terminal | Spotlight (⌘ Space) → **Terminal** | Start → **PowerShell** | your terminal app |
| Where your data lives | `~/Library/Application Support/ApplyPack` | `%APPDATA%\ApplyPack` | `~/.local/share/applypack` |

Supported: macOS on Apple silicon and Intel, Windows 10/11 x64, Linux x64
and arm64.

## 1. Install Node.js

Install it with the link for your system above, then **open a new
terminal** (one that was open before the install does not see it) and
check:

```bash
node --version
```

It should print `v22` or higher.

## 2. Get ApplyPack

With Git:

```bash
git clone https://github.com/applypack/applypack.git
cd applypack
```

Without Git: on the [GitHub page](https://github.com/applypack/applypack)
press **Code → Download ZIP**, unzip it, and open a terminal in that
folder (`cd` into it).

## 3. Install and start

```bash
npm install
npm start
```

`npm install` downloads the dependencies, the database among them (that
part is 23–51 MB, depending on your system). `npm start` builds the app, starts the
database, the background worker and the dashboard, and on the first run
opens **http://127.0.0.1:4747** in your browser. A short setup wizard
takes it from there: connect an AI (paste a key), test the search, upload
your resume.

The first start takes a little longer: it creates the database and prints
the list of migrations it applies. Later starts take a few seconds.

## Every day

| To | Do |
| --- | --- |
| Start | `npm start` in the ApplyPack folder, then open http://127.0.0.1:4747 |
| Stop | **Ctrl+C** in that terminal, or `npm run stop` in another one |
| Update | `git pull` (or download the new ZIP), then `npm install` and `npm start` — your data stays, it lives outside the folder |
| Back up | stop ApplyPack and copy the data folder (the table above) somewhere safe |
| Restore | stop ApplyPack and put the copied folder back in place |
| Uninstall | delete the ApplyPack folder; delete the data folder too if you want the data gone |

ApplyPack searches while it runs. If the computer sleeps or the terminal is
closed, the hourly search waits until the next `npm start`; nothing is
lost but the time.

## Settings you may want

Copy `.env.example` to `.env` in the ApplyPack folder (`cp .env.example .env`,
or `Copy-Item .env.example .env` in PowerShell) and set:

- `WEB_PORT=4748` — if something else already uses port 4747.
- `APPLYPACK_DATA_DIR=/path/to/folder` — to keep the data somewhere else.
- `DATABASE_URL=postgresql://…` — to use a PostgreSQL 16 of your own; the
  built-in database is then never started.

Everything else — AI keys, models, Telegram or Discord, the search profile —
is set in the dashboard, not in files.

## AI engines

Pasting an API key in the setup wizard needs nothing installed. To use a
subscription you already pay for through its command-line tool (Claude
Code, Gemini CLI, Codex), install that tool and log in once; the dashboard
detects it. Every engine, step by step: [ai-engines.md](./ai-engines.md).
On Windows the command-line engines are not tested yet — use an API key
there.

## When something goes wrong

| You see | It means |
| --- | --- |
| `npm: command not found` / `'npm' is not recognized` | Node.js is not installed, or the terminal was open before you installed it: open a new one |
| `ApplyPack needs Node.js 22 or newer` | install the current LTS from nodejs.org |
| `Port 4747 is taken by another program` | set `WEB_PORT` in `.env` to a free port |
| `ApplyPack is already running` | it runs in another terminal: use that one, or `npm run stop` |
| `Postgres does not run as root` | Linux as root: start ApplyPack as your normal user, or use Docker |
| `The built-in database did not start` | the message quotes the database log; please [open an issue](https://github.com/applypack/applypack/issues/new/choose) with it |
| `ExperimentalWarning: localStorage is not available` | harmless: recent Node.js versions print it for a library ApplyPack uses |

## Docker instead

On a server, or to keep ApplyPack running without a terminal, use Docker:
[Docker Desktop](https://www.docker.com/products/docker-desktop/) on macOS
and Windows, [Docker Engine](https://docs.docker.com/engine/install/) on
Linux. Then, in the ApplyPack folder:

```bash
cp .env.example .env
docker compose up -d   # PostgreSQL + worker + dashboard → http://localhost:4747
```

Docker runs its own PostgreSQL; the two installs keep separate data.
