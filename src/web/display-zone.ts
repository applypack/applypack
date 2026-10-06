import { AsyncLocalStorage } from 'node:async_hooks';
import { formatDatePart } from '../i18n/format';

/*
 * The time zone a page's dates are written in: the one the user set their
 * schedule in (Settings → General → Schedule), which is `TZ` until they pick
 * one. The request middleware in app.ts sets it for the whole request;
 * format.ts reads it. Outside a request (a script, a test) dates read in UTC.
 */
const zone = new AsyncLocalStorage<string>();

const OUTSIDE_A_REQUEST = 'UTC';

export function withDisplayZone<T>(timezone: string, fn: () => T): T {
  return zone.run(timezone, fn);
}

export function displayZone(): string {
  return zone.getStore() ?? OUTSIDE_A_REQUEST;
}

/** The zone's short name at `at` ("GMT+3", "CDT", "UTC"), for a table header that names it once. */
export function displayZoneLabel(at: Date = new Date()): string {
  return formatDatePart(at, { timeZone: displayZone(), timeZoneName: 'short' }, 'timeZoneName') ?? displayZone();
}
