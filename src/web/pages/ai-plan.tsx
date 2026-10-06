/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Badge, Notice, Table, Td, Tr } from '../ui';
import { billingWords } from '../../ai-spend';
import type { AiBilling } from '../../ai-usage';
import type { AiPlanRow } from '../ai-plan';
import { t } from '../../i18n/t';

export const BILLING_TONE: Record<AiBilling, 'warn' | 'ok' | 'neutral'> = { billed: 'warn', local: 'ok', plan: 'neutral' };

/** Who does what (ADR 0060): one row a task, the engine that answers it first and the ones behind it. */
export const AiPlan: FC<{ plan: AiPlanRow[] }> = ({ plan }) => {
  const unclaimed = plan.filter((p) => p.unclaimed).map((p) => p.label);
  return (
    <>
      <Table columns={[t('plan.col.task'), t('plan.col.answeredBy'), t('plan.col.ifThatFails')]} caption={t('plan.whichEngineAnswersEachTask')} hideBelow={['', '', 'sm']}>
        {plan.map((p) => {
          const [first, ...behind] = p.engines;
          return (
            <Tr>
              <Td>
                <div class="text-ink">{p.label}</div>
                <div class="text-meta text-ink-faint" data-ui="hint">{p.desc}</div>
              </Td>
              <Td>
                {first && (
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="text-ink" translate="no">
                      {first.label}
                    </span>
                    <span class="font-mono text-meta text-ink-muted" translate="no">
                      {first.model}
                    </span>
                    <Badge tone={BILLING_TONE[first.billing]}>{billingWords(first.billing)}</Badge>
                  </div>
                )}
              </Td>
              <Td class="text-ink-muted">
                {behind.length > 0 ? (
                  // Engine and model names in a row: data, whatever language the page is in.
                  <span translate="no">{behind.map((e) => `${e.label} · ${e.model}`).join(' → ')}</span>
                ) : (
                  t('plan.nothingBehindIt')
                )}
              </Td>
            </Tr>
          );
        })}
      </Table>
      {unclaimed.length > 0 && (
        <Notice tone="warn">{t('plan.unclaimed', { tasks: unclaimed.join(', '), n: unclaimed.length })}</Notice>
      )}
    </>
  );
};
