/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Badge, Notice, Table, Td, Tr } from '../ui';
import { BILLING_WORDS } from '../../ai-spend';
import type { AiBilling } from '../../ai-usage';
import type { AiPlanRow } from '../ai-plan';

export const BILLING_TONE: Record<AiBilling, 'warn' | 'ok' | 'neutral'> = { billed: 'warn', local: 'ok', plan: 'neutral' };

/** Who does what (ADR 0060): one row a task, the engine that answers it first and the ones behind it. */
export const AiPlan: FC<{ plan: AiPlanRow[] }> = ({ plan }) => {
  const unclaimed = plan.filter((p) => p.unclaimed).map((p) => p.label);
  return (
    <>
      <Table columns={['Task', 'Answered by', 'If that fails']} caption="Which engine answers each task" hideBelow={['', '', 'sm']}>
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
                    <span class="text-ink">{first.label}</span>
                    <span class="font-mono text-meta text-ink-muted">{first.model}</span>
                    <Badge tone={BILLING_TONE[first.billing]}>{BILLING_WORDS[first.billing]}</Badge>
                  </div>
                )}
              </Td>
              <Td class="text-ink-muted">
                {behind.length > 0 ? behind.map((e) => `${e.label} · ${e.model}`).join(' → ') : 'Nothing behind it'}
              </Td>
            </Tr>
          );
        })}
      </Table>
      {unclaimed.length > 0 && (
        <Notice tone="warn">
          No engine that can run here takes {unclaimed.join(', ')}, so every engine in the list may
          answer {unclaimed.length === 1 ? 'it' : 'them'}. Tick the task on the engine that should.
        </Notice>
      )}
    </>
  );
};
