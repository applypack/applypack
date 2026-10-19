import { residenceCovered, type RelocationCode } from '../eligibility';
import { placesOverlap } from '../filter';
import type { WorkplaceCode } from '../location';
import { placeName, workplaceName } from '../i18n/places';
import { t } from '../i18n/t';
import { openingGroup } from './verdict-merge';

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

/*
 * Every reason is one whole catalog message (ADR 0061): the two halves of
 * "open to Poland; this search hunts in United States" belong to one
 * sentence, and a language orders and declines them its own way. `where`
 * picks the half that says what the posting is: open to places, or an office
 * in them.
 */
export function locationMismatchReason(job: ReasonJob, profile: ReasonProfile): string | null {
  const hunts = names([...profile.countries, ...profile.regions]);

  if (job.workplace !== 'UNKNOWN' && profile.workplace.length > 0 && !profile.workplace.includes(job.workplace)) {
    const accepts = profile.workplace.map((w) => workplaceName(w).toLowerCase()).join(' / ');
    return t('location.reason.workplace', { role: job.workplace, accepts });
  }

  const places = names([...job.countries, ...job.regions]);
  if (!places) return hunts ? t('location.reason.noCountry', { hunts }) : null;
  const where = job.workplace === 'REMOTE' ? 'open' : 'office';

  // The search's own list first — that is what its owner set. Residence
  // explains the case the list cannot: the posting is where the search
  // hunts, and the candidate still may not work from there (ADR 0033).
  if (!hunts || placesOverlap(job, profile)) return livingReason(where, places, job, profile);

  return t('location.reason.elsewhere', { where, places, hunts });
}

/**
 * "open to European Union; you live in Ukraine and this search does not
 * relocate" — the honest sentence for a posting that is where the search
 * hunts and still closed to the person doing the hunting. Null when the
 * columns cannot say that: no residence set, or the posting covers it.
 */
function livingReason(where: 'open' | 'office', places: string, job: ReasonJob, profile: ReasonProfile): string | null {
  const residence = profile.residence ?? null;
  if (!residence || residenceCovered(job, residence)) return null;
  // Whether relocation or sponsorship rescues it is the model's call — it
  // read the posting. The code only names the setting that made it matter.
  return t(profile.relocation === 'no' ? 'location.reason.residenceNoRelocation' : 'location.reason.residence', {
    where,
    places,
    residence: placeName(residence),
  });
}

/**
 * "Remote across Europe, which includes Poland, Germany": why a remote
 * posting is open to the search, read off the stored place. The code
 * overrules a model that called it closed (verdict-merge.ts:openThroughGroup,
 * #530), and the model's summary may still say so; this line goes beside it
 * (#605). Null when the place does not prove it.
 */
export function openThroughLine(place: Parameters<typeof openingGroup>[0], profile: Parameters<typeof openingGroup>[1]): string | null {
  const open = openingGroup(place, profile);
  if (open === null) return null;
  const places = open.places.filter((code) => code !== open.group);
  return t('location.reason.openThrough', { group: placeName(open.group), places: names(places), named: places.length > 0 ? 'yes' : 'no' });
}

function names(codes: string[]): string {
  return codes.map(placeName).join(', ');
}
