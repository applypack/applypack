import type { AiAttempt } from '../ai-provider';
import { formatNumber } from '../i18n/format';
import { t } from '../i18n/t';
import { listsModel } from '../server-models';

/** How many of the server's models the sentence names before it trails off. */
const OFFERED_SHOWN = 5;
/** Seconds as `toFixed(1)` writes them, with the reader's decimal mark: "1.5" in English, "1,5" in Ukrainian. */
const SECONDS_FORMAT = { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false } as const;

export interface EngineTestResult {
  ok: boolean;
  text: string;
}

/** What one press of Test found out, once its call is back. */
export interface TestFacts {
  /** The engine's name as the page writes it. */
  engine: string;
  model: string;
  attempt: Pick<AiAttempt, 'text' | 'queuedMs'>;
  /** From just before the call until it came back, a wait for a local server's slot included. */
  elapsedMs: number;
  /** The reason the provider handed over, if it failed and said why. */
  failure: string | null;
  /** The models the server listed, or null when it was not asked or did not answer. */
  offered: string[] | null;
  pickedForTest: boolean;
  /** Why the server's models could not be listed; '' when they could. */
  unlistable: string;
}

/**
 * The ledger's time and the button's sentence, off one clock: the engine's
 * own time, without the wait for a local server's one slot (#564, #611).
 */
export function testReport(f: TestFacts): { durationMs: number; result: EngineTestResult } {
  const durationMs = f.elapsedMs - (f.attempt.queuedMs ?? 0);
  const seconds = formatNumber(Number((durationMs / 1000).toFixed(1)), SECONDS_FORMAT);
  const offer =
    f.offered === null
      ? ''
      : f.offered.length === 0
        ? t('aiTest.offersNone')
        : t('aiTest.offers', { n: f.offered.length, models: `${f.offered.slice(0, OFFERED_SHOWN).join(', ')}${f.offered.length > OFFERED_SHOWN ? ', …' : ''}` });
  if (f.attempt.text !== null) {
    const worked = f.model ? t('aiTest.works', { engine: f.engine, seconds, model: f.model }) : t('aiTest.worksCliDefault', { engine: f.engine, seconds });
    return { durationMs, result: { ok: true, text: sentences(worked, f.pickedForTest ? t('aiTest.pickedForTest') : '', offer) } };
  }
  // A model the server never pulled is the likeliest cause on a local server; the list says so.
  const unlisted = f.offered !== null && f.offered.length > 0 && f.model !== '' && !listsModel(f.offered, f.model) ? t('aiTest.unlisted', { model: f.model }) : '';
  const failed = f.failure === null ? t('aiTest.failedNoReason', { engine: f.engine, seconds }) : t('aiTest.failed', { engine: f.engine, seconds, reason: f.failure });
  return { durationMs, result: { ok: false, text: sentences(failed, unlisted, offer, f.unlistable) } };
}

/** Whole sentences side by side; the ones that do not apply are empty. */
function sentences(...parts: string[]): string {
  return parts.filter((part) => part !== '').join(' ');
}
