import { statSync, watch, type FSWatcher } from 'node:fs';
import { AtsType } from '@prisma/client';
import { readSourceConfig } from '../datasets/map';
import { prisma } from '../db';
import { logger } from '../logger';
import { WATCH_REFRESH_MS, WATCH_RETRY_MS, WATCH_SETTLE_MS, watchChanges, worthALook } from './folder-watch-plan';

/*
 * A posting saved into a folder is read within a minute on a local install
 * (ADR 0062): the worker watches the folders of the saved-postings sources
 * that are switched on, lets a burst of changes settle, then asks for a look
 * at that one source (`check`, which the worker wires to a scoped fetch under
 * the fetch lock). Only under the launcher: a change seen through a Docker
 * bind mount is not reliable, so a server stays on the hourly tick. A
 * watcher only notices; it reads nothing and writes nothing.
 */

/** What the worker does when a folder settled: a look at that source. `busy` = another fetch held the lock; try again later. */
export type FolderCheck = (companyId: number) => Promise<'done' | 'busy'>;

export interface FolderWatch {
  stop(): void;
}

/** The switched-on folders of saved postings, by source id. */
async function wantedFolders(): Promise<Map<number, string>> {
  const rows = await prisma.company.findMany({ where: { atsType: AtsType.FOLDER, active: true }, select: { id: true, atsToken: true, sourceConfig: true } });
  return new Map(rows.filter((r) => readSourceConfig(r.sourceConfig)?.holds === 'postings').map((r) => [r.id, r.atsToken]));
}

/** The folder's inode, or null when it is gone: a folder deleted and made again is a new one to watch. */
function inodeOf(path: string): number | null {
  try {
    return statSync(path).ino;
  } catch {
    return null;
  }
}

export function startFolderWatch(check: FolderCheck): FolderWatch {
  const watchers = new Map<number, { path: string; ino: number | null; watcher: FSWatcher }>();
  const timers = new Map<number, NodeJS.Timeout>();
  /** Folders waiting in the queue: a second change before the look starts adds nothing. */
  const queued = new Set<number>();
  /** Folders that could not be watched: said once, tried again at every refresh. */
  const unwatchable = new Set<number>();
  let running: Promise<void> = Promise.resolve();
  let stopped = false;

  // One look at a time, in the order the folders settled.
  const enqueue = (id: number): void => {
    if (queued.has(id)) return;
    queued.add(id);
    running = running
      .then(async () => {
        queued.delete(id);
        if (stopped) return;
        if ((await check(id)) === 'busy') later(id, WATCH_RETRY_MS);
      })
      .catch((err) => logger.warn({ err, companyId: id }, 'folder-watch: the look failed'));
  };
  const later = (id: number, ms: number): void => {
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        enqueue(id);
      }, ms).unref(),
    );
  };

  const open = (id: number, path: string): void => {
    const onChange = (_event: string, filename: string | Buffer | null): void => {
      if (worthALook(filename === null ? null : String(filename))) later(id, WATCH_SETTLE_MS);
    };
    let watcher: FSWatcher;
    try {
      watcher = watch(path, { recursive: true, persistent: false }, onChange);
    } catch (err) {
      // A system without recursive watching still sees the folder itself; deeper files wait for the hourly tick.
      try {
        watcher = watch(path, { persistent: false }, onChange);
      } catch {
        if (!unwatchable.has(id)) logger.warn({ err, companyId: id }, 'folder-watch: the folder cannot be watched; the hourly check reads it');
        unwatchable.add(id);
        return;
      }
    }
    unwatchable.delete(id);
    // A watcher that stops is opened again at the next refresh.
    watcher.on('error', (err) => {
      logger.warn({ err, companyId: id }, 'folder-watch: watcher stopped');
      watcher.close();
      watchers.delete(id);
    });
    watchers.set(id, { path, ino: inodeOf(path), watcher });
  };

  const refresh = async (): Promise<void> => {
    if (stopped) return;
    // A folder deleted, or deleted and made again, leaves a watcher on nothing: close it, and it is opened again below.
    for (const [id, w] of watchers) {
      if (inodeOf(w.path) !== w.ino) {
        w.watcher.close();
        watchers.delete(id);
      }
    }
    const current = new Map([...watchers].map(([id, w]) => [id, w.path]));
    const { start, stop } = watchChanges(await wantedFolders(), current);
    for (const id of stop) {
      watchers.get(id)?.watcher.close();
      watchers.delete(id);
    }
    for (const { id, path } of start) open(id, path);
    if (start.length > 0 || stop.length > 0) logger.info({ watching: watchers.size }, 'folder-watch: folders watched');
  };

  const tick = (): void => void refresh().catch((err) => logger.warn({ err }, 'folder-watch: the list of folders was not read'));
  tick();
  const interval = setInterval(tick, WATCH_REFRESH_MS).unref();

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
      for (const timer of timers.values()) clearTimeout(timer);
      for (const { watcher } of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}
