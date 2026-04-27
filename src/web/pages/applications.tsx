/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Card, Empty, FitBadge, SectionTitle } from '../ui';
import { formatRelative } from '../format';

const STAGES = [
  'applied',
  'screen',
  'tech',
  'onsite',
  'offer',
  'rejected',
  'ghosted',
] as const;

const STAGE_LABEL: Record<(typeof STAGES)[number], string> = {
  applied: 'Applied',
  screen: 'Screen',
  tech: 'Tech',
  onsite: 'Onsite',
  offer: 'Offer',
  rejected: 'Rejected',
  ghosted: 'Ghosted',
};

const STAGE_TONE: Record<(typeof STAGES)[number], string> = {
  applied: 'border-sky-700 bg-sky-950/30',
  screen: 'border-violet-700 bg-violet-950/30',
  tech: 'border-amber-700 bg-amber-950/30',
  onsite: 'border-orange-700 bg-orange-950/30',
  offer: 'border-emerald-700 bg-emerald-950/30',
  rejected: 'border-zinc-700 bg-zinc-900/50',
  ghosted: 'border-zinc-800 bg-zinc-950/40',
};

interface Card {
  id: number;
  title: string;
  companyName: string;
  fitScore: number | null;
  appliedAt: Date | null;
  recruiterContact: string | null;
}

export interface ApplicationsProps {
  byStage: Record<(typeof STAGES)[number], Card[]>;
  applicationTrackingEnabled: boolean;
}

export const ApplicationsPage: FC<ApplicationsProps> = ({
  byStage,
  applicationTrackingEnabled,
}) => (
  <Layout title="Applications" active="applications">
    <div class="mb-6 flex items-baseline justify-between">
      <h1 class="text-2xl font-semibold tracking-tight">Applications</h1>
      <span class="text-xs text-zinc-500">
        {applicationTrackingEnabled
          ? 'Manage your funnel from /jobs/:id detail page'
          : 'Tracking disabled — enable in /settings'}
      </span>
    </div>

    {!applicationTrackingEnabled && (
      <Empty>
        Application tracking is currently disabled. Enable it in /settings to start
        funneling jobs through stages.
      </Empty>
    )}

    {applicationTrackingEnabled && (
      <div class="grid gap-3 lg:grid-cols-7">
        {STAGES.map((stage) => {
          const items = byStage[stage] ?? [];
          return (
            <div class={`rounded-lg border p-3 ${STAGE_TONE[stage]}`}>
              <div class="mb-2 flex items-baseline justify-between">
                <h3 class="text-sm font-medium uppercase tracking-wider text-zinc-200">
                  {STAGE_LABEL[stage]}
                </h3>
                <span class="text-xs text-zinc-500 tabular-nums">{items.length}</span>
              </div>
              <ul class="space-y-2">
                {items.length === 0 ? (
                  <li class="text-xs text-zinc-600">—</li>
                ) : (
                  items.map((c) => (
                    <li>
                      <a
                        href={`/jobs/${c.id}`}
                        class="block rounded border border-zinc-800 bg-zinc-950/50 p-2 hover:border-emerald-600/40 hover:bg-zinc-900"
                      >
                        <div class="flex items-start justify-between gap-2">
                          <span class="line-clamp-2 text-sm font-medium text-zinc-100">
                            {c.title}
                          </span>
                          <FitBadge score={c.fitScore} />
                        </div>
                        <div class="mt-1 truncate text-xs text-zinc-500">
                          {c.companyName}
                        </div>
                        <div class="mt-0.5 text-xs text-zinc-600">
                          {c.appliedAt
                            ? `applied ${formatRelative(c.appliedAt)}`
                            : '(no apply date)'}
                          {c.recruiterContact ? ` · ${c.recruiterContact}` : ''}
                        </div>
                      </a>
                    </li>
                  ))
                )}
              </ul>
            </div>
          );
        })}
      </div>
    )}
  </Layout>
);
