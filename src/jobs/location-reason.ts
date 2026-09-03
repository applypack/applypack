import { placeLabel } from '../countries';
import { placesOverlap } from '../filter';
import { WORKPLACE_LABEL, type WorkplaceCode } from '../location';

/*
 * One line on the job page saying WHY a search's verdict is "location
 * mismatch" (ADR 0032) — built from the columns the parser and the model
 * filled, no AI call. Null when the columns cannot explain it; the search's
 * summary carries the model's own reason then.
 */

export interface ReasonJob {
  workplace: WorkplaceCode;
  countries: string[];
  regions: string[];
}

export interface ReasonProfile {
  countries: string[];
  regions: string[];
  workplace: WorkplaceCode[];
}

export function locationMismatchReason(job: ReasonJob, profile: ReasonProfile): string | null {
  const hunts = names([...profile.countries, ...profile.regions]);
  const huntsIn = hunts ? `this search hunts in ${hunts}` : 'this search hunts anywhere';

  if (job.workplace !== 'UNKNOWN' && profile.workplace.length > 0 && !profile.workplace.includes(job.workplace)) {
    const accepts = profile.workplace.map((w) => WORKPLACE_LABEL[w].toLowerCase()).join(' / ');
    return `${WORKPLACE_LABEL[job.workplace].toLowerCase()} role; this search accepts ${accepts}`;
  }

  const places = names([...job.countries, ...job.regions]);
  if (!places) return hunts ? `no country named; ${huntsIn}` : null;
  if (!hunts) return null;
  if (placesOverlap(job, profile)) return null;

  const where = job.workplace === 'REMOTE' ? `open to ${places}` : `office in ${places}`;
  return `${where}; ${huntsIn}`;
}

function names(codes: string[]): string {
  return codes.map(placeLabel).join(', ');
}
