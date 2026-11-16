import path from 'node:path';

/*
 * The log a local install keeps (#769). Under `npm start` the terminal shows
 * warnings only, so that the address to open is not buried — and a dozen
 * messages said "the web log has the detail" about a log that was nowhere.
 * The worker and the dashboard now also write, at `info`, to one file in the
 * data folder; Settings → General → Logs shows its last lines. Pure: the
 * path, the size it is rolled over at, and which lines the page shows.
 */

const LOG_FILE_NAME = 'applypack.log';
/** Past this the file becomes `applypack.log.1` at the next start, and a new one begins. */
export const MAX_LOG_BYTES = 5 * 1024 * 1024;
/** How much of the file's end the page reads, and how many lines of it it shows. */
export const TAIL_BYTES = 256 * 1024;
const TAIL_LINES = 80;

export function logFilePath(dataDir: string): string {
  return path.join(dataDir, 'logs', LOG_FILE_NAME);
}

/** A page that answered: one line per request, and none of them is what a bug report needs. */
const ROUTINE_REQUEST = /web: request\b.*"status":\s?[123]\d\d/;

/** The last `n` lines worth reading: whole lines only, the routine requests left out. */
export function tailLines(text: string, n: number = TAIL_LINES): string[] {
  const lines = text.split('\n');
  // A read that began mid-file begins mid-line.
  if (lines.length > 1) lines.shift();
  return lines.filter((l) => l.trim() !== '' && !ROUTINE_REQUEST.test(l)).slice(-n);
}
