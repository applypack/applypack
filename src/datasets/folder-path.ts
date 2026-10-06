/*
 * Which folder a source may read (ADR 0062). Adding a folder turns its files
 * into postings shown in the dashboard, so the form that adds one is a way to
 * read files for whoever can reach the dashboard — and these rules are what
 * bound it. Pure — tested in folder-path.test.ts. Every path that reaches
 * `folderAllowed` and `insideFolder` is a real path: the caller resolves
 * symlinks first, so a link cannot lead a rule astray.
 */

import path from 'node:path';

type PathApi = Pick<path.PlatformPath, 'relative' | 'isAbsolute' | 'resolve' | 'sep' | 'join' | 'delimiter' | 'dirname'>;

export interface FolderRules {
  /** Started by `npm start` on the user's own machine: one user, loopback (local/child.ts:underLauncher). */
  launcher: boolean;
  /** The home directory. */
  home: string;
  /** The install's own data folder: the database lives there, and it is never read. */
  dataDir: string;
  /** The folders whoever runs the machine named in APPLYPACK_INBOX_ROOTS. */
  roots: readonly string[];
}

export type FolderVerdict = { ok: true } | { ok: false; reason: string };

/** Under the home directory, the system's own: application data, never a place a person keeps job files. */
const SYSTEM_FOLDERS = ['library', 'appdata'];

export const INBOX_ROOTS_ENV = 'APPLYPACK_INBOX_ROOTS';

/** `child` is `parent` or lies beneath it. */
function within(parent: string, child: string, p: PathApi): boolean {
  const rel = p.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
}

/** A file's real path lies beneath the folder's: what keeps a read from leaving the folder it was given. */
export function insideFolder(folder: string, file: string, p: PathApi = path): boolean {
  return folder !== file && within(folder, file, p);
}

/**
 * A path as a person types it, as an absolute one: quotes and a trailing
 * separator dropped, `~` read as the home directory. Null when it is not
 * absolute — a relative path would mean a different folder in the worker
 * and in the dashboard.
 */
export function folderPathFrom(input: string, home: string, p: PathApi = path): string | null {
  const typed = input.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  // A NUL cannot be in a path, and the system answers it with an error that is not a file's.
  if (typed.length === 0 || typed.includes('\0')) return null;
  const expanded = typed === '~' ? home : typed.startsWith('~/') || typed.startsWith('~\\') ? p.join(home, typed.slice(2)) : typed;
  return p.isAbsolute(expanded) ? p.resolve(expanded) : null;
}

/** The roots of APPLYPACK_INBOX_ROOTS: absolute paths, separated as PATH is on this system. */
export function inboxRoots(value: string | undefined, p: PathApi = path): string[] {
  return (value ?? '')
    .split(p.delimiter)
    .map((root) => root.trim())
    .filter((root) => root.length > 0 && p.isAbsolute(root))
    .map((root) => p.resolve(root));
}

/**
 * A named root always may be read: whoever runs the machine chose it. Without
 * one, only a local install reads a folder, and only one inside the home
 * directory that is not hidden, not the system's and not ApplyPack's own.
 */
export function folderAllowed(folder: string, rules: FolderRules, p: PathApi = path): FolderVerdict {
  if (rules.roots.some((root) => within(root, folder, p))) return { ok: true };
  if (!rules.launcher) {
    return {
      ok: false,
      reason:
        rules.roots.length === 0
          ? `On a server ApplyPack reads only the folders named in ${INBOX_ROOTS_ENV}, and none is named. Whoever runs this install sets it and mounts the folder (docs/install.md).`
          : `This folder is not inside a folder named in ${INBOX_ROOTS_ENV}.`,
    };
  }
  // A home that is the root of the disk (a container's, a service account's) bounds nothing.
  if (p.dirname(rules.home) === rules.home || !insideFolder(rules.home, folder, p)) {
    return { ok: false, reason: `Choose a folder inside your home folder, or name another place in ${INBOX_ROOTS_ENV}.` };
  }
  const parts = p.relative(rules.home, folder).split(p.sep);
  if (parts.some((part) => part.startsWith('.'))) return { ok: false, reason: 'A hidden folder (a name that starts with a dot) is not read.' };
  if (SYSTEM_FOLDERS.includes(parts[0]!.toLowerCase())) return { ok: false, reason: 'The system’s own folders (Library, AppData) are not read.' };
  if (within(folder, rules.dataDir, p) || within(rules.dataDir, folder, p)) {
    return { ok: false, reason: 'That is where ApplyPack keeps its own database, which is not read as a source.' };
  }
  return { ok: true };
}
