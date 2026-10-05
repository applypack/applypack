import { isRegionCode, placeLabel } from '../countries';
import type { WorkplaceCode } from '../location';
import type { MessageKey } from './catalog';
import { regionName } from './format';
import { t } from './t';

/*
 * A place and a work arrangement by name, in the reader's language
 * (ADR 0061). `countries.ts:placeLabel` and `location.ts:WORKPLACE_LABEL`
 * stay English on purpose: fetchers store them, prompts and scripts print
 * them. A page asks here.
 */

/** A country (CLDR's name) or a group of countries (the catalog's `place.group.*`); the gazetteer's own name in English. */
export function placeName(code: string): string {
  if (isRegionCode(code)) return t(`place.group.${code}` as MessageKey);
  return regionName(code, placeLabel(code));
}

/** "Remote", "Hybrid", "On-site", "Unknown". */
export function workplaceName(code: WorkplaceCode): string {
  return t(`workplace.${code}`);
}
