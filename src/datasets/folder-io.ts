/*
 * The one module that touches a folder the user named (ADR 0062) — and it
 * only reads: a listing, a file's bytes, their hash. Nothing in ApplyPack
 * writes, moves, renames or deletes anything in such a folder; its state
 * lives in the ledger (`source_file`). folder-io.test.ts holds this file to
 * that, call by call.
 *
 * Symlinks are not followed: a link in the listing is skipped, a file is
 * opened with O_NOFOLLOW, and its real path has to lie beneath the folder's.
 */

import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t } from '../i18n/t';
import { dataDirFor } from '../local/data-dir';
import { inboxRoots, insideFolder, type FolderRules } from './folder-path';
import { MAX_DEPTH, MAX_ENTRIES, MAX_FILE_BYTES, type FileRead, type ListedFile } from './folder-scan';

/** Why a folder could not be looked at, as a code the page and the health row put into words. */
export type FolderFault = 'missing' | 'not-a-folder' | 'refused' | 'too-many' | 'not-allowed' | 'unmapped';

export class FolderError extends Error {
  override name = 'FolderError';
  constructor(
    readonly fault: FolderFault,
    message: string,
  ) {
    super(message);
  }
}

/** A size past this is recorded as this: what the ledger's column holds, and far past what is read. */
const MAX_RECORDED_BYTES = 2_147_483_647;

const REFUSED_CODES = new Set(['EACCES', 'EPERM']);
/** Nothing is there, or the path cannot name a place: too long, a loop of links, a name the system refuses. */
const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR', 'ENAMETOOLONG', 'ELOOP', 'EINVAL']);

function codeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

/** What the system said about a folder, as a fault with a sentence. An error with no code is not the system's and is thrown on. */
function folderError(err: unknown, folder: string): FolderError {
  if (err instanceof FolderError) return err;
  const code = codeOf(err);
  if (MISSING_CODES.has(code)) return new FolderError('missing', t('datasets.folder.missing', { path: folder }));
  if (code.length > 0) return new FolderError('refused', t('datasets.folder.refused', { path: folder, code }));
  throw err;
}

/**
 * The rules as they hold for this process (folder-path.ts): the real paths
 * of the home directory, of the install's data folder and of the roots named
 * in APPLYPACK_INBOX_ROOTS. A place that does not exist keeps its spelling,
 * and then matches nothing real.
 */
export async function currentFolderRules(launcher: boolean, roots: string | undefined): Promise<FolderRules> {
  const real = (p: string): Promise<string> => fs.realpath(p).catch(() => path.resolve(p));
  const home = os.homedir();
  return {
    launcher,
    home: await real(home),
    dataDir: await real(dataDirFor(process.platform, process.env, home)),
    roots: await Promise.all(inboxRoots(roots).map(real)),
  };
}

/** The folder's real path — every link in it resolved — or a `FolderError` saying why it cannot be read. */
export async function realFolder(folder: string): Promise<string> {
  try {
    const real = await fs.realpath(folder);
    if (!(await fs.stat(real)).isDirectory()) throw new FolderError('not-a-folder', t('datasets.folder.notAFolder', { path: folder }));
    return real;
  } catch (err) {
    throw folderError(err, folder);
  }
}

/**
 * Every regular file under a real folder path, at most `MAX_DEPTH` folders
 * deep. Dotfiles, hidden folders and links are passed over; a subfolder the
 * system will not open is passed over too, since one locked corner should not
 * blind the look. A folder of more than `MAX_ENTRIES` entries is refused
 * whole: it is not a folder of job files.
 */
export async function listFolder(root: string): Promise<ListedFile[]> {
  const files: ListedFile[] = [];
  let entries = 0;
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    let children;
    try {
      children = await fs.opendir(dir);
    } catch (err) {
      // One corner the system will not open does not blind the look; the root itself does.
      if (depth > 1 && codeOf(err).length > 0) return;
      throw folderError(err, root);
    }
    // Entry by entry, so a folder of millions of files is refused before it is held in memory.
    for await (const child of children) {
      if (++entries > MAX_ENTRIES) {
        throw new FolderError('too-many', t('datasets.folder.tooMany', { path: root, n: MAX_ENTRIES }));
      }
      if (child.name.startsWith('.') || child.isSymbolicLink()) continue;
      const relPath = rel === '' ? child.name : `${rel}/${child.name}`;
      if (child.isDirectory()) {
        if (depth < MAX_DEPTH) await walk(path.join(dir, child.name), relPath, depth + 1);
      } else if (child.isFile()) {
        // Gone between the listing and the stat: the next look will not list it.
        const stat = await fs.lstat(path.join(dir, child.name)).catch(() => null);
        if (stat?.isFile()) files.push({ relPath, size: Math.min(stat.size, MAX_RECORDED_BYTES), mtimeMs: Math.round(stat.mtimeMs) });
      }
    }
  };
  await walk(root, '', 1);
  return files;
}

/**
 * One file's bytes and their hash. The file is opened without following a
 * link, must really lie beneath the folder, and is measured before and after
 * the read: a file that moved meanwhile is still being written.
 */
export async function readFolderFile(root: string, relPath: string, maxBytes: number = MAX_FILE_BYTES): Promise<FileRead> {
  const file = path.join(root, ...relPath.split('/'));
  let handle: fs.FileHandle | undefined;
  try {
    const real = await fs.realpath(file);
    if (!insideFolder(root, real)) return { ok: false, why: 'outside' };
    // Non-blocking, so a pipe put where a file was does not hold the tick; it is then not a file and goes no further.
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const before = await handle.stat();
    if (!before.isFile()) return { ok: false, why: 'outside' };
    // The file opened is the one the real path named a moment ago, not something swapped in between.
    const named = await fs.lstat(real).catch(() => null);
    if (!named || named.ino !== before.ino || named.dev !== before.dev) return { ok: false, why: 'outside' };
    if (before.size > maxBytes) return { ok: false, why: 'too-large' };
    // Exactly the bytes it had: a file still being appended to is not read to its moving end.
    const bytes = Buffer.alloc(before.size);
    const { bytesRead } = await handle.read(bytes, 0, before.size, 0);
    const after = await handle.stat();
    if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) return { ok: false, why: 'changing' };
    return { ok: true, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), size: after.size, mtimeMs: Math.round(after.mtimeMs) };
  } catch (err) {
    const code = codeOf(err);
    if (REFUSED_CODES.has(code)) return { ok: false, why: 'refused' };
    if (MISSING_CODES.has(code)) return { ok: false, why: code === 'ELOOP' ? 'outside' : 'gone' };
    if (code === 'EMLINK') return { ok: false, why: 'outside' };
    if (code.length > 0) return { ok: false, why: 'unreadable', code };
    throw err;
  } finally {
    await handle?.close();
  }
}
