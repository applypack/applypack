/*
 * The sentence a failure is written in (three parts: what failed, what is
 * safe, the way forward). Pure, so a page and a run registry can both say it.
 */

import { t } from '../i18n/t';

/**
 * The run's error line: what failed, the provider's one-line reason when there
 * is one (#184), then `next` — what is safe and the way forward, which only
 * the caller knows. Without a reason the web log is where the detail lives.
 */
export function runFailure(what: string, reason: string, next: string): string {
  return reason ? t('runFailure.withReason', { what, reason, next }) : t('runFailure.noReason', { what, next });
}
