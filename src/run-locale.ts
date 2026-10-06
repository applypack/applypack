import { SOURCE_LOCALE, withLocale, type Locale } from './i18n/locale';
import { logger } from './logger';
import { getDisplaySettings } from './settings';

/*
 * The language a worker run writes its messages in (ADR 0061, stage 4): the
 * one chosen for the interface, so an alert, the recap and a reminder read
 * like the dashboard. Read at the start of every cron run and every
 * once-script, never kept between them (gotcha 9): a change on Settings
 * reaches the next tick. None chosen, or a database that cannot answer, is
 * English.
 */

async function runLocale(): Promise<Locale> {
  try {
    return (await getDisplaySettings()).locale ?? SOURCE_LOCALE;
  } catch (err) {
    logger.warn({ err }, 'locale: the language could not be read; this run writes English');
    return SOURCE_LOCALE;
  }
}

/** `run` in the interface's language, read now. */
export async function inRunLocale<T>(run: () => Promise<T>): Promise<T> {
  return withLocale(await runLocale(), run);
}
