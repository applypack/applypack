/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { AtsType } from '@prisma/client';
import { Layout } from '../layout';
import { Card, Empty, SectionTitle, Tag } from '../ui';
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
  flash?: { kind: 'ok' | 'err'; text: string } | null;
}

const PROBEABLE_ATS: AtsType[] = [
  AtsType.GREENHOUSE,
  AtsType.LEVER,
  AtsType.ASHBY,
  AtsType.WORKABLE,
  AtsType.SMARTRECRUITERS,
];

export const CompaniesPage: FC<CompaniesProps> = ({ companies, flash }) => (
  <Layout title="Companies" active="companies">
    <div class="mb-6 flex items-baseline justify-between">
      <h1 class="text-2xl font-semibold tracking-tight">Companies</h1>
      <span class="text-sm text-zinc-500 tabular-nums">
        {companies.length} sources
      </span>
    </div>

    {flash && (
      <div
        class={`mb-4 rounded-md px-4 py-2 text-sm ring-1 ring-inset ${
          flash.kind === 'ok'
            ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
            : 'bg-rose-500/10 text-rose-300 ring-rose-500/30'
        }`}
      >
        {flash.text}
      </div>
    )}

    <Card class="mb-6">
      <SectionTitle>Add company</SectionTitle>
      <p class="mb-3 text-xs text-zinc-500">
        We'll probe the public ATS endpoint for the chosen type and refuse to
        save if the token is invalid. Aggregator feeds (RemoteOK, Remotive,
        Arbeitnow, LaraJobs, HN) don't have per-company tokens — those are
        seeded once via <code class="rounded bg-zinc-900 px-1">src/seed.ts</code>.
      </p>
      <form method="post" action="/companies/new" class="grid gap-3 sm:grid-cols-12">
        <div class="sm:col-span-3">
          <label class="block text-xs uppercase tracking-wider text-zinc-500">
            Name
          </label>
          <input
            type="text"
            name="name"
            required
            placeholder="Honeycomb.io"
            class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div class="sm:col-span-2">
          <label class="block text-xs uppercase tracking-wider text-zinc-500">
            ATS
          </label>
          <select
            name="atsType"
            class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
          >
            {PROBEABLE_ATS.map((t) => (
              <option value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div class="sm:col-span-3">
          <label class="block text-xs uppercase tracking-wider text-zinc-500">
            ATS token / slug
          </label>
          <input
            type="text"
            name="atsToken"
            required
            placeholder="honeycombio"
            class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div class="sm:col-span-3">
          <label class="block text-xs uppercase tracking-wider text-zinc-500">
            Career URL (optional)
          </label>
          <input
            type="url"
            name="careerUrl"
            placeholder="https://acme.com/careers"
            class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div class="flex items-end sm:col-span-1">
          <button
            type="submit"
            class="w-full rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Add
          </button>
        </div>
      </form>
    </Card>

    {companies.length === 0 ? (
      <Empty>No companies yet. Add one above.</Empty>
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
              <th class="px-4 py-2.5 font-medium text-right">Actions</th>
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
                <td class="px-4 py-2.5">
                  <form
                    method="post"
                    action={`/companies/${c.id}/delete`}
                    onsubmit={`return confirm('Delete \"${c.name}\" and all its ${c.jobsTotal} jobs?');`}
                    class="flex justify-end"
                  >
                    <button
                      type="submit"
                      class="rounded-md border border-rose-900 bg-rose-950/50 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-900/50"
                    >
                      Delete
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
