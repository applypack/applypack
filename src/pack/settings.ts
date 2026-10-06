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
const numberOf = (v: unknown): unknown => {
  const text = first(v);
  return typeof text === 'string' && text.trim() !== '' ? Number(text) : undefined;
};

/**
 * The settings form (`parseBody({ all: true })`): a checkbox left unticked is
 * absent, so a missing box is "off" and a missing section list is "none" —
 * unlike a stored value, where missing means the default.
 */
export function packSettingsFromForm(form: Record<string, unknown>): PackSettings {
  return parsePackSettings({
    enabled: first(form.enabled) === '1',
    minFit: numberOf(form.minFit),
    dailyLimit: numberOf(form.dailyLimit),
    maxAgeDays: numberOf(form.maxAgeDays),
    coverLetter: first(form.coverLetter),
    policy: {
      sections: list(form.sections).filter((s) => (POLICY_SECTIONS as readonly unknown[]).includes(s)),
      maxBullets: numberOf(form.maxBullets),
      removals: first(form.removals) === '1',
      keywords: first(form.keywords) === '1',
    },
  });
}

/** Whether the posting's own text asks for a letter — the one place the dashboard can read it from. */
export function asksForCoverLetter(description: string): boolean {
  return /\bcover[\s-]?letter\b|\bmotivation(?:al)?\s+letter\b|\bletter\s+of\s+(?:interest|motivation)\b/i.test(description);
}

export function wantsCoverLetter(mode: CoverLetterMode, description: string): boolean {
  return mode === 'always' || (mode === 'asked' && asksForCoverLetter(description));
}
