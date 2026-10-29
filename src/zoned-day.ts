/*
 * A calendar day in a time zone (#680): the one rule for a day the dashboard
 * stores or shows is the display zone's day (`web/display-zone.ts`), never the
 * UTC day an instant's ISO string opens with. Pure.
 *
 * A day comes in two shapes. A DATE column (the stage ledger's `occurredOn`)
 * holds the day itself, which Prisma hands back as that day's UTC midnight: a
 * marker, never an instant to read in a zone. Everything else (`appliedAt`) is
 * an instant, whose day depends on where it is read.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function partsIn(at: Date, timeZone: string, withTime: boolean): Record<string, string> {
  const time = withTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' } as const : {};
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', ...time })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
}

/** The calendar day a moment fell on in `timeZone`: "2026-09-28". */
export function dayIn(at: Date | null, timeZone: string): string {
  if (at === null) return '';
  const p = partsIn(at, timeZone, false);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The day `at` falls on in `timeZone`, as a DATE column stores it: that day's UTC midnight. */
export function dayMarker(at: Date, timeZone: string): Date {
  return new Date(`${dayIn(at, timeZone)}T00:00:00Z`);
}

/** "2026-09-28" when the text is a real calendar day (no 2026-02-30), else null. */
export function parseDay(text: string): string | null {
  const day = DAY.exec(text.trim())?.[0];
  if (!day) return null;
  const at = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(day) ? day : null;
}

/** How far `timeZone`'s wall clock is ahead of UTC at `at`. */
function offsetMs(at: Date, timeZone: string): number {
  const p = partsIn(at, timeZone, true);
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return wall - (at.getTime() - at.getUTCMilliseconds());
}

/** The instant `day` — "2026-09-28" or a DATE column's marker — begins in `timeZone`. */
export function dayStart(day: string | Date, timeZone: string): Date {
  const midnight = Date.parse(`${typeof day === 'string' ? day : day.toISOString().slice(0, 10)}T00:00:00Z`);
  // The offset is read twice, the second time at the corrected moment, so a clock change on that day lands right.
  const first = midnight - offsetMs(new Date(midnight), timeZone);
  return new Date(midnight - offsetMs(new Date(first), timeZone));
}

/** The earliest day an application form takes: before it is a slip of the keyboard, as a five-digit year is. */
const EARLIEST_DAY = '1990-01-01';

/** `text` as a day that has come, from 1990 to today in `timeZone` (#682), else null. */
export function parsePastDay(text: string, now: Date, timeZone: string): string | null {
  const day = parseDay(text);
  // A day is a string "YYYY-MM-DD", so the order of the strings is the order of the days.
  return day !== null && day >= EARLIEST_DAY && day <= dayIn(now, timeZone) ? day : null;
}
