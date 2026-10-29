/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Badge, Notice, Table, Td, Tr } from '../ui';
import { billingWords } from '../../ai-spend';
import { AI_PROVIDER_LABELS, type AiProviderId } from '../../ai-engine';
import type { AiBilling } from '../../ai-usage';
import type { AiPlanRow } from '../ai-plan';
import type { HideBelow } from '../table-hide';
import { t } from '../../i18n/t';

/**
 * An engine's name: a product's own stays as written (`translate="no"`); the
 * two ApplyPack names in the reader's language ("OpenAI-compatible", "Local
 * model") are the labels `ai-engine.ts` words when read.
 */
const EngineName: FC<{ engine: { id: AiProviderId; label: string } }> = ({ engine }) =>
  typeof Object.getOwnPropertyDescriptor(AI_PROVIDER_LABELS, engine.id)?.get === 'function' ? (
    <>{engine.label}</>
  ) : (
    <span translate="no">{engine.label}</span>
  );

/** A model's id stays as written, and breaks anywhere in a narrow column; "CLI default" and "no model chosen" (ai-plan.ts, an empty slot) are ours. */
const ModelName: FC<{ model: string }> = ({ model }) =>
  model === t('ai.cliDefault') || model === t('ai.noModel') ? <>{model}</> : <span translate="no" class="[overflow-wrap:anywhere]">{model}</span>;

export const BILLING_TONE: Record<AiBilling, 'warn' | 'ok' | 'neutral'> = { billed: 'warn', local: 'ok', plan: 'neutral' };

/**
 * The table's columns (#619): the engine that answers keeps the width of its
 * billing badge's widest word in every language, and from `xl` a dated model
 * id on one line (#651); the task takes what is left, and what stands behind
 * joins from `sm`. table-hide.test.ts holds them on /ai's card and in the
 * settings section alike.
 */
export const AI_PLAN_WIDTHS = ['', 'w-[8.25rem] xl:w-[14rem]', 'w-[30%]'];
export const AI_PLAN_HIDE: HideBelow = ['', '', 'sm'];

/** Who does what (ADR 0060): one row a task, the engine that answers it first and the ones behind it. */
export const AiPlan: FC<{ plan: AiPlanRow[] }> = ({ plan }) => {
  const unclaimed = plan.filter((p) => p.unclaimed).map((p) => p.label);
  return (
    <>
      <Table
        columns={[t('plan.col.task'), t('plan.col.answeredBy'), t('plan.col.ifThatFails')]}
        caption={t('plan.whichEngineAnswersEachTask')}
        widths={AI_PLAN_WIDTHS}
        hideBelow={AI_PLAN_HIDE}
      >
        {plan.map((p) => {
          const [first, ...behind] = p.engines;
          return (
            <Tr>
              <Td class="break-words">
                <div class="text-ink">{p.label}</div>
                <div class="text-meta text-ink-faint" data-ui="hint">{p.desc}</div>
              </Td>
              <Td>
                {first && (
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="text-ink">
                      <EngineName engine={first} />
                    </span>
                    <span class="font-mono text-meta text-ink-muted">
                      <ModelName model={first.model} />
                    </span>
                    <Badge tone={BILLING_TONE[first.billing]} wrap>
                      {billingWords(first.billing)}
                    </Badge>
                  </div>
                )}
              </Td>
              <Td class="text-ink-muted">
                {behind.length > 0 ? (
                  // Engine and model names in a row: data, whatever language the page is in — but for an engine ApplyPack names.
                  <span>
                    {behind.map((e, i) => (
                      <>
                        {i > 0 && ' → '}
                        <EngineName engine={e} /> · <ModelName model={e.model} />
                      </>
                    ))}
                  </span>
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
