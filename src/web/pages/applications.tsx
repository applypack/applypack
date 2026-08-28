/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Empty, FitBadge, PageHeader } from '../ui';
import { formatRelative } from '../format';

const STAGES = ['applied', 'screen', 'tech', 'onsite', 'offer', 'rejected', 'ghosted'] as const;
type Stage = (typeof STAGES)[number];

const STAGE_LABEL: Record<Stage, string> = {
  applied: 'Applied',
  screen: 'Screen',
  tech: 'Tech',
  onsite: 'Onsite',
  offer: 'Offer',
  rejected: 'Rejected',
  ghosted: 'Ghosted',
};

/** Column accent: a dot next to the stage name, so columns stay untinted. */
const STAGE_DOT: Record<Stage, string> = {
  applied: 'bg-info',
  screen: 'bg-violet',
  tech: 'bg-warn',
  onsite: 'bg-warn',
  offer: 'bg-ok',
  rejected: 'bg-line-strong',
  ghosted: 'bg-line-strong',
};

interface ApplicationCard {
  id: number;
  title: string;
  companyName: string;
  fitScore: number | null;
  appliedAt: Date | null;
  recruiterContact: string | null;
}

export interface ApplicationsProps {
  byStage: Record<Stage, ApplicationCard[]>;
  applicationTrackingEnabled: boolean;
}

export const ApplicationsPage: FC<ApplicationsProps> = ({
  byStage,
  applicationTrackingEnabled,
}) => {
  const totalCount = STAGES.reduce((sum, s) => sum + (byStage[s]?.length ?? 0), 0);

  return (
    <Layout title="Applications" active="applications" fill={applicationTrackingEnabled}>
      <PageHeader
        title="Applications"
        meta={applicationTrackingEnabled ? `${totalCount} in the funnel` : undefined}
      >
        {applicationTrackingEnabled
          ? 'Move jobs between stages from their detail page.'
          : undefined}
      </PageHeader>

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
        <div class="flex min-h-0 min-w-0 flex-1 items-stretch gap-3 overflow-x-auto pb-1">
          {STAGES.map((stage) => {
            const items = byStage[stage] ?? [];
            return (
              <section
                class="flex min-h-[320px] w-72 shrink-0 flex-col rounded-lg border border-line/70 bg-surface-overlay/60"
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
                      <li class="rounded-md border border-dashed border-line-strong/70 px-3 py-6 text-center text-xs text-ink-faint">
                        No applications
                      </li>
                    ) : (
                      items.map((c) => (
                        <li>
                          <a
                            href={`/jobs/${c.id}`}
                            class="block rounded-md border border-line bg-surface-raised p-3 shadow-sm transition-colors duration-150 hover:border-accent/50"
                          >
                            <div class="line-clamp-2 text-sm font-medium leading-snug text-ink">
                              {c.title}
                            </div>
                            <div class="mt-1 truncate text-[13px] text-ink-muted">
                              {c.companyName}
                            </div>
                            <div class="mt-2 flex items-center justify-between gap-2">
                              <span class="min-w-0 truncate text-xs text-ink-faint">
                                {c.appliedAt
                                  ? `applied ${formatRelative(c.appliedAt)}`
                                  : 'no apply date'}
                                {c.recruiterContact ? ` · ${c.recruiterContact}` : ''}
                              </span>
                              <FitBadge score={c.fitScore} />
                            </div>
                          </a>
                        </li>
                      ))
                    )}
                  </ul>
              </section>
            );
          })}
        </div>
      )}
    </Layout>
  );
};
