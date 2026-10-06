import type { KeywordMatcher } from './keyword-matcher';
import { effectiveKeywords } from './keyword-overrides';
import { SUMMARY_FILLER, type MatchAction, type MatchKeyword, type PostingBrief } from './prompts';
import { structureFromText } from './structure-from-text';
import { t } from '../i18n/t';

/*
 * What this posting's first reader looks for in a summary, held against the
 * summary the resume has, with no AI (docs/resume-summary.md). The prompt's
 * SUMMARY RULES make the model write to the same list. This is the list the
 * user reads: a suggested summary arrives with the reasons behind its shape,
 * and a summary that already does the job is told so. Pure.
 *
 * Every check reads the TEXT: a term counts when the matcher finds it in the
 * summary, a number when there is one, the years as the summary states them.
 * What a sentence means (does it read as written for this job?) is the
 * comparison's `alignment.summary` grade, and nothing here second-guesses it.
 */

/** Recruiter guides agree on 2-4 sentences; past ~80 words the eye skips the block. */
const SENTENCES = { min: 2, max: 4 } as const;
const WORDS = { min: 25, max: 80 } as const;
/** Two must-haves named is what grades a summary strong (prompts.ts RULE_ALIGNMENT). */
const MUSTS_FOR_STRONG = 2;
/** How many of the reader's scan-for lines and of the suggested terms the card shows. */
const SHOW_SCAN = 4;
const SHOW_TERMS = 3;

export type CheckState = 'ok' | 'todo' | 'warn';

export interface SummaryCheck {
  key: 'role' | 'years' | 'stack' | 'musts' | 'proof' | 'length' | 'voice' | 'avoid';
  state: CheckState;
  /** What the reader looks for, in a few words. */
  label: string;
  /** How this summary does against it, one clause. */
  detail: string;
}

export interface SummaryGuide {
  /** Who reads the resume first, from the posting brief; null without one. */
  reader: string | null;
  scanFor: string[];
  /** The summary as the resume holds it; null when none was found. */
  summary: string | null;
  checks: SummaryCheck[];
  /** How many of the same checks the comparison's suggested summary passes; null when it wrote none. */
  proposed: number | null;
}

export interface SummaryGuideInput {
  resumeText: string;
  /** The comparison's actions: a summary with no heading over it is found by the one they quote. */
  actions: MatchAction[];
  keywords: MatchKeyword[];
  brief: PostingBrief | null;
  jobTitle: string;
  matcher: Pick<KeywordMatcher, 'findTerm'>;
}

/** The summary paragraph: under its own heading, else the span the comparison quoted to rewrite it. */
export function findSummary(resumeText: string, actions: MatchAction[]): string | null {
  const parsed = structureFromText(resumeText).basics.summary?.trim();
  if (parsed) return parsed;
  const quoted = actions.find((a) => a.section === 'summary' && a.quote && resumeText.includes(a.quote))?.quote;
  return quoted ?? null;
}

/** A dot that ends an abbreviation does not end a sentence ("Sr. PHP Developer", "e.g. Symfony"). */
const ABBREVIATION = /\b(?:Sr|Jr|Inc|Ltd|Co|vs|etc|approx|e\.g|i\.e)\./gi;

export function countSentences(text: string): number {
  const plain = text.replace(ABBREVIATION, (m) => m.slice(0, -1));
  return plain.split(/[.!?]+(?:\s+|$)/).filter((s) => s.trim() !== '').length;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const YEARS = /\b(\d{1,2})\s*\+?\s*(?:years?|yrs)\b/gi;

/** The most years the summary states, with the words it states them in. */
function yearsStated(text: string): { years: number; text: string } | null {
  let best: { years: number; text: string } | null = null;
  for (const m of text.matchAll(YEARS)) {
    const years = Number(m[1]);
    if (!best || years > best.years) best = { years, text: m[0] };
  }
  return best;
}

/**
 * A result with a number: money, a percentage, a multiple or a magnitude, or a
 * count of two digits and more of something ("40 engineers"). A one-digit
 * number alone is a version ("PHP 8") far more often than a result, and the
 * years are the `years` check's, so they are taken out first.
 */
const METRIC =
  /[$€£]\s?\d[\d.,]*\s?[kmb]?\+?(?:\s[a-z]{2,})?|\b\d[\d.,]*\s?(?:%|x\b|[kmb]\b\+?)(?:\s[a-z]{2,})?|\b\d{2,}[\d,]*\+?\s[a-z]{3,}/i;

function firstMetric(text: string): string | null {
  return METRIC.exec(text.replace(YEARS, ' '))?.[0].trim() ?? null;
}

const PRONOUN = /\bI(?:'m|'ve|'d)?\b(?!\/)|\b(?:my|me|myself)\b/gi;

/** "I" is a pronoun only as a capital and never in "I/O"; "my" and "me" in any case. */
function voiceSlips(text: string): string[] {
  const pronouns = [...text.matchAll(PRONOUN)].map((m) => m[0]).filter((w) => !/^i/.test(w));
  const filler = SUMMARY_FILLER.filter((f) => new RegExp(`\\b${f}\\b`, 'i').test(text));
  return [...new Set([...pronouns, ...filler])];
}

/** The resume's own words, in the reader's quotation marks. */
const quoted = (text: string) => t('summary.quoted', { text });
const has = (k: MatchKeyword) => k.status === 'present' || k.status === 'add';
const sameTerm = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The option of an either/or this resume already holds, when `k` is the other
 * one. The keyword's own `group` label says so when the model put it on both;
 * the brief's requirement groups say so when it labelled one side only (the
 * live row grouped Java and left PHP bare).
 */
function alternativeHeld(k: MatchKeyword, keywords: MatchKeyword[], brief: PostingBrief | null): MatchKeyword | undefined {
  const labelled = k.group ? keywords.find((o) => o !== k && o.group === k.group && has(o)) : undefined;
  if (labelled) return labelled;
  const group = brief?.requirement_groups.find((g) => g.satisfy === 'any' && g.options.some((o) => sameTerm(o, k.term)));
  return group ? keywords.find((o) => o !== k && has(o) && group.options.some((opt) => sameTerm(opt, o.term))) : undefined;
}

export function summaryGuide(input: SummaryGuideInput): SummaryGuide {
  const summary = findSummary(input.resumeText, input.actions);
  // The comparison's own summary wording, held to the same list: the user sees
  // that the suggestion was written to it, before they apply anything.
  const proposal = input.actions.find((a) => a.section === 'summary' && typeof a.replacement === 'string' && a.replacement.trim() !== '');
  return {
    reader: input.brief?.screening.reader ?? null,
    scanFor: input.brief?.screening.scan_for.slice(0, SHOW_SCAN) ?? [],
    summary,
    checks: summaryChecks(summary, input),
    proposed: proposal?.replacement ? summaryChecks(proposal.replacement, input).filter((c) => c.state === 'ok').length : null,
  };
}

function summaryChecks(summary: string | null, input: SummaryGuideInput): SummaryCheck[] {
  const text = summary ?? '';
  const keywords = effectiveKeywords(input.keywords);
  const named = (k: MatchKeyword) => input.matcher.findTerm(text, k.term, k.aliases ?? []).length > 0;
  const checks: SummaryCheck[] = [];

  // The role: the posted title is the one keyword at priority 2 (prompts.ts RULE_KEYWORDS).
  const title = keywords.find((k) => k.priority === 2);
  const role = title?.term ?? input.brief?.role.posted_title ?? input.jobTitle;
  const roleNamed = title ? named(title) : input.matcher.findTerm(text, role, []).length > 0;
  checks.push({
    key: 'role',
    state: roleNamed ? 'ok' : 'todo',
    label: t('summary.role.label'),
    detail: t(roleNamed ? 'summary.role.named' : 'summary.role.missing', { role }),
  });

  const asked = input.brief?.role.years_min ?? null;
  const stated = yearsStated(text);
  checks.push({
    key: 'years',
    state: !stated ? 'todo' : asked !== null && stated.years < asked ? 'warn' : 'ok',
    label: t('summary.years.label'),
    detail: !stated
      ? asked !== null
        ? t('summary.years.missingAsked', { asked })
        : t('summary.years.missing')
      : asked !== null
        ? t('summary.years.statedAsked', { stated: stated.text, asked })
        : t('summary.years.stated', { stated: stated.text }),
  });

  const stack = keywords.filter((k) => k.primary && has(k));
  if (stack.length > 0) {
    const missing = stack.filter((k) => !named(k)).map((k) => k.term);
    checks.push({
      key: 'stack',
      state: missing.length === 0 ? 'ok' : 'todo',
      label: t('summary.stack.label'),
      detail: missing.length === 0 ? t('summary.stack.all') : t('summary.stack.name', { terms: missing.join(', ') }),
    });
  }

  // Two of the posting's must-haves, primary ones included: the bar the summary grade uses.
  const musts = keywords.filter((k) => k.requirement === 'must' && k.priority !== 2 && has(k));
  if (musts.length > 0) {
    const hit = musts.filter(named).map((k) => k.term);
    const met = hit.length >= Math.min(MUSTS_FOR_STRONG, musts.length);
    // The core stack has a line of its own, so the offer here is the rest.
    const offer = musts.filter((k) => !k.primary && !named(k)).slice(0, SHOW_TERMS).map((k) => k.term);
    checks.push({
      key: 'musts',
      state: met ? 'ok' : 'todo',
      label: t('summary.musts.label'),
      detail: mustsDetail(hit.join(', '), !met ? offer.join(', ') : ''),
    });
  }

  const metric = firstMetric(text);
  checks.push({
    key: 'proof',
    state: metric ? 'ok' : 'todo',
    label: t('summary.proof.label'),
    detail: metric ? quoted(metric) : t('summary.proof.missing'),
  });

  const sentences = countSentences(text);
  const words = countWords(text);
  const size = { sentences, words };
  const length: Pick<SummaryCheck, 'state' | 'detail'> = !summary
    ? { state: 'todo', detail: t('summary.length.none') }
    : sentences > SENTENCES.max || words > WORDS.max
      ? { state: 'warn', detail: t('summary.length.long', size) }
      : sentences < SENTENCES.min || words < WORDS.min
        ? { state: 'todo', detail: t('summary.length.short', size) }
        : { state: 'ok', detail: t('summary.length.ok', size) };
  checks.push({ key: 'length', label: t('summary.length.label', { min: SENTENCES.min, max: SENTENCES.max, words: WORDS.max }), ...length });

  const slips = voiceSlips(text);
  checks.push({
    key: 'voice',
    state: slips.length === 0 ? 'ok' : 'warn',
    label: t('summary.voice.label'),
    detail: slips.length === 0 ? t('summary.voice.plain') : t('summary.voice.drop', { words: slips.map(quoted).join(', ') }),
  });

  // What the resume cannot back: a must or primary term it lacks, and the other
  // half of an either/or it already meets ("PHP and/or Java" for a PHP resume).
  const insteadOf = (k: MatchKeyword) => alternativeHeld(k, keywords, input.brief);
  const avoid = keywords.filter(
    (k) => k.status === 'cannot_claim' && (insteadOf(k) !== undefined || k.primary || k.requirement === 'must'),
  );
  if (avoid.length > 0) {
    const terms = avoid.slice(0, SHOW_TERMS);
    const claimed = terms.filter(named).map((k) => k.term);
    const either = avoid.find((k) => insteadOf(k) !== undefined);
    const instead = either ? insteadOf(either) : undefined;
    checks.push({
      key: 'avoid',
      state: claimed.length > 0 ? 'warn' : 'ok',
      label: t('summary.avoid.label'),
      detail:
        claimed.length > 0
          ? t('summary.avoid.claimed', { terms: claimed.join(', ') })
          : either && instead
            ? t('summary.avoid.either', { term: either.term, instead: instead.term })
            : t('summary.avoid.leaveOut', { terms: terms.map((k) => k.term).join(', ') }),
    });
  }

  return checks;
}

/** What the summary names of the must-haves, and what it could still name; an empty list is left out of the sentence. */
function mustsDetail(named: string, offer: string): string {
  if (named === '') return offer === '' ? t('summary.musts.none') : t('summary.musts.noneOffer', { offer });
  return offer === '' ? t('summary.musts.named', { terms: named }) : t('summary.musts.namedOffer', { terms: named, offer });
}
