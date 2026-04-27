/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { AtsType } from '@prisma/client';
import { Layout } from '../layout';
import { Card, Empty, Tag } from '../ui';
import { formatRelative } from '../format';

interface CompanyRow {
  id: number;
  name: string;
  atsType: AtsType;
  atsToken: string;
  active: boolean;
  careerUrl: string | null;
  jobsTotal: number;
  alertedTotal: number;
  lastFetchedAt: Date | null;
}

export interface CompaniesProps {
  companies: CompanyRow[];
}

export const CompaniesPage: FC<CompaniesProps> = ({ companies }) => (
  <Layout title="Companies" active="companies">
    <div class="mb-6 flex items-baseline justify-between">
      <h1 class="text-2xl font-semibold tracking-tight">Companies</h1>
      <span class="text-sm text-zinc-500 tabular-nums">
        {companies.length} sources
      </span>
    </div>

    <p class="mb-4 text-xs text-zinc-500">
      Add new companies in <code class="rounded bg-zinc-900 px-1">src/seed.ts</code>{' '}
      and rerun <code class="rounded bg-zinc-900 px-1">npm run seed</code>.
    </p>

    {companies.length === 0 ? (
      <Empty>No companies seeded yet.</Empty>
    ) : (
      <Card class="!p-0 overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th class="px-4 py-2.5 font-medium">Name</th>
              <th class="px-4 py-2.5 font-medium">Source</th>
              <th class="px-4 py-2.5 font-medium">Token</th>
              <th class="px-4 py-2.5 font-medium">Jobs</th>
              <th class="px-4 py-2.5 font-medium">Alerted</th>
              <th class="px-4 py-2.5 font-medium">Last fetch</th>
              <th class="px-4 py-2.5 font-medium">Active</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-900">
            {companies.map((c) => (
              <tr class="hover:bg-zinc-900/50">
                <td class="px-4 py-2.5 font-medium text-zinc-100">
                  {c.careerUrl ? (
                    <a
                      href={c.careerUrl}
                      target="_blank"
                      rel="noopener"
                      class="hover:text-emerald-400"
                    >
                      {c.name}
                    </a>
                  ) : (
                    c.name
                  )}
                </td>
                <td class="px-4 py-2.5">
                  <Tag>{c.atsType.replace('_', ' ')}</Tag>
                </td>
                <td class="px-4 py-2.5 font-mono text-xs text-zinc-400">
                  {c.atsToken}
                </td>
                <td class="px-4 py-2.5 tabular-nums text-zinc-300">
                  {c.jobsTotal}
                </td>
                <td class="px-4 py-2.5 tabular-nums text-emerald-400">
                  {c.alertedTotal}
                </td>
                <td class="px-4 py-2.5 text-xs text-zinc-500">
                  {formatRelative(c.lastFetchedAt)}
                </td>
                <td class="px-4 py-2.5">
                  <form method="post" action={`/companies/${c.id}/toggle-active`}>
                    <button
                      type="submit"
                      class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                        c.active
                          ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30 hover:bg-emerald-500/25'
                          : 'bg-zinc-700/30 text-zinc-400 ring-zinc-700/50 hover:bg-zinc-700/50'
                      }`}
                    >
                      {c.active ? 'Active' : 'Disabled'}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    )}
  </Layout>
);
