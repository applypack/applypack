/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Empty, FitBadge, Flash, PageHeader } from '../ui';
import type { FlashMessage } from '../flash';
import type { StageTimeLine } from '../stage-time';
import { FunnelStatsSection, type FunnelStatsProps } from './funnel-stats';

const STAGES = ['applied', 'screen', 'tech', 'onsite', 'offer', 'rejected', 'ghosted'] as const;
type Stage = (typeof STAGES)[number];

/** Work columns on the board; rejected/ghosted are archives, shown below. */
const BOARD_STAGES = ['applied', 'screen', 'tech', 'onsite', 'offer'] as const;
const CLOSED_STAGES = ['rejected', 'ghosted'] as const;

export const STAGE_LABEL: Record<Stage, string> = {
  applied: 'Applied',
  screen: 'Screen',
  tech: 'Tech',
  onsite: 'Onsite',
  offer: 'Offer',
  rejected: 'Rejected',
  ghosted: 'Ghosted',
};

/** Quick-move preselect: the likely next hop, not just the next list entry. */
const NEXT_STAGE: Record<Stage, Stage> = {
  applied: 'screen',
  screen: 'tech',
  tech: 'onsite',
  onsite: 'offer',
  offer: 'rejected',
  rejected: 'screen',
  ghosted: 'screen',
};

/**
 * Column accent: a dot next to the stage name, so columns stay untinted.
 * Onsite is a hollow warn ring — same interview-loop hue as tech, but a
 * different shape, so the two stages never read identical.
 */
const STAGE_DOT: Record<Stage, string> = {
  applied: 'bg-info',
  screen: 'bg-violet',
  tech: 'bg-warn',
  onsite: 'border-2 border-warn bg-transparent',
  offer: 'bg-ok',
  rejected: 'bg-line-strong',
  ghosted: 'bg-line-strong',
};

interface ApplicationCard {
  id: number;
  title: string;
  companyName: string;
  fitScore: number | null;
  recruiterContact: string | null;
  stageLine: StageTimeLine | null;
}

export interface ApplicationsProps {
  byStage: Record<Stage, ApplicationCard[]>;
  applicationTrackingEnabled: boolean;
  stats: FunnelStatsProps | null;
  flash?: FlashMessage | null;
}

/** One board card: the link navigates, the form below it quick-moves. */
const StageCard: FC<{ card: ApplicationCard; stage: Stage }> = ({ card, stage }) => (
  <li class="rounded-md border border-line bg-surface-raised shadow-sm">
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
      class="flex items-center gap-1.5 border-t border-line px-2 py-1.5"
    >
      <label class="sr-only" for={`move-${card.id}`}>
        Move {card.title} to stage
      </label>
      <select
        id={`move-${card.id}`}
        name="toStage"
        class="h-8 w-full min-w-0 flex-1 rounded-md border border-line-strong bg-surface-raised px-1.5 text-xs text-ink shadow-sm transition-colors duration-150 hover:border-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
      >
        {STAGES.filter((s) => s !== stage).map((s) => (
          <option value={s} selected={s === NEXT_STAGE[stage]}>
            {STAGE_LABEL[s]}
          </option>
        ))}
      </select>
      <Button size="sm" variant="secondary" aria-label={`Move ${card.title}`}>
        Move
      </Button>
    </form>
  </li>
);

export const ApplicationsPage: FC<ApplicationsProps> = ({
  byStage,
  applicationTrackingEnabled,
  stats,
  flash,
}) => {
  const activeCount = BOARD_STAGES.reduce((sum, s) => sum + (byStage[s]?.length ?? 0), 0);
  const closedCount = CLOSED_STAGES.reduce((sum, s) => sum + (byStage[s]?.length ?? 0), 0);

  return (
    <Layout title="Applications" active="applications">
      <PageHeader
        title="Applications"
        meta={
          applicationTrackingEnabled
            ? `${activeCount} active${closedCount > 0 ? ` · ${closedCount} closed` : ''}`
            : undefined
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
          {BOARD_STAGES.map((stage) => (
            <a
              href={`#stage-col-${stage}`}
              class="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-line bg-surface-raised px-3 text-xs text-ink-muted"
            >
              {STAGE_LABEL[stage]}
              <span class="tabular-nums text-ink-faint">{byStage[stage].length}</span>
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
          {BOARD_STAGES.map((stage) => {
            const items = byStage[stage] ?? [];
            return (
              <section
                id={`stage-col-${stage}`}
                class="flex w-full scroll-mt-4 flex-col rounded-lg border border-line/70 bg-surface-overlay/60 md:max-h-[70dvh] md:min-h-[320px] md:w-72 md:shrink-0"
                aria-labelledby={`stage-${stage}`}
              >
                  <div class="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
                    <span
                      class={`h-2 w-2 rounded-full ${STAGE_DOT[stage]}`}
                      aria-hidden="true"
                    />
                    <h2 id={`stage-${stage}`} class="text-[13px] font-medium text-ink">
                      {STAGE_LABEL[stage]}
                    </h2>
                    <span class="ml-auto text-xs text-ink-faint tabular-nums">
                      {items.length}
                    </span>
                  </div>
                  <ul class="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
                    {items.length === 0 ? (
                      <li class="hidden rounded-md border border-dashed border-line-strong/70 px-3 py-6 text-center text-xs text-ink-faint md:block">
                        No applications
                      </li>
                    ) : (
                      items.map((c) => <StageCard card={c} stage={stage} />)
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
                {byStage.rejected.length} rejected · {byStage.ghosted.length} ghosted
              </span>
            </summary>
            <div class="grid gap-4 border-t border-line/70 p-4 md:grid-cols-2">
              {CLOSED_STAGES.map((stage) => {
                const items = byStage[stage] ?? [];
                return (
                  <section aria-labelledby={`stage-${stage}`}>
                    <div class="flex items-center gap-2 pb-2">
                      <span
                        class={`h-2 w-2 rounded-full ${STAGE_DOT[stage]}`}
                        aria-hidden="true"
                      />
                      <h2 id={`stage-${stage}`} class="text-[13px] font-medium text-ink">
                        {STAGE_LABEL[stage]}
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
                        items.map((c) => <StageCard card={c} stage={stage} />)
                      )}
                    </ul>
                  </section>
                );
              })}
            </div>
          </details>
        )}
        {stats && <FunnelStatsSection {...stats} />}
        </>
      )}
    </Layout>
  );
};
