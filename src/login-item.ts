import path from 'node:path';

/*
 * What makes the system start ApplyPack when the user logs in (TASKS S5): a
 * launchd agent on macOS, a systemd user service on Linux, a script in the
 * Startup folder on Windows. Each runs the same `npm start` launcher, from
 * this checkout, under this Node, with the PATH the user has now — a login
 * session's own PATH would not find the CLI engines. Opt-in from the
 * dashboard, with the undo beside it (Q29). Pure: the dashboard writes it.
 */

export interface LoginItemContext {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  /** What this checkout's `.env` sets: the start at login reads it again. */
  dotEnv: Readonly<Record<string, string>>;
  /** The Node running ApplyPack now, the launcher script, the checkout it lives in. */
  node: string;
  launcher: string;
  root: string;
  /** Where the launcher's own lines go: the data folder's logs. */
  logFile: string;
}

export interface LoginItem {
  file: string;
  contents: string;
  /** Run after the file is written, and before it is removed. */
  enable: string[][];
  disable: string[][];
  /** What the page calls it. */
  kind: string;
}

const LABEL = 'io.applypack.launcher';
const UNIT = 'applypack.service';

/**
 * The launcher's own settings, carried from the environment the entry is
 * written in (#650): exported in a shell rather than written into `.env`, they
 * were lost, and the start at login served on another port or read its hours
 * in UTC. Never a key, a token or a password — those live in `.env` alone —
 * and never WEB_HOST: an address off this machine is guarded by
 * WEB_BASIC_AUTH, and the entry would carry the one without the other.
 */
const CARRIED_SETTINGS = ['APPLYPACK_DATA_DIR', 'WEB_PORT', 'TZ', 'APPLYPACK_SNAPSHOTS', 'APPLYPACK_INBOX_ROOTS'] as const;

/**
 * What the launcher is started with: no browser tab at login, the PATH the
 * CLIs need, and each carried setting set here — unless `.env` sets it the
 * same way, so a later edit to `.env` is not outranked by the entry.
 */
function launchEnv(ctx: LoginItemContext): [string, string][] {
  const carried = CARRIED_SETTINGS.flatMap((key): [string, string][] => {
    const value = ctx.env[key]?.trim();
    return value && value !== ctx.dotEnv[key]?.trim() ? [[key, value]] : [];
  });
  return [['APPLYPACK_NO_OPEN', '1'], ['PATH', ctx.env.PATH ?? ''], ...carried];
}

export function loginItemFor(ctx: LoginItemContext): LoginItem | null {
  switch (ctx.platform) {
    case 'darwin':
      return {
        file: path.posix.join(ctx.home, 'Library', 'LaunchAgents', `${LABEL}.plist`),
        contents: launchdPlist(ctx),
        enable: [],
        disable: [],
        kind: 'a launchd agent',
      };
    case 'linux':
      return {
        file: path.posix.join(ctx.env.XDG_CONFIG_HOME?.trim() || path.posix.join(ctx.home, '.config'), 'systemd', 'user', UNIT),
        contents: systemdUnit(ctx),
        enable: [
          ['systemctl', '--user', 'daemon-reload'],
          ['systemctl', '--user', 'enable', UNIT],
        ],
        disable: [['systemctl', '--user', 'disable', UNIT]],
        kind: 'a systemd user service',
      };
    case 'win32': {
      const appData = ctx.env.APPDATA?.trim() || path.win32.join(ctx.home, 'AppData', 'Roaming');
      return {
        file: path.win32.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'ApplyPack.cmd'),
        contents: startupScript(ctx),
        enable: [],
        disable: [],
        kind: 'a script in your Startup folder',
      };
    }
    default:
      return null;
  }
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function launchdPlist(ctx: LoginItemContext): string {
  const str = (s: string) => `<string>${xml(s)}</string>`;
  const env = launchEnv(ctx)
    .map(([k, v]) => `    <key>${xml(k)}</key>${str(v)}`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${str(LABEL)}
  <key>ProgramArguments</key>
  <array>${str(ctx.node)}${str(ctx.launcher)}${str('start')}</array>
  <key>WorkingDirectory</key>${str(ctx.root)}
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>StandardOutPath</key>${str(ctx.logFile)}
  <key>StandardErrorPath</key>${str(ctx.logFile)}
</dict>
</plist>
`;
}

/** A systemd argument or assignment: quoted, with `\`, `"` and the specifier `%` escaped. */
const unitQuote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;

function systemdUnit(ctx: LoginItemContext): string {
  const env = launchEnv(ctx)
    .map(([k, v]) => `Environment=${unitQuote(`${k}=${v}`)}`)
    .join('\n');
  return `[Unit]
Description=ApplyPack (npm start)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${unitQuote(ctx.root)}
ExecStart=${[ctx.node, ctx.launcher, 'start'].map(unitQuote).join(' ')}
${env}

[Install]
WantedBy=default.target
`;
}

/** A cmd.exe value inside double quotes: `%` doubled, so a path is never read as a variable. */
const cmdQuote = (s: string) => `"${s.replace(/%/g, '%%')}"`;

function startupScript(ctx: LoginItemContext): string {
  const env = launchEnv(ctx)
    .map(([k, v]) => `set ${cmdQuote(`${k}=${v}`)}`)
    .join('\r\n');
  return [
    '@echo off',
    'rem ApplyPack starts at login: remove this file, or press "Stop starting at login" on Settings.',
    `cd /d ${cmdQuote(ctx.root)}`,
    env,
    `start "ApplyPack" /min ${cmdQuote(ctx.node)} ${cmdQuote(ctx.launcher)} start`,
    '',
  ].join('\r\n');
}
