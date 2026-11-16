import fs from 'node:fs';
import os from 'node:os';
import { underLauncher } from '../local/child';
import { dataDirFor } from '../local/data-dir';
import { logFilePath, tailLines, TAIL_BYTES } from '../local/log-file';

/** What Settings → General → Logs shows: the file a local install writes, and its last lines. */
export interface LogView {
  /** The log file; null where there is none — Docker and the dev watchers log to their terminal. */
  file: string | null;
  lines: string[];
}

/** The end of the local log (#769). Reads the last `TAIL_BYTES` only: the file may be megabytes. */
export function readLogView(): LogView {
  if (!underLauncher()) return { file: null, lines: [] };
  const file = logFilePath(dataDirFor(process.platform, process.env, os.homedir()));
  try {
    const { size } = fs.statSync(file);
    const from = Math.max(0, size - TAIL_BYTES);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - from);
      fs.readSync(fd, buf, 0, buf.length, from);
      // A read from the file's start has no cut line to drop: give tailLines one.
      return { file, lines: tailLines(`${from === 0 ? '\n' : ''}${buf.toString('utf8')}`) };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { file, lines: [] };
  }
}
