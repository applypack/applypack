import { usesBuiltInDatabase } from '../config';
import { underLauncher } from './child';

/**
 * Whether this process belongs to a local install (ADR 0054): the launcher
 * started it, or it found its database in the install's own data folder — a
 * once-script, a dev watcher. The folder rules ask this (ADR 0062). Asked of
 * the launcher alone, `node dist/scripts/fetch-once.js` on a local install
 * took the machine for a server, refused every folder under the home
 * directory and added to its failure streak (#398).
 */
export function localInstall(): boolean {
  return underLauncher() || usesBuiltInDatabase;
}
