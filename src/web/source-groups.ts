import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';
import { sourceLabel } from './source-names';

/*
 * The Job sources grid on /settings, as the reader needs it rather than as the
 * enum declares it (#147): three kinds of thing in three groups, each sorted
 * by its label, each pill carrying what runs on THIS install. Pure — tested
 * in source-groups.test.ts.
 */

export type SourceFamily = 'vendor' | 'aggregator' | 'own';

/** Per-company boards: they fetch nothing until a Company row names them. */
const VENDORS = new Set([
  'GREENHOUSE', 'LEVER', 'ASHBY', 'WORKABLE', 'SMARTRECRUITERS', 'RECRUITEE',
  'BREEZY', 'BAMBOOHR', 'PINPOINT', 'RIPPLING', 'PERSONIO', 'TEAMTAILOR',
]);
/** Not vendors at all: the user's own feeds and the careers pages they watch (ADR 0036). */
const OWN = new Set(['FEED', 'CAREER_PAGE', 'BROWSER_PAGE']);
/**
 * Rows the user brings in bulk (ADR 0062): a file they import, a folder a
 * tool writes into. Theirs, like a feed — and many employers under one
 * source, like an aggregator, each named on its own row (`bringsRows`, read
 * by employer.ts).
 */
const ROW_SOURCES = new Set(['IMPORT', 'FOLDER']);
/** Kinds the tick never reads: a pasted job, a page the user pastes (TASKS N8), an imported file. */
const NOT_FETCHED = new Set(['MANUAL', 'BROWSER_PAGE', 'IMPORT']);

/**
 * A kind the tick fetches, so a pill on the Sources grid can switch it off.
 * The others are rows, not sources.
 */
export function fetchedSource(atsType: string): boolean {
  return !NOT_FETCHED.has(atsType);
}

export function bringsRows(atsType: string): boolean {
  return ROW_SOURCES.has(atsType);
}

export function sourceFamily(atsType: string): SourceFamily {
  if (VENDORS.has(atsType)) return 'vendor';
  if (OWN.has(atsType) || ROW_SOURCES.has(atsType)) return 'own';
  return 'aggregator';
}

/**
 * Named by the catalog in the reader's language ("Feed", "Careers page",
 * "Folder" — `source-names.ts:sourceLabel`) rather than by its vendor, whose
 * name stays as written (`translate="no"`). MANUAL is the pasted jobs' kind.
 */
export function wordedSource(atsType: string): boolean {
  return sourceFamily(atsType) === 'own' || atsType === 'MANUAL';
}

/** Needs no company row and publishes every posting it has — what the wizard's test search asks. */
export function isAggregator(source: { atsType: string }): boolean {
  return sourceFamily(source.atsType) === 'aggregator';
}

export interface SourceCount {
  companies: number;
  active: number;
}

export interface SourcePill {
  atsType: string;
  label: string;
  companies: number;
  active: number;
  /** Gated by a key the user has not pasted yet (ADR 0034 rule 4). */
  locked: boolean;
}

export interface SourceGroup {
  family: SourceFamily;
  title: string;
  caption: string;
  pills: SourcePill[];
}

/** The three groups in the grid's order; a group's title and caption are catalog keys, worded when the grid is built. */
const GROUPS = [
  { family: 'vendor', title: 'sources.group.vendor', caption: 'sources.group.vendor.caption' },
  { family: 'aggregator', title: 'sources.group.aggregator', caption: 'sources.group.aggregator.caption' },
  { family: 'own', title: 'sources.group.own', caption: 'sources.group.own.caption' },
] as const satisfies readonly { family: SourceFamily; title: MessageKey; caption: MessageKey }[];

/** Vendors count companies, aggregators feeds, the user's own sources entries. */
const COUNT_KEY = {
  vendor: 'sources.count.vendor',
  aggregator: 'sources.count.aggregator',
  own: 'sources.count.own',
} as const satisfies Record<SourceFamily, MessageKey>;

/** What a pill says next to its label — the install fact, not the enum: "12 companies · 3 active", "no feeds yet". */
export function describeCount(c: SourceCount, family: SourceFamily): string {
  return t(COUNT_KEY[family], { n: c.companies, active: c.active });
}

export function groupSources(
  all: readonly string[],
  counts: Readonly<Record<string, SourceCount>>,
  locked: readonly string[],
): SourceGroup[] {
  return GROUPS.map((g) => ({
    family: g.family,
    title: t(g.title),
    caption: t(g.caption),
    pills: all
      .filter((s) => sourceFamily(s) === g.family)
      .map((s) => ({
        atsType: s,
        label: sourceLabel(s),
        companies: counts[s]?.companies ?? 0,
        active: counts[s]?.active ?? 0,
        locked: locked.includes(s),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })),
  })).filter((g) => g.pills.length > 0);
}
