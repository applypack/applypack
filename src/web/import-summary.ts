import type { CronStats } from '../jobs/cron-run';
import { filteredReasons, funnelCounts, reasonsText } from '../funnel';
import { t } from '../i18n/t';
import type { FlashKind } from './flash';

/*
 * The verdict of a finished import as one flash, built from the stats
 * `runImportJob` returns. Pure — tested in import-summary.test.ts.
 */

function num(stats: CronStats, key: string): number {
  const v = stats[key];
  return typeof v === 'number' ? v : 0;
}

const say = (...sentences: (string | null)[]): string => sentences.filter((s) => s).join(' ');

export function summarizeImport(stats: CronStats, fileName: string, source: string): { kind: FlashKind; text: string } {
  if (stats.reason === 'overlap') return { kind: 'warn', text: t('import.summary.overlap') };
  if (stats.reason === 'no-active-profile') return { kind: 'err', text: t('import.summary.noSearch') };
  if (stats.skippedBlankProfile === 1) return { kind: 'warn', text: t('import.summary.blank', { file: fileName }) };
  const stored = num(stats, 'persisted');
  const known = num(stats, 'duplicate');
  const why = reasonsText(filteredReasons(funnelCounts(stats)), 2);
  const tail = [
    known > 0 ? t('import.summary.known', { n: known }) : null,
    why ? t('import.summary.filtered', { n: num(stats, 'filterRejected'), why }) : null,
  ];
  const head = { file: fileName, source, rows: num(stats, 'fetched'), stored };
  if (stats.classify === false) {
    return { kind: 'ok', text: say(t('import.summary.unscored', head), ...tail, stored > 0 ? t('fetchSummary.scoreLater') : null) };
  }
  if (stats.abortedMidRun === 1) {
    return { kind: 'warn', text: say(t('import.summary.pausedMidRun', head), ...tail, t('import.summary.importRest')) };
  }
  const failed = num(stats, 'classifyFailed');
  const scored = say(t('import.summary.scored', { ...head, scored: num(stats, 'classified'), alerted: num(stats, 'alerted') }), ...tail);
  if (failed > 0) return { kind: 'warn', text: say(scored, t('import.summary.failed', { n: failed })) };
  return { kind: 'ok', text: scored };
}
