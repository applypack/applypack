import path from 'node:path';

/** Moves the data folder: a second install, a disk with more room, a CI runner. */
export const DATA_DIR_ENV = 'APPLYPACK_DATA_DIR';

/**
 * Where a local install keeps its database, logs and lock: the system's own
 * place for application data, so a fresh clone or a new ZIP finds the data
 * the last one left (ADR 0054). Pure: the caller passes platform, env, home.
 */
export function dataDirFor(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  const override = env[DATA_DIR_ENV]?.trim();
  if (override) return override;
  if (platform === 'win32') {
    return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'ApplyPack');
  }
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'ApplyPack');
  return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share'), 'applypack');
}

/** The files a local install keeps inside its data folder. */
export function localPaths(dataDir: string) {
  return {
    pgdata: path.join(dataDir, 'postgres'),
    state: path.join(dataDir, 'db.json'),
    lock: path.join(dataDir, 'applypack.pid'),
    stopRequest: path.join(dataDir, 'stop-requested'),
    postgresLog: path.join(dataDir, 'logs', 'postgres.log'),
    initdbPassword: path.join(dataDir, 'initdb-password'),
  };
}
