import { AsyncLocalStorage } from 'node:async_hooks';

/*
 * The language the interface is written in (ADR 0061). It rides in
 * AsyncLocalStorage, as the display zone does (web/display-zone.ts): the
 * dashboard's request middleware and the worker's tick set it once, and every
 * pure module that words something reads it through `t()` with no change to
 * its signature. Outside any context — a script, a test — it is English, so
 * the English strings the tests assert stay what they were.
 *
 * Interface only: prompts, what a model writes, resumes, letters, logs and
 * CSV values never pass through here.
 */

/**
 * Where a language stands. `ready` and `beta` are offered in the switcher
 * (beta = machine-translated from the glossary, every key present, no native
 * reader yet); `unfinished` is reachable from Settings only, while its pages
 * are still being translated; `internal` is never offered.
 */
type LocaleStage = 'ready' | 'beta' | 'unfinished' | 'internal';

interface LocaleInfo {
  /** The language's own name for itself, as the switcher writes it. */
  name: string;
  /** The tag `Intl` formats dates, numbers and plurals with; digits are Latin in every one. */
  intl: string;
  stage: LocaleStage;
}

/** A pseudo-language for the route smoke: English with every catalog string marked (pseudo.ts). */
export const PSEUDO_LOCALE = 'en-XA';

export const LOCALES = {
  en: { name: 'English', intl: 'en-US', stage: 'ready' },
  uk: { name: 'Українська', intl: 'uk-UA-u-nu-latn', stage: 'unfinished' },
  [PSEUDO_LOCALE]: { name: 'Pseudo', intl: 'en-US', stage: 'internal' },
} as const satisfies Record<string, LocaleInfo>;

export type Locale = keyof typeof LOCALES;

export const SOURCE_LOCALE: Locale = 'en';

const ALL = Object.keys(LOCALES) as Locale[];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.hasOwn(LOCALES, value);
}

function stageOf(locale: Locale): LocaleStage {
  return LOCALES[locale].stage;
}

/** The languages the switcher offers: every key translated. */
export function offeredLocales(): Locale[] {
  return ALL.filter((l) => stageOf(l) === 'ready' || stageOf(l) === 'beta');
}

/** The languages a person may still pick in Settings while their pages are being translated. */
export function unfinishedLocales(): Locale[] {
  return ALL.filter((l) => stageOf(l) === 'unfinished');
}

/** A value a form may store: anything a person can be shown, never the pseudo-language. */
export function isSelectableLocale(value: unknown): value is Locale {
  return isLocale(value) && stageOf(value) !== 'internal';
}

export function isBeta(locale: Locale): boolean {
  return stageOf(locale) === 'beta';
}

export function localeName(locale: Locale): string {
  return LOCALES[locale].name;
}

export function intlTag(locale: Locale = currentLocale()): string {
  return LOCALES[locale].intl;
}

const current = new AsyncLocalStorage<Locale>();

export function withLocale<T>(locale: Locale, fn: () => T): T {
  return current.run(locale, fn);
}

export function currentLocale(): Locale {
  return current.getStore() ?? SOURCE_LOCALE;
}

/**
 * The language finishing setup stores (#355): the one the wizard was read in,
 * unless that was the source language. A wizard in English chose nothing — the
 * browser's language may simply not have been offered yet — and storing English
 * there would keep that install from ever being invited to the language later.
 */
export function languageKeptAtSetup(shownIn: Locale): Locale | null {
  return shownIn === SOURCE_LOCALE ? null : shownIn;
}

/** How much of an Accept-Language header is read: a browser sends a handful of entries, never a page of them. */
const MAX_ACCEPT_ENTRIES = 20;

/**
 * The first of `among` the browser asks for, in the browser's own order of
 * preference ("uk-UA,uk;q=0.9,en;q=0.8" → uk when it is offered). A region is
 * ignored: `de-AT` is German. Null when the header names none of them.
 */
export function matchAcceptLanguage(header: string | undefined | null, among: readonly Locale[]): Locale | null {
  if (!header) return null;
  const wanted = header
    .split(',')
    .slice(0, MAX_ACCEPT_ENTRIES)
    .map((entry, index) => {
      const [tag = '', ...params] = entry.trim().split(';');
      // Parameter names are case-insensitive (RFC 9110): "Q=0.1" is a weight too.
      const q = params.map((p) => p.trim().toLowerCase()).find((p) => p.startsWith('q='));
      // A weight that is not a number reads as zero: the entry is left out, never promoted.
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return { language: tag.trim().toLowerCase().split(/[-_]/)[0] ?? '', weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((w) => w.language && w.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const w of wanted) {
    const hit = among.find((l) => l === w.language);
    if (hit) return hit;
  }
  return null;
}
