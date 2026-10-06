import type { Prisma } from '@prisma/client';
import { flagOf, isCountryCode, isRegionCode } from '../countries';
import { WORKPLACE_CODES, type WorkplaceCode } from '../location';
import type { MessageKey } from '../i18n/catalog';
import { placeName, workplaceName } from '../i18n/places';
import { t } from '../i18n/t';

/*
 * The /jobs facets (ADR 0031): where a job is, how it is worked, when it was
 * posted. Pure — the route reads the query, asks here for the where-clause
 * and the chips, and renders. Counts are tallied from a narrow read of the
 * rows that match the other filters, each facet excluding its own selection
 * so a second chip shows what it would add (standard faceting).
 */

/** The chip value for rows with neither a country nor a region. */
export const UNKNOWN_PLACE = 'unknown';

/** How many place chips show before "More…". */
export const TOP_PLACES = 8;

/** `posted=` values → days back. */
const POSTED_WINDOWS: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30 };

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FacetSelection {
  /** Country codes, region codes and/or UNKNOWN_PLACE. */
  places: string[];
  workplaces: WorkplaceCode[];
  posted: string;
}

/** One chip: its query value, label, count, and whether it is selected. */
export interface FacetChip {
  value: string;
  label: string;
  flag: string;
  count: number;
  selected: boolean;
}

/** `country=PL,DE,EUROPE,unknown` → the values the gazetteer knows, once each. */
export function parsePlaces(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const v = part.trim();
    const code = v.toUpperCase();
    const value = v.toLowerCase() === UNKNOWN_PLACE ? UNKNOWN_PLACE : code;
    const known = value === UNKNOWN_PLACE || isCountryCode(code) || isRegionCode(code);
    if (known && !out.includes(value)) out.push(value);
  }
  return out;
}

/** `workplace=remote,hybrid` → enum values, once each. */
export function parseWorkplaces(raw: string | undefined): WorkplaceCode[] {
  const out: WorkplaceCode[] = [];
  for (const part of (raw ?? '').split(',')) {
    const code = part.trim().toUpperCase() as WorkplaceCode;
    if (WORKPLACE_CODES.includes(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

export function parsePosted(raw: string | undefined): string {
  return raw && raw in POSTED_WINDOWS ? raw : '';
}

/** Where-clause for the place facet: OR across the selection; null when nothing is selected. */
export function placeWhere(places: string[]): Prisma.JobWhereInput | null {
  const countries = places.filter(isCountryCode);
  const regions = places.filter(isRegionCode);
  const or: Prisma.JobWhereInput[] = [];
  if (countries.length > 0) or.push({ countries: { hasSome: countries } });
  if (regions.length > 0) or.push({ regions: { hasSome: regions } });
  if (places.includes(UNKNOWN_PLACE)) {
    or.push({ countries: { isEmpty: true }, regions: { isEmpty: true } });
  }
  return or.length > 0 ? { OR: or } : null;
}

export function postedSince(posted: string, now: Date): Date | null {
  const days = POSTED_WINDOWS[posted];
  return days ? new Date(now.getTime() - days * DAY_MS) : null;
}

/** The four columns the tally reads. */
export interface FacetRow {
  countries: string[];
  regions: string[];
  workplace: WorkplaceCode;
  postedAt: Date;
}

export interface FacetChips {
  places: FacetChip[];
  workplaces: FacetChip[];
  posted: FacetChip[];
}

/**
 * Chips with counts from the rows matching every filter except the three
 * facets themselves; each facet's count then respects the other two
 * selections, never its own — a chip's number is what clicking it shows.
 */
export function tallyFacets(rows: FacetRow[], selected: FacetSelection, now: Date): FacetChips {
  const inPlaces = (r: FacetRow) => selected.places.length === 0 || rowPlaces(r).some((p) => selected.places.includes(p));
  const inWorkplaces = (r: FacetRow) => selected.workplaces.length === 0 || selected.workplaces.includes(r.workplace);
  const inWindow = (r: FacetRow, key: string) => now.getTime() - r.postedAt.getTime() <= (POSTED_WINDOWS[key] ?? Infinity) * DAY_MS;
  const inPosted = (r: FacetRow) => selected.posted === '' || inWindow(r, selected.posted);

  const placeCounts = new Map<string, number>();
  const workplaceCounts = new Map<WorkplaceCode, number>();
  const postedCounts = new Map<string, number>();
  for (const row of rows) {
    if (inWorkplaces(row) && inPosted(row)) for (const p of rowPlaces(row)) bump(placeCounts, p);
    if (inPlaces(row) && inPosted(row)) bump(workplaceCounts, row.workplace);
    if (inPlaces(row) && inWorkplaces(row)) {
      for (const key of Object.keys(POSTED_WINDOWS)) {
        if (inWindow(row, key)) bump(postedCounts, key);
      }
    }
  }

  const places = [...placeCounts]
    .map(([value, count]) => chip(value, count, selected.places.includes(value)))
    .sort(byCountThenLabel);
  const workplaces = WORKPLACE_CODES.map((code) => ({
    value: code.toLowerCase(),
    label: workplaceName(code),
    flag: '',
    count: workplaceCounts.get(code) ?? 0,
    selected: selected.workplaces.includes(code),
  }));
  const posted = Object.keys(POSTED_WINDOWS).map((key) => ({
    value: key,
    label: worded(POSTED_LABEL, key),
    flag: '',
    count: postedCounts.get(key) ?? 0,
    selected: selected.posted === key,
  }));
  return { places, workplaces, posted };
}

/** What each `posted=` window is called on its chip, and in the row of filters in force — catalog keys. */
const POSTED_LABEL: Record<string, MessageKey> = { '24h': 'jobs.posted.day', '7d': 'jobs.posted.week', '30d': 'jobs.posted.month' };
const POSTED_ACTIVE: Record<string, MessageKey> = {
  '24h': 'jobs.active.postedDay',
  '7d': 'jobs.active.postedWeek',
  '30d': 'jobs.active.postedMonth',
};

/** The words for `value`, read when asked; a value the table does not know stays as it is. */
function worded(keys: Record<string, MessageKey>, value: string): string {
  const key = keys[value];
  return key ? t(key) : value;
}

/** The place values one row counts under. */
export function rowPlaces(row: Pick<FacetRow, 'countries' | 'regions'>): string[] {
  const places = [...row.countries, ...row.regions];
  return places.length > 0 ? places : [UNKNOWN_PLACE];
}

/**
 * Which place chips show at once: the busiest TOP_PLACES plus every selected
 * one; the rest go behind "More…".
 */
export function splitPlaces(chips: FacetChip[]): { shown: FacetChip[]; more: FacetChip[] } {
  const shown: FacetChip[] = [];
  const more: FacetChip[] = [];
  for (const c of chips) {
    if (c.selected || shown.length < TOP_PLACES) shown.push(c);
    else more.push(c);
  }
  return { shown, more };
}

/** Toggle one value inside a multi-select facet. */
export function toggled(selected: readonly string[], value: string): string[] {
  return selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
}

/**
 * Everything /jobs can be narrowed by, as the page holds it and its links
 * carry it. `workplace` is the lower-case query form.
 */
export interface JobsFilters {
  status: string;
  minFit: string;
  q: string;
  sort: string;
  verified: string;
  /** '1' = only companies on the watchlist (ADR 0036). */
  watched: string;
  /** ADR 0033: '1' = only rows a search of mine can take. */
  open: string;
  /** ADR 0056: '1' = show the postings of muted companies too; hidden by default. */
  muted: string;
  /** Which search the list is narrowed to; null = all of them. */
  profile: number | null;
  /** ADR 0031 facets: place values (codes or "unknown"), workplace values, posted window. */
  country: string[];
  workplace: string[];
  posted: string;
}

/**
 * A /jobs URL for these filters. Empty values and page 1 stay out of it;
 * `panel` is set only by the links inside the filter panel, so the page they
 * load renders it open (a <details> closes on every navigation).
 */
export function jobsHref(filters: JobsFilters, extra: { page?: number; panel?: boolean } = {}): string {
  const usp = new URLSearchParams();
  const params: Record<string, string | number | string[] | null> = {
    ...filters,
    page: extra.page ?? 1,
    panel: extra.panel ? '1' : '',
  };
  for (const [k, v] of Object.entries(params)) {
    const s = v === null ? '' : Array.isArray(v) ? v.join(',') : String(v);
    if (s.length === 0 || (k === 'page' && s === '1')) continue;
    usp.set(k, s);
  }
  const qs = usp.toString();
  return qs ? `/jobs?${qs}` : '/jobs';
}

/** One active criterion in the row above the table: what it says, and the link that lifts it. */
export interface ActiveFilter {
  label: string;
  flag: string;
  href: string;
}

/**
 * The filters the panel holds, one entry per selected value, in the panel's
 * own order. Status, sort, `q` and the fit floor are not here: their controls
 * are in plain sight and show their own state.
 */
export function activeFilters(filters: JobsFilters, profiles: { id: number; name: string }[]): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  const add = (label: string, flag: string, without: Partial<JobsFilters>) =>
    out.push({ label, flag, href: jobsHref({ ...filters, ...without }) });

  if (filters.profile !== null) {
    const name = profiles.find((p) => p.id === filters.profile)?.name ?? `#${filters.profile}`;
    add(t('jobs.active.search', { name }), '', { profile: null });
  }
  for (const value of filters.country) {
    const unknown = value === UNKNOWN_PLACE;
    add(unknown ? t('jobs.active.placeUnknown') : placeName(value), unknown ? '' : flagOf(value), { country: toggled(filters.country, value) });
  }
  for (const value of filters.workplace) {
    const code = value.toUpperCase() as WorkplaceCode;
    add(code === 'UNKNOWN' ? t('jobs.active.workplaceUnknown') : WORKPLACE_CODES.includes(code) ? workplaceName(code) : value, '', {
      workplace: toggled(filters.workplace, value),
    });
  }
  if (filters.posted) add(worded(POSTED_ACTIVE, filters.posted), '', { posted: '' });
  if (filters.verified) add(t('jobs.filter.verified'), '', { verified: '' });
  if (filters.watched) add(t('jobs.filter.watched'), '', { watched: '' });
  if (filters.open) add(t('jobs.filter.openToMe'), '', { open: '' });
  if (filters.muted) add(t('jobs.active.mutedShown'), '', { muted: '' });
  return out;
}

/** How many values the panel holds — the number on its button. */
export function filterCount(filters: JobsFilters): number {
  return (
    (filters.profile === null ? 0 : 1) +
    filters.country.length +
    filters.workplace.length +
    [filters.posted, filters.verified, filters.watched, filters.open, filters.muted].filter((v) => v.length > 0).length
  );
}

/** The list with every panel filter lifted; status, sort, `q` and the fit floor stay. */
export function clearFiltersHref(filters: JobsFilters): string {
  return jobsHref({ ...filters, profile: null, country: [], workplace: [], posted: '', verified: '', watched: '', open: '', muted: '' });
}

function chip(value: string, count: number, selected: boolean): FacetChip {
  return {
    value,
    label: value === UNKNOWN_PLACE ? t('jobs.filter.placeUnknown') : placeName(value),
    flag: value === UNKNOWN_PLACE ? '' : flagOf(value),
    count,
    selected,
  };
}

function byCountThenLabel(a: FacetChip, b: FacetChip): number {
  return b.count - a.count || a.label.localeCompare(b.label);
}

function bump<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}
