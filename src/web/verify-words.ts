/*
 * The verifier answers with words from two closed lists — a verdict (legit,
 * suspicious, fake) and a signal per piece of evidence (legit, ghost, scam,
 * neutral, unverified). They are codes, not prose: the page words them in the
 * reader's language, as it already does for the recommendation. A word outside
 * the lists (an older row) is shown as it was written. Pure.
 */
import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';

const VERDICT_WORD: Record<string, MessageKey> = {
  legit: 'verify.verdict.legit',
  suspicious: 'verify.verdict.suspicious',
  fake: 'verify.verdict.fake',
};

const SIGNAL_WORD: Record<string, MessageKey> = {
  legit: 'verify.signal.legit',
  ghost: 'verify.signal.ghost',
  scam: 'verify.signal.scam',
  neutral: 'verify.signal.neutral',
  unverified: 'verify.signal.unverified',
};

const worded = (table: Record<string, MessageKey>, code: string): string | null => {
  const key = table[code.trim().toLowerCase()];
  return key ? t(key) : null;
};

/** The verdict in the reader's language, or null for a word the list does not hold. */
export const verdictWord = (verdict: string): string | null => worded(VERDICT_WORD, verdict);

/** The same for one evidence signal. */
export const signalWord = (signal: string): string | null => worded(SIGNAL_WORD, signal);
