/*
 * Which language a posting is written in, well enough to say so (TASKS S20):
 * the comparison, its suggestions and the letter are written for English, and
 * a German or Ukrainian posting read as if it were English gives advice that
 * misses and a letter in the wrong language. Descriptions arrive in German,
 * Polish, French, Swedish, Ukrainian (country-search-plan §7.2). Pure: the
 * commonest function words of each language, counted — no model, no package.
 */

import { t } from './i18n/t';

export interface TextLanguage {
  code: string;
  name: string;
}

/** Function words a posting cannot avoid, and nothing a tech term could be. */
const STOPWORDS: Record<string, { name: string; words: string[] }> = {
  en: { name: 'English', words: ['the', 'and', 'with', 'you', 'for', 'our', 'are', 'will', 'your', 'have', 'we', 'of', 'to', 'in', 'is'] },
  de: { name: 'German', words: ['und', 'die', 'der', 'mit', 'für', 'wir', 'sie', 'das', 'ist', 'bei', 'ein', 'eine', 'auf', 'dich', 'du'] },
  pl: { name: 'Polish', words: ['i', 'w', 'z', 'na', 'do', 'oraz', 'się', 'jest', 'dla', 'nie', 'jak', 'będzie', 'pracy', 'lub', 'od'] },
  fr: { name: 'French', words: ['et', 'le', 'la', 'les', 'des', 'de', 'vous', 'pour', 'une', 'du', 'nous', 'est', 'dans', 'avec', 'sur'] },
  es: { name: 'Spanish', words: ['y', 'el', 'la', 'los', 'las', 'de', 'para', 'con', 'una', 'que', 'por', 'del', 'en', 'tu', 'nuestro'] },
  nl: { name: 'Dutch', words: ['en', 'de', 'het', 'een', 'van', 'voor', 'met', 'je', 'wij', 'we', 'jij', 'zijn', 'op', 'te', 'ons'] },
  sv: { name: 'Swedish', words: ['och', 'att', 'som', 'för', 'med', 'på', 'är', 'vi', 'du', 'av', 'en', 'ett', 'har', 'till', 'dig'] },
  it: { name: 'Italian', words: ['e', 'il', 'la', 'di', 'per', 'con', 'che', 'un', 'una', 'del', 'della', 'sono', 'nel', 'ai', 'gli'] },
  pt: { name: 'Portuguese', words: ['e', 'o', 'a', 'de', 'para', 'com', 'que', 'um', 'uma', 'do', 'da', 'em', 'os', 'nos', 'você'] },
  uk: { name: 'Ukrainian', words: ['і', 'та', 'в', 'з', 'на', 'що', 'для', 'від', 'до', 'або', 'ми', 'ви', 'це', 'буде', 'роботи'] },
  ru: { name: 'Russian', words: ['и', 'в', 'с', 'на', 'что', 'для', 'от', 'до', 'или', 'мы', 'вы', 'это', 'будет', 'работы', 'не'] },
};

/** Letters one of the two Cyrillic languages has and the other does not. */
const UKRAINIAN_ONLY = /[іїєґ]/i;
const RUSSIAN_ONLY = /[ыэъё]/i;
/** The head of a posting says what language it is in; the rest only costs time. */
const SAMPLE_CHARS = 4_000;
/** Fewer function words than this and the text is a list of names, not prose. */
const MIN_HITS = 8;

export function textLanguage(text: string): TextLanguage | null {
  const sample = text.slice(0, SAMPLE_CHARS).toLowerCase();
  const words = sample.match(/[\p{L}]+/gu) ?? [];
  const counts = new Map<string, number>();
  for (const [code, { words: list }] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    counts.set(code, words.filter((w) => set.has(w)).length);
  }
  let best: string | null = null;
  for (const [code, n] of counts) if (best === null || n > counts.get(best)!) best = code;
  if (best === null || counts.get(best)! < MIN_HITS) return null;
  // Ukrainian and Russian share most short words; the alphabet decides.
  if (best === 'uk' || best === 'ru') {
    if (UKRAINIAN_ONLY.test(sample) && !RUSSIAN_ONLY.test(sample)) best = 'uk';
    else if (RUSSIAN_ONLY.test(sample) && !UKRAINIAN_ONLY.test(sample)) best = 'ru';
  }
  return { code: best, name: STOPWORDS[best]!.name };
}

/**
 * The sentence the comparison and the letter show when the posting is not in
 * English; null when it is, or when too little prose says which language.
 */
export function notEnglishNotice(postingText: string): string | null {
  const language = textLanguage(postingText);
  if (language === null || language.code === 'en') return null;
  // The message names the language itself, by its code: a translation declines it where its sentence needs.
  return t('target.notEnglish', { code: language.code });
}
