/*
 * A time for a folder's disk to answer in (#397). A folder on a disk that has
 * stopped answering — a sleeping NAS under the home folder, a hard NFS mount
 * in Docker — never settles a file call, and the fetch that asked held the
 * one fetch lock for ever: every later tick answered "overlap", so every
 * source stopped until the worker was restarted.
 *
 * A call that does not answer in time is left behind. It cannot be
 * cancelled, and it holds one of the few threads file calls run on, so while
 * it is still out the folder is asked nothing else: four looks at a dead
 * disk would otherwise leave the whole process unable to read any file.
 * Pure — the calls are handed in — and tested in folder-deadline.test.ts.
 */

/** A folder's disk did not answer in time, or has not yet answered an earlier call. */
export class NoAnswer extends Error {
  override name = 'NoAnswer';
}

export interface Deadlines {
  /**
   * The call's answer, or `NoAnswer` once `ms` have passed. Rejects at once,
   * without making the call, while an earlier call to the same folder is
   * still unanswered.
   */
  inTime<T>(folder: string, call: () => Promise<T>): Promise<T>;
  /** Whether a call to this folder is still out. */
  stalled(folder: string): boolean;
}

export function deadlines(ms: number): Deadlines {
  /** Folders with a call still out, and how many: the last one home frees the folder. */
  const out = new Map<string, number>();
  const leave = (folder: string): void => {
    const left = (out.get(folder) ?? 1) - 1;
    if (left > 0) out.set(folder, left);
    else out.delete(folder);
  };
  return {
    stalled: (folder) => out.has(folder),
    async inTime(folder, call) {
      if (out.has(folder)) throw new NoAnswer(folder);
      const pending = call();
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          out.set(folder, (out.get(folder) ?? 0) + 1);
          // Whenever it does come home, with an answer or an error nobody is waiting for.
          pending.then(
            () => leave(folder),
            () => leave(folder),
          );
          reject(new NoAnswer(folder));
        }, ms);
      });
      try {
        return await Promise.race([pending, late]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
