import path from 'node:path';

/*
 * The built-in Postgres as arguments and decisions, no I/O (ADR 0054). The
 * binaries come from the `@embedded-postgres/<platform>` package; none of that
 * package's JavaScript runs — `pg_ctl` starts the server in its own session,
 * so a Ctrl+C reaches the launcher first and the database stops last.
 */

const PLATFORM_PACKAGES: Record<string, string> = {
  'darwin-arm64': '@embedded-postgres/darwin-arm64',
  'darwin-x64': '@embedded-postgres/darwin-x64',
  'linux-arm64': '@embedded-postgres/linux-arm64',
  'linux-x64': '@embedded-postgres/linux-x64',
  'win32-x64': '@embedded-postgres/windows-x64',
};

/** How long pg_ctl waits for the server to start or stop. */
const PG_CTL_WAIT_SECONDS = 60;

export interface PgBinaries {
  initdb: string;
  pgCtl: string;
}

export function platformPackage(platform: NodeJS.Platform, arch: string): string | null {
  return PLATFORM_PACKAGES[`${platform}-${arch}`] ?? null;
}

export function binaries(packageRoot: string, platform: NodeJS.Platform): PgBinaries {
  const exe = platform === 'win32' ? '.exe' : '';
  const bin = (name: string) => path.join(packageRoot, 'native', 'bin', `${name}${exe}`);
  return { initdb: bin('initdb'), pgCtl: bin('pg_ctl') };
}

/**
 * The encoding and locale are explicit because initdb otherwise takes them
 * from the shell that runs it: with no LANG it makes SQL_ASCII, where
 * `'Київ' ILIKE '%КИЇВ%'` is false. C.UTF-8 matches the compose database,
 * sort order included; Windows has no such locale name, so ICU there.
 */
export function initdbArgs(pgdata: string, user: string, passwordFile: string, platform: NodeJS.Platform): string[] {
  const locale = platform === 'win32' ? ['--locale-provider=icu', '--icu-locale=und', '--locale=C'] : ['--locale=C.UTF-8'];
  return [
    `--pgdata=${pgdata}`,
    '--auth=scram-sha-256',
    `--username=${user}`,
    `--pwfile=${passwordFile}`,
    '--encoding=UTF8',
    ...locale,
  ];
}

/**
 * Appended to postgresql.conf once, after initdb. Loopback only, no socket in
 * a shared /tmp, and UTC like compose: initdb takes the machine's time zone,
 * and every `DEFAULT CURRENT_TIMESTAMP` column would store local time.
 */
export const CONF_LINES = [
  '',
  "# Written by ApplyPack's launcher (ADR 0054).",
  "listen_addresses = '127.0.0.1'",
  "unix_socket_directories = ''",
  "timezone = 'UTC'",
  "log_timezone = 'UTC'",
  '',
].join('\n');

export function pgCtlStartArgs(pgdata: string, logFile: string, port: number): string[] {
  return ['start', '-w', '-t', String(PG_CTL_WAIT_SECONDS), '-D', pgdata, '-l', logFile, '-o', `-p ${port}`];
}

export function pgCtlStopArgs(pgdata: string): string[] {
  return ['stop', '-w', '-t', String(PG_CTL_WAIT_SECONDS), '-D', pgdata, '-m', 'fast'];
}

/** The PID on the first line of a pid file (postmaster.pid, the launcher's lock), or null. */
export function firstLinePid(fileText: string): number | null {
  const first = fileText.split(/\r?\n/, 1)[0]?.trim() ?? '';
  return /^\d+$/.test(first) && Number(first) > 0 ? Number(first) : null;
}

/**
 * A look at a process that got no answer in time. The look runs PowerShell on
 * Windows and `ps` elsewhere, and on a busy machine either can take longer
 * than its limit. That is not "no such process": read as one, `npm run stop`
 * said "ApplyPack is not running" and left it running, and a start could have
 * taken a live launcher's lock or deleted a live database's pid file.
 */
export const NO_ANSWER = Symbol('no answer');
/** What a look at a process found: its command line, null when there is no such process, or no answer. */
export type ProcessLookup = string | null | typeof NO_ANSWER;

export type LeftoverAction = 'stop' | 'remove' | 'unsure';

/**
 * What to do with a postmaster.pid the last run left. A launcher killed hard
 * leaves its server running: stop it. After a reboot the number may belong to
 * another process, and `pg_ctl stop` would signal that one — so the file is
 * only removed unless the process is a postgres serving this very folder. An
 * unreadable file is removed too: Postgres refuses to start over one.
 *
 * `unsure`: the process is there and nothing could say what it is. Removing
 * the file then could start a second server on a folder a first one still
 * writes to, so the start stops and says so.
 */
export function leftoverAction(pid: number | null, commandLine: ProcessLookup, pgdata: string, alive = true): LeftoverAction {
  if (commandLine === NO_ANSWER) return pid !== null && alive ? 'unsure' : 'remove';
  if (pid === null || commandLine === null) return 'remove';
  const normalise = (s: string) => s.replace(/\\/g, '/').toLowerCase();
  return normalise(commandLine).includes(normalise(pgdata)) ? 'stop' : 'remove';
}

/** Tail of a log for an error message. */
export function lastLines(text: string, count: number): string {
  return text.trimEnd().split(/\r?\n/).slice(-count).join('\n');
}
