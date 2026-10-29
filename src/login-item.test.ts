import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginItemFor, type LoginItemContext } from './login-item';

// TASKS S5: the login entry each system reads, written for this checkout and this Node.
const MAC: LoginItemContext = {
  platform: 'darwin',
  home: '/Users/me',
  env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin' },
  dotEnv: {},
  node: '/opt/homebrew/bin/node',
  launcher: '/Users/me/apps/Apply & Pack/dist/local/launcher.js',
  root: '/Users/me/apps/Apply & Pack',
  logFile: '/Users/me/Library/Application Support/ApplyPack/logs/launcher.log',
};

test('macOS: a launchd agent that runs npm start at login, with the PATH the CLIs need', () => {
  const item = loginItemFor(MAC)!;
  assert.equal(item.file, '/Users/me/Library/LaunchAgents/io.applypack.launcher.plist');
  assert.match(item.contents, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(item.contents, /<string>\/opt\/homebrew\/bin\/node<\/string><string>\/Users\/me\/apps\/Apply &amp; Pack\/dist\/local\/launcher.js<\/string><string>start<\/string>/);
  assert.match(item.contents, /<key>PATH<\/key><string>\/opt\/homebrew\/bin:\/usr\/bin:\/bin<\/string>/);
  assert.match(item.contents, /<key>APPLYPACK_NO_OPEN<\/key><string>1<\/string>/);
  assert.ok(!item.contents.includes('APPLYPACK_DATA_DIR'), 'no data folder unless one was set');
  assert.deepEqual(item.enable, []);
});

test('Linux: a systemd user service, enabled and disabled by systemctl, every value quoted', () => {
  const item = loginItemFor({
    ...MAC,
    platform: 'linux',
    home: '/home/me',
    env: { PATH: '/usr/bin:/bin', APPLYPACK_DATA_DIR: '/data/100% mine' },
    node: '/usr/bin/node',
    launcher: '/home/me/applypack/dist/local/launcher.js',
    root: '/home/me/applypack',
  })!;
  assert.equal(item.file, '/home/me/.config/systemd/user/applypack.service');
  assert.match(item.contents, /^ExecStart="\/usr\/bin\/node" "\/home\/me\/applypack\/dist\/local\/launcher.js" "start"$/m);
  assert.match(item.contents, /^Environment="APPLYPACK_DATA_DIR=\/data\/100%% mine"$/m);
  assert.match(item.contents, /^WantedBy=default.target$/m);
  assert.deepEqual(item.enable.at(-1), ['systemctl', '--user', 'enable', 'applypack.service']);
  assert.deepEqual(item.disable, [['systemctl', '--user', 'disable', 'applypack.service']]);
  assert.equal(loginItemFor({ ...MAC, platform: 'linux', env: { XDG_CONFIG_HOME: '/cfg' } })!.file, '/cfg/systemd/user/applypack.service');
});

test('Windows: a script in the Startup folder that starts the launcher minimised', () => {
  const item = loginItemFor({
    ...MAC,
    platform: 'win32',
    home: 'C:\\Users\\me',
    env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming', PATH: 'C:\\Windows;C:\\npm' },
    node: 'C:\\Program Files\\nodejs\\node.exe',
    launcher: 'C:\\apps\\applypack\\dist\\local\\launcher.js',
    root: 'C:\\apps\\applypack',
  })!;
  assert.equal(item.file, 'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\ApplyPack.cmd');
  assert.match(item.contents, /cd \/d "C:\\apps\\applypack"/);
  assert.match(item.contents, /start "ApplyPack" \/min "C:\\Program Files\\nodejs\\node.exe" "C:\\apps\\applypack\\dist\\local\\launcher.js" start/);
  assert.ok(item.contents.includes('\r\n'), 'cmd.exe line endings');
});

test('a system it cannot write for gets no entry', () => {
  assert.equal(loginItemFor({ ...MAC, platform: 'freebsd' }), null);
});

test('the port, the zone and the folders set where it was started are carried, and .env keeps its own (#650)', () => {
  const env = {
    PATH: '/usr/bin',
    WEB_PORT: '4848',
    TZ: 'Europe/Kyiv',
    APPLYPACK_SNAPSHOTS: '0',
    APPLYPACK_INBOX_ROOTS: '/Users/me/inbox',
    APPLYPACK_DATA_DIR: '/Users/me/ap-data',
    // Read from .env again at login: written here too, it would outrank the next edit there.
    LOG_LEVEL: 'debug',
  };
  const mac = loginItemFor({ ...MAC, env, dotEnv: { APPLYPACK_DATA_DIR: '/Users/me/ap-data', TZ: 'UTC' } })!.contents;
  assert.match(mac, /<key>WEB_PORT<\/key><string>4848<\/string>/);
  assert.match(mac, /<key>TZ<\/key><string>Europe\/Kyiv<\/string>/, 'the shell said another zone than .env, and the shell is what runs');
  assert.match(mac, /<key>APPLYPACK_SNAPSHOTS<\/key><string>0<\/string>/);
  assert.match(mac, /<key>APPLYPACK_INBOX_ROOTS<\/key><string>\/Users\/me\/inbox<\/string>/);
  assert.ok(!mac.includes('APPLYPACK_DATA_DIR'), '.env sets the same folder, and .env is read at login');
  assert.ok(!mac.includes('LOG_LEVEL'), 'only the launcher\'s own settings');
  const linux = loginItemFor({ ...MAC, platform: 'linux', env, dotEnv: {} })!.contents;
  assert.match(linux, /^Environment="WEB_PORT=4848"$/m);
  assert.match(linux, /^Environment="APPLYPACK_DATA_DIR=\/Users\/me\/ap-data"$/m);
  const win = loginItemFor({ ...MAC, platform: 'win32', home: 'C:\\Users\\me', env: { ...env, APPDATA: 'C:\\AppData' }, dotEnv: {} })!.contents;
  assert.match(win, /set "TZ=Europe\/Kyiv"/);
});

test('no secret and no listening address is ever written into the entry (#650)', () => {
  const env = {
    PATH: '/usr/bin',
    WEB_HOST: '0.0.0.0',
    WEB_BASIC_AUTH: 'me:secret',
    ANTHROPIC_API_KEY: 'sk-ant-secret',
    TELEGRAM_BOT_TOKEN: '123:secret',
    DATABASE_URL: 'postgresql://u:secret@127.0.0.1/db',
  };
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    const contents = loginItemFor({ ...MAC, platform, env, dotEnv: {} })!.contents;
    assert.ok(!/secret|WEB_HOST|0\.0\.0\.0/.test(contents), platform);
  }
});
