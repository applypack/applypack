import { config, usesBuiltInDatabase } from '../config';
import { loopbackBind } from '../dashboard-host';
import { underLauncher } from './child';

/**
 * Whether this process belongs to a local install (ADR 0054) that only this
 * machine reaches: the launcher started it, or it found its database in the
 * install's own data folder — a once-script, a dev watcher — and the
 * dashboard listens on loopback. The folder rules ask this (ADR 0062). Asked
 * of the launcher alone, `node dist/scripts/fetch-once.js` on a local install
 * took the machine for a server, refused every folder under the home
 * directory and added to its failure streak (#398). Asked without the bind,
 * `WEB_HOST=0.0.0.0 npm start` let anyone on the network read the home
 * directory through a folder source.
 */
export function localInstall(): boolean {
  return (underLauncher() || usesBuiltInDatabase) && loopbackBind(config.WEB_HOST);
}
