/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Card, Disclosure, SectionTitle, Table, Td, Tr } from '../ui';
import { reasonsText, stageCount, type FunnelReason, type FunnelView } from '../../funnel';
import type { SourceYield } from '../../jobs/funnel-store';
import { formatNumber } from '../../i18n/format';
import { t } from '../../i18n/t';

/**
 * The search funnel on /runs (TASKS §20 `search-funnel`): the stages over the
 * last 7 and 30 days, why the filter and the scoring set postings aside, and
 * what each source brought. Zero AI — the numbers every tick already writes.
 */
export const FunnelCard: FC<{ week: FunnelView; month: FunnelView; sources: SourceYield[] }> = ({ week, month, sources }) => (
  <section id="funnel" class="mb-8">
    <SectionTitle level="section">{t('funnel.searchFunnel')}</SectionTitle>
    <Card flush>
      <Table
        caption={t('funnel.searchFunnel')}
        columns={[t('funnel.column.stage'), t('funnel.column.week'), t('funnel.column.month')]}
        widths={['w-[47%]', 'w-[24%]', 'w-[28%]']}
        thClasses={['', 'text-right', 'text-right']}
      >
        {month.stages.map((stage) => (
          <Tr>
            <Td class="text-ink">{stage.label}</Td>
            <Td class="text-right tabular-nums text-ink">{count(stageCount(week, stage.key))}</Td>
            <Td class="text-right tabular-nums text-ink-muted">{count(stage.count)}</Td>
          </Tr>
        ))}
      </Table>
      <div class="space-y-1 border-t border-line px-3.5 py-3 text-note leading-5 text-ink-muted sm:px-5">
        <ReasonLine title={t('funnel.setAsideByTheFilter')} reasons={month.filtered} />
        <ReasonLine title={t('funnel.dismissedAfterScoring')} reasons={month.dismissed} />
        {sources.length > 0 && (
          <Disclosure summary={t('funnel.bySourceLast30Days')} class="pt-1">
            <div class="mt-2 overflow-hidden rounded-lg border border-line">
              <Table
                caption={t('funnel.whatEachSourceBroughtIn')}
                columns={[t('funnel.column.source'), t('funnel.column.new'), t('funnel.column.matches')]}
                widths={['w-[47%]', 'w-[24%]', 'w-[28%]']}
                thClasses={['', 'text-right', 'text-right']}
              >
                {sources.map((s) => (
                  <Tr>
                    <Td class="text-ink">
                      <span translate="no">{s.name}</span>
                    </Td>
                    <Td class="text-right tabular-nums">{count(s.stored)}</Td>
                    <Td class="text-right tabular-nums">{count(s.matches)}</Td>
                  </Tr>
                ))}
              </Table>
            </div>
          </Disclosure>
        )}
      </div>
    </Card>
  </section>
);

/** "Set aside by the filter, 30 days: 4,900 without a title keyword, …" — nothing when nothing was. */
const ReasonLine: FC<{ title: string; reasons: FunnelReason[] }> = ({ title, reasons }) =>
  reasons.length > 0 ? (
    <p>
      <span class="font-medium text-ink">{t('funnel.reasonsTitle', { title })}</span> {reasonsText(reasons)}.
    </p>
  ) : null;

function count(n: number): string {
  return formatNumber(n);
}
