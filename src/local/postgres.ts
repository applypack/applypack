import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { localPaths } from './data-dir';
import { LOCAL_DB_USER, PREFERRED_PORT, databaseUrl, parseDbState, type DbState } from './db-state';
import {
  CONF_LINES,
  binaries,
  firstLinePid,
  initdbArgs,
  lastLines,
  leftoverAction,
  pgCtlStartArgs,
  pgCtlStopArgs,
  platformPackage,
  type PgBinaries,
} from './postgres-setup';

/*
 * The built-in database's I/O (ADR 0054): find the binaries, create the
 * cluster once, clear what a killed run left, start and stop it with pg_ctl.
 * The decisions live in postgres-setup.ts.
 */

const execFileAsync = promisify(execFile);
const PASSWORD_BYTES = 32;
const LOG_LINES_ON_FAILURE = 15;
const COMMAND_LOOKUP_TIMEOUT_MS = 15_000;

/** A failure the person at the terminal can act on; the message says how. */
export class LocalDatabaseError extends Error {}

export interface LocalDatabase {
  url: string;
  stop(): Promise<void>;
}

const SymlinkListSchema = z.array(z.object({ source: z.string(), target: z.string() }));

export async function startLocalDatabase(dataDir: string): Promise<LocalDatabase> {
  if (process.platform !== 'win32' && process.getuid?.() === 0) {
    throw new LocalDatabaseError('Postgres does not run as root. Start ApplyPack as your normal user, or use Docker on a server.');
  }
  const pkg = platformPackage(process.platform, process.arch);
  if (!pkg) {
    throw new LocalDatabaseError(
      `There is no built-in database for ${process.platform}-${process.arch}. Set DATABASE_URL in .env to a Postgres 16 of your own.`,
    );
  }
  const root = packageRoot(pkg);
  repairSymlinks(root);
  const bins = binaries(root, process.platform);
  const paths = localPaths(dataDir);
  fs.mkdirSync(path.dirname(paths.postgresLog), { recursive: true });

  const state = readState(paths.state) ?? (await createState(paths.state));
  if (!fs.existsSync(path.join(paths.pgdata, 'PG_VERSION'))) await createCluster(bins, paths, state);
  await clearLeftover(bins.pgCtl, paths.pgdata);
  if (!(await portIsFree(state.port))) {
    state.port = await anyFreePort();
    writeState(paths.state, state);
  }

  const started = await run(bins.pgCtl, pgCtlStartArgs(paths.pgdata, paths.postgresLog, state.port));
  if (started.code !== 0) {
    throw new LocalDatabaseError(
      `The built-in database did not start. The end of ${paths.postgresLog}:\n\n${lastLines(readText(paths.postgresLog), LOG_LINES_ON_FAILURE)}`,
    );
  }
  return {
    url: databaseUrl(state),
    stop: async () => {
      await run(bins.pgCtl, pgCtlStopArgs(paths.pgdata));
    },
  };
}

/** The command line of a running process, or null when there is none. */
export async function commandLineOf(pid: number): Promise<string | null> {
  try {
    const { stdout } =
      process.platform === 'win32'
        ? await execFileAsync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
            { timeout: COMMAND_LOOKUP_TIMEOUT_MS, windowsHide: true },
          )
        : await execFileAsync('ps', ['-o', 'command=', '-p', String(pid)], { timeout: COMMAND_LOOKUP_TIMEOUT_MS });
    const line = stdout.trim();
    return line.length > 0 ? line : null;
  } catch {
    // ps exits 1 when no such process exists.
    return null;
  }
}

/** The package exports dist/index.js; its binaries sit in native/ beside dist/. */
function packageRoot(pkg: string): string {
  const rootFrom = (base: string) => path.resolve(path.dirname(require.resolve(pkg, { paths: [base] })), '..');
  try {
    return rootFrom(__dirname);
  } catch {
    try {
      // npm nests it under embedded-postgres when it cannot hoist it.
      return rootFrom(path.dirname(require.resolve('embedded-postgres')));
    } catch {
      throw new LocalDatabaseError(`${pkg} is not installed. Run npm install again in the ApplyPack folder.`);
    }
  }
}

/**
 * npm tarballs cannot hold symlinks, so the binary package recreates its
 * library links in a postinstall script — which pnpm and ignore-scripts skip,
 * and which npm says it will stop running unreviewed. Without the links
 * Postgres cannot load its own libraries.
 */
function repairSymlinks(root: string): void {
  const listFile = path.join(root, 'native', 'pg-symlinks.json');
  if (!fs.existsSync(listFile)) return;
  const links = SymlinkListSchema.parse(JSON.parse(fs.readFileSync(listFile, 'utf8')));
  for (const { source, target } of links) {
    const link = path.join(root, target);
    if (fs.lstatSync(link, { throwIfNoEntry: false })) continue;
    fs.symlinkSync(path.relative(path.dirname(link), path.join(root, source)), link);
  }
}

function readState(file: string): DbState | null {
  const text = readText(file);
  return text ? parseDbState(text) : null;
}

function writeState(file: string, state: DbState): void {
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function createState(file: string): Promise<DbState> {
  const port = (await portIsFree(PREFERRED_PORT)) ? PREFERRED_PORT : await anyFreePort();
  const state: DbState = { port, user: LOCAL_DB_USER, password: randomBytes(PASSWORD_BYTES).toString('base64url') };
  writeState(file, state);
  return state;
}

async function createCluster(bins: PgBinaries, paths: ReturnType<typeof localPaths>, state: DbState): Promise<void> {
  const existed = fs.existsSync(paths.pgdata);
  fs.writeFileSync(paths.initdbPassword, `${state.password}\n`, { mode: 0o600 });
  try {
    const result = await run(bins.initdb, initdbArgs(paths.pgdata, state.user, paths.initdbPassword, process.platform), true);
    if (result.code !== 0) {
      // A half-made folder would stop every later attempt; one this run did not make is not ours to delete.
      if (!existed) fs.rmSync(paths.pgdata, { recursive: true, force: true });
      throw new LocalDatabaseError(`Could not create the built-in database:\n\n${lastLines(result.stderr, LOG_LINES_ON_FAILURE)}`);
    }
  } finally {
    fs.rmSync(paths.initdbPassword, { force: true });
  }
  fs.appendFileSync(path.join(paths.pgdata, 'postgresql.conf'), CONF_LINES);
}

async function clearLeftover(pgCtl: string, pgdata: string): Promise<void> {
  const pidFile = path.join(pgdata, 'postmaster.pid');
  const text = readText(pidFile);
  if (!text) return;
  const pid = firstLinePid(text);
  const action = leftoverAction(pid, pid === null ? null : await commandLineOf(pid), pgdata);
  if (action === 'stop') await run(pgCtl, pgCtlStopArgs(pgdata));
  else fs.rmSync(pidFile, { force: true });
}

export function portIsFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

function anyFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Resolves on 'exit', not 'close': on Windows the server pg_ctl starts can
 * inherit a pipe and hold it open for its whole life. pg_ctl writes its own
 * news to the log, so only initdb's stderr is kept.
 */
function run(command: string, args: string[], keepStderr = false): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', keepStderr ? 'pipe' : 'ignore'], windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => resolve({ code: null, stderr: err.message }));
    child.on('exit', (code) => resolve({ code, stderr }));
  });
}
