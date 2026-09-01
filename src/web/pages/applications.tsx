/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Empty, FitBadge, Flash, PageHeader } from '../ui';
import type { FlashMessage } from '../flash';
import {
  allStages,
  boardStages,
  dotClassFor,
  nextStageKey,
  TERMINAL_STAGES,
  type StageDef,
} from '../stage-config';
import type { StageTimeLine } from '../stage-time';

interface ApplicationCard {
  id: number;
  title: string;
  companyName: string;
  fitScore: number | null;
  recruiterContact: string | null;
  stageLine: StageTimeLine | null;
}

export interface ApplicationsProps {
  byStage: Record<string, ApplicationCard[]>;
  /** Configured work columns (ADR 0025) — entry and exits are fixed. */
  work: StageDef[];
  applicationTrackingEnabled: boolean;
  flash?: FlashMessage | null;
}

/**
 * One board card: the link navigates, the form below it quick-moves, and
 * board.mjs makes the whole card draggable. With drag active (body[data-dnd],
 * fine pointer, md+) the form collapses until the card has hover or focus —
 * it stays the keyboard and no-JS path.
 */
const StageCard: FC<{ card: ApplicationCard; stage: string; work: StageDef[] }> = ({
  card,
  stage,
  work,
}) => (
  <li
    class="rounded-md border border-line bg-surface-raised shadow-sm"
    data-job-id={card.id}
    data-stage={stage}
  >
    <a
      href={`/jobs/${card.id}`}
      class="block rounded-t-md p-3 transition-colors duration-150 hover:bg-surface-overlay/60"
    >
      <div class="line-clamp-2 text-sm font-medium leading-snug text-ink">
        {card.title}
      </div>
      <div class="mt-1 truncate text-[13px] text-ink-muted">
        {card.companyName}
      </div>
      <div class="mt-2 flex items-center justify-between gap-2">
        <span
          class={`min-w-0 truncate text-xs ${
            card.stageLine?.stale ? 'font-medium text-warn' : 'text-ink-faint'
          }`}
          title={card.stageLine?.since.toISOString().slice(0, 10)}
        >
          {card.stageLine?.text ?? 'no apply date'}
          {card.recruiterContact ? ` · ${card.recruiterContact}` : ''}
        </span>
        <FitBadge score={card.fitScore} />
      </div>
    </a>
    <form
      method="post"
      action={`/jobs/${card.id}/stage`}
      class="quick-move flex items-center gap-1.5 border-t border-line px-2 py-1.5"
    >
      <label class="sr-only" for={`move-${card.id}`}>
        Move {card.title} to stage
      </label>
      <select
        id={`move-${card.id}`}
        name="toStage"
        class="h-8 w-full min-w-0 flex-1 rounded-md border border-line-strong bg-surface-raised px-1.5 text-xs text-ink shadow-sm transition-colors duration-150 hover:border-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
      >
        {allStages(work)
          .filter((s) => s.key !== stage)
          .map((s) => (
            <option value={s.key} selected={s.key === nextStageKey(work, stage)}>
              {s.label}
            </option>
          ))}
      </select>
      <Button size="sm" variant="secondary" aria-label={`Move ${card.title}`}>
        Move
      </Button>
    </form>
  </li>
);

const ColumnHeader: FC<{ dot: string; id: string; label: string; count: number }> = ({
  dot,
  id,
  label,
  count,
}) => (
  <div class="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
    <span class={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
    <h2 id={id} class="text-[13px] font-medium text-ink">
      {label}
    </h2>
    <span class="ml-auto text-xs text-ink-faint tabular-nums">{count}</span>
  </div>
);

/*
 * Drag styling: with board.mjs active the quick-move form collapses until
 * its card has hover or keyboard focus (focus-within keeps the tab path —
 * the controls stay tabbable, unlike display:none). md+ and body[data-dnd]
 * only, so mobile and no-JS keep the always-visible form.
 */
const BOARD_CSS = `
  @media (min-width: 768px) {
    body[data-dnd] .quick-move { height: 0; padding-top: 0; padding-bottom: 0; border-top-width: 0; opacity: 0; overflow: hidden; }
    body[data-dnd] li[data-job-id]:hover .quick-move,
    body[data-dnd] li[data-job-id]:focus-within .quick-move { height: auto; padding-top: 0.375rem; padding-bottom: 0.375rem; border-top-width: 1px; opacity: 1; }
    body[data-dnd] li[data-job-id] { cursor: grab; }
    body[data-dnd] li[data-job-id]:active { cursor: grabbing; }
  }
`;

/* Coarse-pointer devices can't HTML5-drag reliably — keep their forms visible. */
const BOARD_BOOT = `
  if (window.matchMedia('(pointer: fine)').matches) {
    const { initBoard } = await import('/static/board.mjs');
    initBoard(document);
  }
`;

export const ApplicationsPage: FC<ApplicationsProps> = ({
  byStage,
  work,
  applicationTrackingEnabled,
  flash,
}) => {
  const columns = boardStages(work);
  const count = (key: string) => byStage[key]?.length ?? 0;
  const activeCount = columns.reduce((sum, s) => sum + count(s.key), 0);
  const closedCount = TERMINAL_STAGES.reduce((sum, s) => sum + count(s.key), 0);

  return (
    <Layout title="Applications" active="applications">
      <PageHeader
        title="Applications"
        meta={
          applicationTrackingEnabled
            ? `${activeCount} active${closedCount > 0 ? ` · ${closedCount} closed` : ''}`
            : undefined
        }
        actions={
          applicationTrackingEnabled ? (
            <Button href="/settings#stages" variant="ghost" size="sm">
              Edit columns
            </Button>
          ) : undefined
        }
      />
      <Flash flash={flash} />

      {!applicationTrackingEnabled ? (
        <Empty>
          Application tracking is off. Enable it in{' '}
          <a
            href="/settings"
            class="font-medium text-accent-strong hover:text-accent-deep"
          >
            Settings
          </a>{' '}
          to see your funnel here.
        </Empty>
      ) : (
        <>
        <nav aria-label="Stages" class="mb-3 flex flex-wrap gap-1.5 md:hidden">
          {columns.map((s) => (
            <a
              href={`#stage-col-${s.key}`}
              class="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-line bg-surface-raised px-3 text-xs text-ink-muted"
            >
              {s.label}
              <span class="tabular-nums text-ink-faint">{count(s.key)}</span>
            </a>
          ))}
          {closedCount > 0 && (
            <a
              href="#closed"
              class="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-line bg-surface-raised px-3 text-xs text-ink-muted"
            >
              Closed <span class="tabular-nums text-ink-faint">{closedCount}</span>
            </a>
          )}
        </nav>
        <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-stretch md:overflow-x-auto md:pb-1">
          {columns.map((s) => {
            const items = byStage[s.key] ?? [];
            return (
              <section
                id={`stage-col-${s.key}`}
                data-drop-stage={s.key}
                class="flex w-full scroll-mt-4 flex-col rounded-lg border border-line/70 bg-surface-overlay/60 md:max-h-[70dvh] md:min-h-[320px] md:w-72 md:shrink-0"
                aria-labelledby={`stage-${s.key}`}
              >
                  <ColumnHeader
                    dot={dotClassFor(work, s.key)}
                    id={`stage-${s.key}`}
                    label={s.label}
                    count={items.length}
                  />
                  <ul class="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
                    {items.length === 0 ? (
                      <li class="hidden rounded-md border border-dashed border-line-strong/70 px-3 py-6 text-center text-xs text-ink-faint md:block">
                        No applications
                      </li>
                    ) : (
                      items.map((c) => <StageCard card={c} stage={s.key} work={work} />)
                    )}
                  </ul>
              </section>
            );
          })}
        </div>
        {closedCount > 0 && (
          <details id="closed" class="mt-4 scroll-mt-4 rounded-lg border border-line/70 bg-surface-overlay/40">
            <summary class="cursor-pointer select-none rounded-lg px-4 py-2.5 text-sm font-medium text-ink-muted transition-colors duration-150 hover:text-ink">
              Closed
              <span class="ml-2 text-xs font-normal text-ink-faint">
                {count('rejected')} rejected · {count('ghosted')} ghosted
              </span>
            </summary>
            <div class="grid gap-4 border-t border-line/70 p-4 md:grid-cols-2">
              {TERMINAL_STAGES.map((s) => {
                const items = byStage[s.key] ?? [];
                return (
                  <section data-drop-stage={s.key} aria-labelledby={`stage-${s.key}`}>
                    <div class="flex items-center gap-2 pb-2">
                      <span
                        class={`h-2 w-2 rounded-full ${dotClassFor(work, s.key)}`}
                        aria-hidden="true"
                      />
                      <h2 id={`stage-${s.key}`} class="text-[13px] font-medium text-ink">
                        {s.label}
                      </h2>
                      <span class="ml-auto text-xs text-ink-faint tabular-nums">
                        {items.length}
                      </span>
                    </div>
                    <ul class="space-y-2">
                      {items.length === 0 ? (
                        <li class="rounded-md border border-dashed border-line-strong/70 px-3 py-3 text-center text-xs text-ink-faint">
                          None
                        </li>
                      ) : (
                        items.map((c) => <StageCard card={c} stage={s.key} work={work} />)
                      )}
                    </ul>
                  </section>
                );
              })}
            </div>
          </details>
        )}
        <style dangerouslySetInnerHTML={{ __html: BOARD_CSS }} />
        <script type="module" dangerouslySetInnerHTML={{ __html: BOARD_BOOT }} />
        </>
      )}
    </Layout>
  );
};
