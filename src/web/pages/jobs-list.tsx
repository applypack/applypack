/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { JobStatus } from '@prisma/client';
import { Layout } from '../layout';
import { Card, Empty, FitBadge, StatusBadge } from '../ui';
import {
  formatDateShort,
  formatRelative,
  formatSalary,
} from '../format';

interface JobRow {
  id: number;
  title: string;
  url: string;
  location: string;
  fitScore: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  status: JobStatus;
  fetchedAt: Date;
  postedAt: Date;
  techMatch: string[];
  company: { name: string };
}

export interface JobsListProps {
  jobs: JobRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: {
    status: string;
    minFit: string;
    q: string;
    sort: string;
  };
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'NEW', label: 'New' },
  { value: 'ALERTED', label: 'Alerted' },
  { value: 'APPLIED', label: 'Applied' },
  { value: 'SAVED', label: 'Saved' },
  { value: 'DISMISSED', label: 'Dismissed' },
];

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'fetchedAt_desc', label: 'Recently fetched' },
  { value: 'fitScore_desc', label: 'Highest fit' },
  { value: 'postedAt_desc', label: 'Recently posted' },
  { value: 'title_asc', label: 'Title A-Z' },
];

export const JobsListPage: FC<JobsListProps> = ({
  jobs,
  total,
  page,
  pageSize,
  filters,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const buildHref = (overrides: Record<string, string | number>) =>
    buildQuery({ ...filters, page, ...overrides });

  return (
    <Layout title="Jobs" active="jobs">
      <div class="mb-6 flex items-baseline justify-between">
        <h1 class="text-2xl font-semibold tracking-tight">Jobs</h1>
        <span class="text-sm text-zinc-500 tabular-nums">
          {total.toLocaleString()} total · page {page}/{totalPages}
        </span>
      </div>

      <form method="get" action="/jobs" class="mb-5 grid gap-3 sm:grid-cols-12">
        <div class="sm:col-span-4">
          <label class="block text-xs uppercase tracking-wider text-zinc-500">
            Search
          </label>
          <input
            type="text"
            name="q"
            value={filters.q}
            placeholder="title or description..."
            class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div class="sm:col-span-3">
          <label class="block text-xs uppercase tracking-wider text-zinc-500">
            Status
          </label>
          <select
            name="status"
            class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
          >
            {STATUS_OPTIONS.map((o) => (
              <option value={o.value} selected={filters.status === o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div class="sm:col-span-2">
          <label class="block text-xs uppercase tracking-wider text-zinc-500">
            Min fit
          </label>
          <input
            type="number"
            name="minFit"
            min="0"
            max="100"
            value={filters.minFit}
            class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div class="sm:col-span-2">
          <label class="block text-xs uppercase tracking-wider text-zinc-500">
            Sort
          </label>
          <select
            name="sort"
            class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option value={o.value} selected={filters.sort === o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div class="flex items-end sm:col-span-1">
          <button
            type="submit"
            class="w-full rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Apply
          </button>
        </div>
      </form>

      {jobs.length === 0 ? (
        <Empty>No jobs match these filters.</Empty>
      ) : (
        <Card class="!p-0 overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th class="px-4 py-2.5 font-medium">Title</th>
                <th class="px-4 py-2.5 font-medium">Company</th>
                <th class="px-4 py-2.5 font-medium">Location</th>
                <th class="px-4 py-2.5 font-medium">Fit</th>
                <th class="px-4 py-2.5 font-medium">Salary</th>
                <th class="px-4 py-2.5 font-medium">Status</th>
                <th class="px-4 py-2.5 font-medium">Fetched</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-900">
              {jobs.map((j) => (
                <tr class="hover:bg-zinc-900/50">
                  <td class="px-4 py-2.5">
                    <a
                      href={`/jobs/${j.id}`}
                      class="font-medium text-zinc-100 hover:text-emerald-400"
                    >
                      {j.title}
                    </a>
                    {j.techMatch.length > 0 && (
                      <div class="mt-0.5 truncate text-xs text-zinc-500">
                        {j.techMatch.join(', ')}
                      </div>
                    )}
                  </td>
                  <td class="px-4 py-2.5 text-zinc-300">{j.company.name}</td>
                  <td class="px-4 py-2.5 text-zinc-400">
                    {j.location || 'Remote'}
                  </td>
                  <td class="px-4 py-2.5">
                    <FitBadge score={j.fitScore} />
                  </td>
                  <td class="px-4 py-2.5 text-zinc-300 tabular-nums">
                    {formatSalary(j.salaryMin, j.salaryMax)}
                  </td>
                  <td class="px-4 py-2.5">
                    <StatusBadge status={j.status} />
                  </td>
                  <td
                    class="px-4 py-2.5 text-xs text-zinc-500"
                    title={formatDateShort(j.fetchedAt)}
                  >
                    {formatRelative(j.fetchedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div class="mt-5 flex items-center justify-between text-sm">
        <a
          href={buildHref({ page: Math.max(1, page - 1) })}
          class={`rounded-md border border-zinc-800 px-3 py-1.5 ${
            page <= 1
              ? 'pointer-events-none text-zinc-600'
              : 'text-zinc-200 hover:bg-zinc-900'
          }`}
          aria-disabled={page <= 1}
        >
          ← Prev
        </a>
        <span class="text-zinc-500">
          Page {page} of {totalPages}
        </span>
        <a
          href={buildHref({ page: Math.min(totalPages, page + 1) })}
          class={`rounded-md border border-zinc-800 px-3 py-1.5 ${
            page >= totalPages
              ? 'pointer-events-none text-zinc-600'
              : 'text-zinc-200 hover:bg-zinc-900'
          }`}
          aria-disabled={page >= totalPages}
        >
          Next →
        </a>
      </div>
    </Layout>
  );
};

function buildQuery(params: Record<string, string | number>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const s = String(v);
    if (s.length > 0) usp.set(k, s);
  }
  const qs = usp.toString();
  return qs ? `/jobs?${qs}` : '/jobs';
}
