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

/** Column accent: a 2px top border keeps the funnel readable without tinting whole columns. */
const STAGE_ACCENT: Record<Stage, string> = {
  applied: 'border-t-info',
  screen: 'border-t-violet',
  tech: 'border-t-warn',
  onsite: 'border-t-warn',
  offer: 'border-t-ok',
  rejected: 'border-t-line-strong',
  ghosted: 'border-t-line',
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
}) => (
  <Layout title="Applications" active="applications">
    <PageHeader
      title="Applications"
      meta={
        applicationTrackingEnabled
          ? 'Move jobs between stages from their detail page'
          : 'Tracking disabled — enable in Settings'
      }
    />

    {!applicationTrackingEnabled ? (
      <Empty>
        Application tracking is off. Enable it in{' '}
        <a href="/settings" class="text-accent hover:underline">
          Settings
        </a>{' '}
        to see your funnel here.
      </Empty>
    ) : (
      <div class="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
        {STAGES.map((stage) => {
          const items = byStage[stage] ?? [];
          return (
            <section
              class={`rounded-lg border border-line border-t-2 bg-surface-raised p-3 ${STAGE_ACCENT[stage]}`}
              aria-labelledby={`stage-${stage}`}
            >
              <div class="mb-2 flex items-baseline justify-between">
                <h2
                  id={`stage-${stage}`}
                  class="text-xs font-semibold uppercase tracking-wider text-ink-muted"
                >
                  {STAGE_LABEL[stage]}
                </h2>
                <span class="font-mono text-xs text-ink-faint tabular-nums">{items.length}</span>
              </div>
              <ul class="space-y-2">
                {items.length === 0 ? (
                  <li class="py-2 text-center text-xs text-ink-faint">—</li>
                ) : (
                  items.map((c) => (
                    <li>
                      <a
                        href={`/jobs/${c.id}`}
                        class="block rounded-md border border-line bg-surface p-2.5 transition-colors duration-150 hover:border-accent/50"
                      >
                        <div class="flex items-start justify-between gap-2">
                          <span class="line-clamp-2 text-sm font-medium text-ink">{c.title}</span>
                          <FitBadge score={c.fitScore} />
                        </div>
                        <div class="mt-1 truncate text-xs text-ink-muted">{c.companyName}</div>
                        <div class="mt-0.5 text-xs text-ink-faint">
                          {c.appliedAt ? `applied ${formatRelative(c.appliedAt)}` : 'no apply date'}
                          {c.recruiterContact ? ` · ${c.recruiterContact}` : ''}
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
