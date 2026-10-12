import { z } from 'zod';
import { ACTION_SECTIONS } from '../resume/prompts';
import { DEFAULT_POLICY, type TailorPolicy } from './policy';

/*
 * What the person decides about application packs (ADR 0063): whether the
 * worker prepares them at all, for which postings, how many a day, and what
 * an unattended edit may touch. Pure — `AppSettings.pack` in, a whole value
 * out. NULL, or anything this cannot read, is the feature switched off: a
 * fresh install spends nothing here until its owner says so.
 */

/** never: no letter · asked: when the posting's own text asks for one · always. */
export const COVER_LETTER_MODES = ['never', 'asked', 'always'] as const;
export type CoverLetterMode = (typeof COVER_LETTER_MODES)[number];

export const PACK_LIMITS = {
  minFit: { min: 50, max: 100, fallback: 90 },
  /** 0 = no limit. */
  dailyLimit: { min: 0, max: 50, fallback: 5 },
  maxAgeDays: { min: 1, max: 60, fallback: 7 },
  maxBullets: { min: 0, max: 6, fallback: DEFAULT_POLICY.maxBullets },
} as const;

/** The sections an unattended edit may be given: never the education or the layout. */
export const POLICY_SECTIONS = ['title', 'summary', 'skills', 'experience'] as const satisfies readonly (typeof ACTION_SECTIONS)[number][];

const whole = (limit: { min: number; max: number; fallback: number }) =>
  z.number().int().min(limit.min).max(limit.max).catch(limit.fallback).default(limit.fallback);

const PolicySchema = z
  .object({
    sections: z.array(z.enum(POLICY_SECTIONS)).catch([...DEFAULT_POLICY.sections] as (typeof POLICY_SECTIONS)[number][]),
    maxBullets: whole(PACK_LIMITS.maxBullets),
    removals: z.boolean().catch(DEFAULT_POLICY.removals),
    keywords: z.boolean().catch(DEFAULT_POLICY.keywords),
  })
  .catch({ ...DEFAULT_POLICY, sections: [...POLICY_SECTIONS] });

const PackSettingsSchema = z.object({
  enabled: z.boolean().catch(false).default(false),
  /**
   * When the switch was last turned on (ISO, UTC); null while it is off. It
   * tells a posting found since from one that was already stored: another
   * source's copy of a stored posting gets no pack of its own when the
   * original predates this (#380). Stamped by `switchedOn`, never typed.
   */
  enabledAt: z.string().datetime().nullable().catch(null).default(null),
  /** The classifier fit a new posting needs before a pack is prepared for it. */
  minFit: whole(PACK_LIMITS.minFit),
  /** Packs the worker starts on its own in one UTC day; the person's own "Prepare" never counts. */
  dailyLimit: whole(PACK_LIMITS.dailyLimit),
  /** A posting published longer ago than this is not prepared on its own. */
  maxAgeDays: whole(PACK_LIMITS.maxAgeDays),
  coverLetter: z.enum(COVER_LETTER_MODES).catch('never').default('never'),
  policy: PolicySchema.default({ ...DEFAULT_POLICY, sections: [...POLICY_SECTIONS] }),
});

export type PackSettings = Omit<z.infer<typeof PackSettingsSchema>, 'policy'> & { policy: TailorPolicy };

/** The settings as stored; a missing or unreadable value is the defaults with the feature off. */
export function parsePackSettings(raw: unknown): PackSettings {
  const parsed = PackSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : PackSettingsSchema.parse({});
}

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
const list = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
/** A number field as typed: an emptied one is missing, and text that is no number is NaN — both are refused, neither is replaced. */
const numberOf = (v: unknown): unknown => {
  const text = first(v);
  return typeof text === 'string' && text.trim() !== '' ? Number(text) : undefined;
};

/** A number the form offers: whole, and inside the range its field shows. */
const offered = (limit: { min: number; max: number }) => z.number().int().min(limit.min).max(limit.max);
/** A box: its value when ticked, absent when not. */
const box = z.literal('1').optional();

/**
 * The form, field by field under the names the page gives them and in the
 * order it shows them — so the first issue is the first field a person meets,
 * and its path names the input to mark (flash.ts:refusedField). Unlike the
 * stored value's schema, nothing here falls back to a default.
 */
const PackFormSchema = z.object({
  enabled: box,
  minFit: offered(PACK_LIMITS.minFit),
  dailyLimit: offered(PACK_LIMITS.dailyLimit),
  maxAgeDays: offered(PACK_LIMITS.maxAgeDays),
  coverLetter: z.enum(COVER_LETTER_MODES),
  sections: z.array(z.enum(POLICY_SECTIONS)),
  maxBullets: offered(PACK_LIMITS.maxBullets),
  keywords: box,
  removals: box,
});

type PackForm = { ok: true; settings: PackSettings } | { ok: false; issues: z.ZodIssue[] };

/**
 * The settings form (`parseBody({ all: true })`): a checkbox left unticked is
 * absent, so a missing box is "off" and a missing section list is "none" —
 * unlike a stored value, where missing means the default. A value the form
 * does not offer is refused with its field named, never replaced (#383): a
 * fit of 40 used to be stored as 90 and reported as saved, the opposite of
 * what was asked. The lenient reading above is for what is already stored.
 */
export function packSettingsFromForm(form: Record<string, unknown>): PackForm {
  const parsed = PackFormSchema.safeParse({
    enabled: first(form.enabled),
    minFit: numberOf(form.minFit),
    dailyLimit: numberOf(form.dailyLimit),
    maxAgeDays: numberOf(form.maxAgeDays),
    coverLetter: first(form.coverLetter),
    sections: list(form.sections),
    maxBullets: numberOf(form.maxBullets),
    keywords: first(form.keywords),
    removals: first(form.removals),
  });
  if (!parsed.success) return { ok: false, issues: parsed.error.issues };
  const typed = parsed.data;
  return {
    ok: true,
    settings: {
      enabled: typed.enabled === '1',
      // The form knows nothing of it: the save stamps it (switchedOn).
      enabledAt: null,
      minFit: typed.minFit,
      dailyLimit: typed.dailyLimit,
      maxAgeDays: typed.maxAgeDays,
      coverLetter: typed.coverLetter,
      policy: {
        sections: [...new Set(typed.sections)],
        maxBullets: typed.maxBullets,
        removals: typed.removals === '1',
        keywords: typed.keywords === '1',
      },
    },
  };
}

/**
 * The settings a save stores: the moment packs were switched on is kept
 * while they stay on, set when they go on — or were on with none recorded —
 * and cleared when they go off.
 */
export function switchedOn(next: PackSettings, previous: PackSettings, now: Date): PackSettings {
  if (!next.enabled) return { ...next, enabledAt: null };
  return { ...next, enabledAt: previous.enabled && previous.enabledAt ? previous.enabledAt : now.toISOString() };
}

/** Since when packs have been on; null while they are off, or when nothing recorded the moment. */
export function packsOnSince(settings: PackSettings): Date | null {
  return settings.enabled && settings.enabledAt ? new Date(settings.enabledAt) : null;
}

/** Whether the posting's own text asks for a letter — the one place the dashboard can read it from. */
export function asksForCoverLetter(description: string): boolean {
  return /\bcover[\s-]?letter\b|\bmotivation(?:al)?\s+letter\b|\bletter\s+of\s+(?:interest|motivation)\b/i.test(description);
}

export function wantsCoverLetter(mode: CoverLetterMode, description: string): boolean {
  return mode === 'always' || (mode === 'asked' && asksForCoverLetter(description));
}
