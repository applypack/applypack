import { placeLabel } from '../countries';
import { residenceCovered, type RelocationCode } from '../eligibility';
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
  /** ADR 0033: where the candidate lives, and whether they would move. */
  residence?: string | null;
  relocation?: RelocationCode | string | null;
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
  const where = job.workplace === 'REMOTE' ? `open to ${places}` : `office in ${places}`;

  // The search's own list first — that is what its owner set. Residence
  // explains the case the list cannot: the posting is where the search
  // hunts, and the candidate still may not work from there (ADR 0033).
  if (!hunts || placesOverlap(job, profile)) return livingReason(where, job, profile);

  return `${where}; ${huntsIn}`;
}

/**
 * "open to European Union; you live in Ukraine and this search does not
 * relocate" — the honest sentence for a posting that is where the search
 * hunts and still closed to the person doing the hunting. Null when the
 * columns cannot say that: no residence set, or the posting covers it.
 */
function livingReason(where: string, job: ReasonJob, profile: ReasonProfile): string | null {
  const residence = profile.residence ?? null;
  if (!residence || residenceCovered(job, residence)) return null;
  const lives = `you live in ${placeLabel(residence)}`;
  // Whether relocation or sponsorship rescues it is the model's call — it
  // read the posting. The code only names the setting that made it matter.
  return profile.relocation === 'no'
    ? `${where}; ${lives} and this search does not relocate`
    : `${where}; ${lives}`;
}

function names(codes: string[]): string {
  return codes.map(placeLabel).join(', ');
}
