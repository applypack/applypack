/*
 * What Settings folds behind one press (#720): the schedule's controls while
 * the schedule is the default, the engines that are neither chosen nor able
 * to run, and a search's secondary place fields. Nothing is removed and
 * nothing folded is lost on save — a closed <details> still posts its fields.
 * Pure. Tested in settings-fold.test.ts.
 */
import { ALL_DAYS, type Schedule } from '../user-schedule';

/** Every hour, around the clock, every day: what a new install runs, and what the folded line already says. */
export function searchScheduleIsDefault(s: Schedule): boolean {
  return s.fetch.every === 'hour' && s.fetch.from === 0 && s.fetch.to === 23 && ALL_DAYS.every((d) => s.fetch.days.includes(d));
}

interface EngineState {
  ok: boolean;
  enabled: boolean;
  lastResort: boolean;
}

/**
 * The engines that stay in sight — chosen, answering as the last resort, or
 * able to run here — and the rest, which wait behind "Other engines". With
 * nothing in sight that can run, the rest stand open: they are the way out.
 */
export function splitEngines<E extends EngineState>(engines: readonly E[]): { shown: E[]; folded: E[]; open: boolean } {
  const shown = engines.filter((e) => e.enabled || e.lastResort || e.ok);
  const folded = engines.filter((e) => !shown.includes(e));
  return { shown, folded, open: !shown.some((e) => e.ok) };
}

interface PlaceExtras {
  regions: readonly string[];
  residence: string | null;
  relocation: string | null;
}

/** How many of the folded place fields say something: the number on the closed line. */
export function placeExtrasSet(p: PlaceExtras): number {
  return p.regions.length + (p.residence ? 1 : 0) + (p.relocation && p.relocation !== 'no' ? 1 : 0);
}
