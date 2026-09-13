/*
 * The name a comparison shows for the resume it judged. A real resume is one
 * file under a name the user can change, so it reads its live name. The
 * launchers' scratch row is a different file after every upload, so a one-off
 * comparison reads the name it was made under — and a row from before that
 * name was kept, whose text the scratch row no longer holds, says so instead
 * of borrowing the latest file's name.
 */

export const EARLIER_ONE_OFF = 'An earlier one-off file';

export function comparedResumeName(snapshot: string, resume: { name: string; hidden: boolean }): string {
  if (!resume.hidden) return resume.name;
  return snapshot || EARLIER_ONE_OFF;
}

interface ComparedRow {
  resumeId: number;
  resumeVersion: number;
  createdAt: Date;
  /** `name` is already `comparedResumeName`. */
  resume: { name: string; hidden: boolean };
}

/**
 * The most recent earlier comparison of the same resume — for the "vs last
 * time" delta. On the scratch row "the same resume" is the same file name:
 * the row's previous upload is usually somebody's other resume, and a delta
 * against it would read as progress that never happened.
 */
export function previousFor<T extends ComparedRow>(selected: T, matches: T[]): T | null {
  return (
    matches.find(
      (m) =>
        m.resumeId === selected.resumeId &&
        m.createdAt < selected.createdAt &&
        (!selected.resume.hidden || m.resume.name === selected.resume.name),
    ) ?? null
  );
}

/** How a delta names the comparison it is measured against: a version of a real resume, or the earlier check of a one-off file, whose version counts uploads. */
export function earlierLabel(previous: ComparedRow): string {
  return previous.resume.hidden ? 'the last check of this file' : `v${previous.resumeVersion}`;
}
