/**
 * Pure resolution logic for starter packs: which (atsType, atsToken) pairs to
 * try for a catalog entry, in what order, and how to split probe results into
 * "insert / already here / no open jobs / could not resolve". No DB, no HTTP:
 * `resolveEntry` takes the probe as an argument, so the walk is tested on
 * recorded answers.
 */

import type { DiscoverableAtsType } from '../text-utils';

/** Vendor order for the fallback probe. */
export const RESOLVE_ORDER = [
  'GREENHOUSE',
  'ASHBY',
  'LEVER',
  'WORKABLE',
  'SMARTRECRUITERS',
  'RECRUITEE',
  'BREEZY',
  'BAMBOOHR',
  'PINPOINT',
  'RIPPLING',
  'PERSONIO',
  'TEAMTAILOR',
] as const satisfies readonly DiscoverableAtsType[];

/** Adding a vendor to `DiscoverableAtsType` without adding it to the chain
 *  makes this alias non-`never` and fails the build. */
type AssertNever<T extends never> = T;
export type UncoveredVendor = AssertNever<
  Exclude<DiscoverableAtsType, (typeof RESOLVE_ORDER)[number]>
>;

/** A board is only accepted as this company's when it holds at least one job —
 *  SmartRecruiters answers 200 with an empty list for any slug (ADR 0017). */
export const MIN_JOBS_TO_ACCEPT = 1;

export interface ResolveTarget {
  name: string;
  segment: string;
  atsType: DiscoverableAtsType;
  atsToken: string;
}

export interface ResolveAttempt {
  atsType: DiscoverableAtsType;
  atsToken: string;
  /** True for the catalog's hand-verified board, false for a guessed slug. */
  pinned: boolean;
}

/**
 * Company name → the slug a vendor most likely uses. Lower-cased and stripped
 * of everything but letters and digits ("Rocket.Chat" → "rocketchat").
 * SmartRecruiters slugs are case-sensitive, so a derived slug can miss there —
 * acceptable for a fallback that only runs when the pinned board is gone.
 */
export function deriveSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Attempts for one entry: the pinned board first, then every vendor in
 * `RESOLVE_ORDER` against the derived slug. Duplicates are dropped, so the
 * pinned pair is never probed twice.
 */
export function buildResolvePlan(target: ResolveTarget): ResolveAttempt[] {
  const plan: ResolveAttempt[] = [
    { atsType: target.atsType, atsToken: target.atsToken, pinned: true },
  ];
  const seen = new Set([keyOf(target.atsType, target.atsToken)]);

  const slug = deriveSlug(target.name);
  if (slug.length >= 2) {
    for (const atsType of RESOLVE_ORDER) {
      const key = keyOf(atsType, slug);
      if (seen.has(key)) continue;
      seen.add(key);
      plan.push({ atsType, atsToken: slug, pinned: false });
    }
  }
  return plan;
}

/**
 * Guard for the confirm step: the browser round-trips the pair it saw in the
 * preview, and we only insert one the plan actually allows. Keeps a
 * hand-crafted POST from writing arbitrary rows, and hands back the matching
 * attempt so the caller gets the vendor narrowed instead of casting.
 */
export function allowedAttempt(
  target: ResolveTarget,
  atsType: string,
  atsToken: string,
): ResolveAttempt | null {
  return (
    buildResolvePlan(target).find(
      (a) => a.atsType === atsType && a.atsToken === atsToken,
    ) ?? null
  );
}

export function keyOf(atsType: string, atsToken: string): string {
  return `${atsType}:${atsToken}`;
}

/** Public board URL for a resolved pair — stored as the company's careerUrl. */
export function boardUrl(atsType: DiscoverableAtsType, atsToken: string): string {
  const t = encodeURIComponent(atsToken);
  switch (atsType) {
    case 'GREENHOUSE':
      return `https://job-boards.greenhouse.io/${t}`;
    case 'ASHBY':
      return `https://jobs.ashbyhq.com/${t}`;
    case 'LEVER':
      return `https://jobs.lever.co/${t}`;
    case 'WORKABLE':
      return `https://apply.workable.com/${t}/`;
    case 'SMARTRECRUITERS':
      return `https://careers.smartrecruiters.com/${t}`;
    case 'RECRUITEE':
      return `https://${t}.recruitee.com/`;
    case 'BREEZY':
      return `https://${t}.breezy.hr/`;
    case 'BAMBOOHR':
      return `https://${t}.bamboohr.com/careers`;
    case 'PINPOINT':
      return `https://${t}.pinpointhq.com/`;
    case 'RIPPLING':
      return `https://ats.rippling.com/${t}/jobs`;
    case 'PERSONIO':
      return `https://${t}.jobs.personio.de/`;
    case 'TEAMTAILOR':
      return `https://${t}.teamtailor.com/`;
  }
}

export interface ResolvedEntry extends ResolveTarget {
  jobsCount: number;
  /** False when the pinned board was gone and a guessed slug answered. */
  pinned: boolean;
  boardUrl: string;
}

/**
 * The pinned board answered and lists nothing, and no guess did better: the
 * company's own board with no openings today (#638). Listed, never added — a
 * source with nothing to read would only age into "silent" (ADR 0019).
 */
export interface QuietEntry extends ResolveTarget {
  boardUrl: string;
}

/**
 * Why an entry gave no board, read off the pinned board's answer — its
 * status, never its words (#638):
 * - `gone`: the vendor looked the token up and has no such board (a 404), or
 *   answered with a redirect away from its API;
 * - `refused`: the vendor would not say (401, 403) — closed, private, or kept
 *   from where we ask;
 * - `unavailable`: nothing about the token — a rate limit, an outage, no
 *   answer at all;
 * - `timedOut`: the pack's budget ran out before the entry was asked.
 */
export type UnresolvedReason = 'gone' | 'refused' | 'unavailable' | 'timedOut';

export interface UnresolvedEntry {
  name: string;
  segment: string;
  reason: UnresolvedReason;
  /** The probe's own words, for the log: the page says `reason`. */
  detail?: string;
}

/** What a probe answered, reduced to what the resolver reads (`ats-probe.ts:ProbeResult`). */
export interface ProbeAnswer {
  ok: boolean;
  jobsCount?: number;
  /** The vendor's HTTP status when it answered with an error. */
  status?: number;
  error?: string;
}

export function failureReason(answer: ProbeAnswer): Exclude<UnresolvedReason, 'timedOut'> {
  const status = answer.status;
  if (status === undefined || status === 429 || status >= 500) return 'unavailable';
  if (status === 401 || status === 403) return 'refused';
  return 'gone';
}

export type EntryOutcome =
  | { kind: 'resolved'; entry: ResolvedEntry }
  | { kind: 'quiet'; entry: QuietEntry }
  | { kind: 'unresolved'; entry: UnresolvedEntry };

/**
 * One entry through its plan: the first attempt holding a job wins. When none
 * does, the pinned board's own answer decides — an empty board is `quiet`, a
 * failure says why. A deadline that falls after the pinned board answered
 * still lets that answer speak; one that falls before it is `timedOut`.
 */
export async function resolveEntry(
  target: ResolveTarget,
  probe: (attempt: ResolveAttempt) => Promise<ProbeAnswer>,
  deadline: number,
  now: () => number = Date.now,
): Promise<EntryOutcome> {
  let pinnedAnswer: ProbeAnswer | null = null;
  for (const attempt of buildResolvePlan(target)) {
    if (now() > deadline) break;
    const answer = await probe(attempt);
    if (attempt.pinned) pinnedAnswer = answer;
    // A board that exists but holds nothing is not proof of identity —
    // SmartRecruiters answers 200 with an empty list for any slug (ADR 0017).
    if (answer.ok && (answer.jobsCount ?? 0) >= MIN_JOBS_TO_ACCEPT) {
      return {
        kind: 'resolved',
        entry: {
          ...target,
          atsType: attempt.atsType,
          atsToken: attempt.atsToken,
          pinned: attempt.pinned,
          jobsCount: answer.jobsCount ?? 0,
          boardUrl: boardUrl(attempt.atsType, attempt.atsToken),
        },
      };
    }
  }

  const who = { name: target.name, segment: target.segment };
  if (pinnedAnswer === null) return { kind: 'unresolved', entry: { ...who, reason: 'timedOut' } };
  if (pinnedAnswer.ok) {
    return { kind: 'quiet', entry: { ...target, boardUrl: boardUrl(target.atsType, target.atsToken) } };
  }
  const reason = failureReason(pinnedAnswer);
  return {
    kind: 'unresolved',
    entry: pinnedAnswer.error === undefined ? { ...who, reason } : { ...who, reason, detail: pinnedAnswer.error },
  };
}

export interface PackResolution {
  resolved: ResolvedEntry[];
  quiet: QuietEntry[];
  unresolved: UnresolvedEntry[];
}

export interface PackPreview {
  toAdd: ResolvedEntry[];
  alreadyAdded: ResolvedEntry[];
  quiet: QuietEntry[];
  unresolved: UnresolvedEntry[];
}

/**
 * Splits resolved entries against the boards already in the database. Entries
 * that resolved to nothing stay in `unresolved` so the user can chase them by
 * hand — a name is never dropped silently. A quiet board already tracked is
 * reported as tracked, with its zero.
 */
export function buildPreview(
  { resolved, quiet, unresolved }: PackResolution,
  existingKeys: ReadonlySet<string>,
): PackPreview {
  const toAdd: ResolvedEntry[] = [];
  const alreadyAdded: ResolvedEntry[] = [];
  const seen = new Set(existingKeys);

  for (const entry of resolved) {
    const key = keyOf(entry.atsType, entry.atsToken);
    if (seen.has(key)) {
      alreadyAdded.push(entry);
    } else {
      // A pack can only ever add a board once, even if two names resolve to
      // the same slug — the DB unique index would reject the second anyway.
      seen.add(key);
      toAdd.push(entry);
    }
  }

  const tracked = (e: QuietEntry) => existingKeys.has(keyOf(e.atsType, e.atsToken));
  for (const entry of quiet.filter(tracked)) alreadyAdded.push({ ...entry, jobsCount: 0, pinned: true });

  return { toAdd, alreadyAdded, quiet: quiet.filter((e) => !tracked(e)), unresolved: [...unresolved] };
}
