import { fork, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { dataDirFor, localPaths } from './data-dir';
import { LocalDatabaseError, commandLineOf, databaseAnswers, portIsFree, startLocalDatabase, type LocalDatabase } from './postgres';
import { firstLinePid } from './postgres-setup';
import { MAX_RESTARTS, isLauncherCommand, isLauncherMessage, restartDecision, type LauncherMessage } from './supervise';

/*
 * `npm start` (ADR 0054): the built-in database, then the worker, then the
 * dashboard — the two processes compose runs (ADR 0002), started in order and
 * stopped in reverse. `npm run db` runs the database alone; `npm run stop`
 * asks a running launcher to stop. This file talks to a person at a terminal,
 * so it writes plain lines; the processes it starts log through pino.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const MIN_NODE_MAJOR = 22;
const STOP_POLL_MS = 1_000;
/** The worker waits up to 60 s for an in-flight tick before it exits. */
const CHILD_STOP_GRACE_MS = 70_000;
const STOP_COMMAND_WAIT_MS = 90_000;
/** config.ts's default; the launcher cannot import config before the database URL exists. */
const DEFAULT_WEB_PORT = 4747;

type Paths = ReturnType<typeof localPaths>;

interface Child {
  name: string;
  script: string;
  process: ChildProcess | null;
  ready: boolean;
  crashes: number[];
}

const say = (line = '') => process.stdout.write(`${line}\n`);

function fail(message: string): never {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    fail(`ApplyPack needs Node.js ${MIN_NODE_MAJOR} or newer, and this is ${process.versions.node}. Install the LTS from https://nodejs.org.`);
  }
  // Before the data folder is resolved: APPLYPACK_DATA_DIR may live in .env.
  dotenv.config({ path: path.join(ROOT, '.env') });
  const dataDir = path.resolve(dataDirFor(process.platform, process.env, os.homedir()));
  const paths = localPaths(dataDir);

  const command = process.argv[2] ?? 'start';
  if (command === 'stop') return stopRunning(paths);
  if (command !== 'start' && command !== 'db') fail(`Unknown command "${command}". Use npm start, npm run db or npm run stop.`);
  await run(command === 'db', dataDir, paths);
}

async function run(databaseOnly: boolean, dataDir: string, paths: Paths): Promise<void> {
  const ownDatabase = process.env.DATABASE_URL?.trim();
  if (databaseOnly && ownDatabase) fail('DATABASE_URL is set in .env, so there is no built-in database to run.');

  // Resumes and keys live in this folder's database; nobody else on the machine needs to list it.
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  await takeLock(paths);
  // A request the last run never got to act on must not stop this one.
  fs.rmSync(paths.stopRequest, { force: true });
  if (!databaseOnly && !(await portIsFree(dashboardPort(), process.env.WEB_HOST?.trim() || '127.0.0.1'))) {
    releaseLock(paths);
    fail(`Port ${dashboardPort()} is taken by another program. Set WEB_PORT in .env to a free one, for example WEB_PORT=${dashboardPort() + 1}.`);
  }
  if (ownDatabase) {
    // Every .env copied from the old .env.example points at localhost:5432.
    const { answers, where } = await databaseAnswers(ownDatabase);
    if (!answers) {
      releaseLock(paths);
      fail(`DATABASE_URL in .env points at ${where}, and nothing answers there. Start that Postgres, or delete the DATABASE_URL line from .env to use ApplyPack's built-in database.`);
    }
  }
  const firstRun = !ownDatabase && !fs.existsSync(path.join(paths.pgdata, 'PG_VERSION'));

  let database: LocalDatabase | null = null;
  if (!ownDatabase) {
    say(firstRun ? 'Creating the database (first run)…' : 'Starting the database…');
    try {
      database = await startLocalDatabase(dataDir);
    } catch (err) {
      releaseLock(paths);
      if (err instanceof LocalDatabaseError) fail(err.message);
      throw err;
    }
  }

  const children: Child[] = databaseOnly
    ? []
    : [
        { name: 'worker', script: 'dist/index.js', process: null, ready: false, crashes: [] },
        { name: 'dashboard', script: 'dist/web/server.js', process: null, ready: false, crashes: [] },
      ];
  const env = { ...process.env, DATABASE_URL: ownDatabase || database?.url };
  let stopping = false;

  const stopAll = async (exitCode: number, message?: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    if (message) process.stderr.write(`\n${message}\n`);
    say('\nStopping ApplyPack…');
    await Promise.all(children.map(stopChild));
    await database?.stop();
    releaseLock(paths);
    say('Stopped.');
    process.exit(exitCode);
  };

  const launch = (child: Child): Promise<void> =>
    new Promise((resolve, reject) => {
      const proc = fork(path.join(ROOT, child.script), [], { cwd: ROOT, env });
      child.process = proc;
      child.ready = false;
      proc.on('message', (message) => {
        if (!isLauncherMessage(message, 'ready')) return;
        child.ready = true;
        resolve();
      });
      proc.on('exit', (code, signal) => {
        child.process = null;
        if (stopping) return;
        const how = code === null ? `signal ${signal}` : `exit code ${code}`;
        if (!child.ready) {
          reject(new Error(`The ${child.name} stopped while starting (${how}). What it said is above.`));
          return;
        }
        const decision = restartDecision(child.crashes, Date.now());
        child.crashes.push(Date.now());
        if (!decision.restart) {
          void stopAll(1, `The ${child.name} stopped ${MAX_RESTARTS} times in two minutes. What it said is above — please open an issue with it.`);
          return;
        }
        say(`The ${child.name} stopped (${how}); starting it again in ${decision.delayMs / 1000} s.`);
        setTimeout(() => {
          if (!stopping) launch(child).catch((err: Error) => void stopAll(1, err.message));
        }, decision.delayMs);
      });
    });

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      if (!stopping) {
        void stopAll(0);
        return;
      }
      // A second Ctrl+C: stop waiting for the worker's tick.
      for (const child of children) child.process?.kill('SIGKILL');
    });
  }
  // Also what keeps `npm run db` alive: it has no child to wait on.
  setInterval(() => {
    if (fs.existsSync(paths.stopRequest)) void stopAll(0);
  }, STOP_POLL_MS);

  try {
    for (const child of children) await launch(child);
  } catch (err) {
    await stopAll(1, (err as Error).message);
    return;
  }

  const url = dashboardUrl();
  say();
  say(databaseOnly ? '  The database is running; npm run dev, npm run dev:web and the scripts find it.' : `  ApplyPack is running → ${url}`);
  say(`  Data: ${ownDatabase ? 'the Postgres in DATABASE_URL' : dataDir}`);
  say('  Stop: Ctrl+C here, or npm run stop in another terminal');
  say();
  if (firstRun && !databaseOnly) openBrowser(url);
}

/**
 * One launcher per data folder: a second `npm start` would otherwise stop the
 * first one's database. Created exclusively, so two starts in the same second
 * cannot both win; a lock whose PID is no launcher is what a killed run left.
 */
async function takeLock(paths: Paths): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(paths.lock, `${process.pid}\n`, { flag: 'wx' });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const pid = firstLinePid(readText(paths.lock));
    if (pid !== null && pid !== process.pid && isLauncherCommand(await commandLineOf(pid))) {
      say(`ApplyPack is already running → ${dashboardUrl()}`);
      say('Stop it with npm run stop, or Ctrl+C in its terminal.');
      process.exit(0);
    }
    fs.rmSync(paths.lock, { force: true });
  }
  fail(`Could not take ${paths.lock}. Is another ApplyPack starting right now?`);
}

function releaseLock(paths: Paths): void {
  fs.rmSync(paths.lock, { force: true });
  fs.rmSync(paths.stopRequest, { force: true });
}

function stopChild(child: Child): Promise<void> {
  const proc = child.process;
  if (!proc) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => proc.kill('SIGKILL'), CHILD_STOP_GRACE_MS);
    proc.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    const shutdown: LauncherMessage = { type: 'shutdown' };
    if (proc.connected) proc.send(shutdown);
    else proc.kill('SIGTERM');
  });
}

async function stopRunning(paths: Paths): Promise<void> {
  const pid = firstLinePid(readText(paths.lock));
  if (pid === null || !isLauncherCommand(await commandLineOf(pid))) {
    say('ApplyPack is not running.');
    return;
  }
  fs.writeFileSync(paths.stopRequest, '');
  say('Asked ApplyPack to stop; waiting…');
  const deadline = Date.now() + STOP_COMMAND_WAIT_MS;
  while (Date.now() < deadline) {
    if (!fs.existsSync(paths.lock)) {
      say('Stopped.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
  }
  fail(`ApplyPack did not stop within ${STOP_COMMAND_WAIT_MS / 1000} seconds. Look at the terminal it runs in.`);
}

function dashboardPort(): number {
  return Number(process.env.WEB_PORT?.trim()) || DEFAULT_WEB_PORT;
}

function dashboardUrl(): string {
  const host = process.env.WEB_HOST?.trim();
  const shown = !host || host === '0.0.0.0' ? '127.0.0.1' : host;
  return `http://${shown}:${dashboardPort()}`;
}

function openBrowser(url: string): void {
  if (process.env.CI || process.env.APPLYPACK_NO_OPEN) return;
  const [command, args]: [string, string[]] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['explorer.exe', [url]]
    : ['xdg-open', [url]];
  const opener = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
  opener.on('error', () => undefined);
  opener.unref();
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

main().catch((err: unknown) => {
  fail(`ApplyPack could not start: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
});
