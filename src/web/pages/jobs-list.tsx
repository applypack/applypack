/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { JobStatus } from '@prisma/client';
import { Layout } from '../layout';
import {
  Button,
  Card,
  FitBadge,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  Td,
  Tr,
} from '../ui';
import { formatDateShort, formatRelative, formatSalary } from '../format';

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
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const pageHref = (p: number) => buildQuery({ ...filters, page: p });
  const hasFilters =
    filters.q.length > 0 || filters.status.length > 0 || filters.minFit.length > 0;

  return (
    <Layout title="Jobs" active="jobs" fill>
      <PageHeader
        title="Jobs"
        meta={`${total.toLocaleString()} jobs`}
        actions={
          <Button href="/jobs/new" variant="secondary" size="sm">
            + Paste a job
          </Button>
        }
      />

      <div class="mb-4 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <nav aria-label="Status filter" class="flex flex-wrap items-center gap-1">
          {STATUS_OPTIONS.map((o) => {
            const active = filters.status === o.value;
            return (
              <a
                href={buildQuery({ ...filters, status: o.value })}
                aria-current={active ? 'true' : undefined}
                class={`rounded-md border px-2.5 py-1 text-[13px] transition-colors duration-150 ${
                  active
                    ? 'border-line-strong bg-surface-overlay font-medium text-ink'
                    : 'border-transparent text-ink-muted hover:bg-surface-overlay/70 hover:text-ink'
                }`}
              >
                {o.label}
              </a>
            );
          })}
        </nav>

        <form method="get" action="/jobs" class="ml-auto flex flex-wrap items-center gap-2">
          <input type="hidden" name="status" value={filters.status} />
          <Input
            type="search"
            name="q"
            value={filters.q}
            placeholder="Search title or description…"
            aria-label="Search jobs"
            class="!w-56"
          />
          <Input
            type="number"
            name="minFit"
            min="0"
            max="100"
            value={filters.minFit}
            placeholder="Fit ≥"
            aria-label="Minimum fit score"
            class="!w-24"
          />
          <Select name="sort" aria-label="Sort by" class="!w-44">
            {SORT_OPTIONS.map((o) => (
              <option value={o.value} selected={filters.sort === o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Button variant="secondary">Apply</Button>
        </form>
      </div>

      <div class="flex min-h-[320px] min-w-0 flex-1 flex-col">
        <Card flush class="flex min-h-0 flex-1 flex-col">
          {jobs.length === 0 ? (
            <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <div class="text-sm font-medium text-ink">No jobs match these filters</div>
              <p class="text-[13px] text-ink-faint">
                {hasFilters ? (
                  <>
                    Try widening the search, or{' '}
                    <a
                      href="/jobs"
                      class="font-medium text-accent-strong hover:text-accent-deep"
                    >
                      clear all filters
                    </a>
                    .
                  </>
                ) : (
                  'Nothing fetched yet — check Job sources in Settings.'
                )}
              </p>
            </div>
          ) : (
            <>
              <div class="min-h-0 flex-1 overflow-auto">
                <div class="min-w-[64rem]">
                  <Table
                    stickyHeader
                    widths={[
                      'w-[31%]',
                      'w-[15%]',
                      'w-[15%]',
                      'w-[8%]',
                      'w-[12%]',
                      'w-[11%]',
                      'w-[8%]',
                    ]}
                    columns={[
                      'Title',
                      'Company',
                      'Location',
                      'Fit',
                      <span class="block text-right">Salary</span>,
                      'Status',
                      <span class="block text-right">Fetched</span>,
                    ]}
                  >
                    {jobs.map((j) => (
                      <Tr>
                        <Td>
                          <a
                            href={`/jobs/${j.id}`}
                            class="block truncate font-medium text-ink transition-colors duration-150 hover:text-accent-strong"
                            title={j.title}
                          >
                            {j.title}
                          </a>
                          {j.techMatch.length > 0 && (
                            <div class="mt-0.5 truncate text-xs text-ink-faint">
                              {j.techMatch.join(' · ')}
                            </div>
                          )}
                        </Td>
                        <Td class="text-ink-muted">
                          <div class="truncate" title={j.company.name}>
                            {j.company.name}
                          </div>
                        </Td>
                        <Td class="text-ink-muted">
                          <div class="truncate" title={j.location || 'Remote'}>
                            {j.location || 'Remote'}
                          </div>
                        </Td>
                        <Td class="whitespace-nowrap">
                          <FitBadge score={j.fitScore} />
                        </Td>
                        <Td
                          class="overflow-hidden whitespace-nowrap text-right text-[13px] tabular-nums text-ink-muted"
                          title={formatSalary(j.salaryMin, j.salaryMax)}
                        >
                          {formatSalary(j.salaryMin, j.salaryMax)}
                        </Td>
                        <Td class="whitespace-nowrap">
                          <StatusBadge status={j.status} />
                        </Td>
                        <Td
                          class="whitespace-nowrap text-right text-[13px] text-ink-faint"
                          title={formatDateShort(j.fetchedAt)}
                        >
                          {formatRelative(j.fetchedAt)}
                        </Td>
                      </Tr>
                    ))}
                  </Table>
                </div>
              </div>
              <nav
                aria-label="Pagination"
                class="flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 py-2.5"
              >
                <span class="text-[13px] text-ink-faint tabular-nums">
                  <span class="hidden sm:inline">Showing </span>
                  {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
                </span>
                <div class="flex items-center gap-2">
                  <span class="hidden text-[13px] text-ink-faint tabular-nums md:inline">
                    Page {page} of {totalPages}
                  </span>
                  <PageLink href={pageHref(page - 1)} disabled={page <= 1}>
                    ← Prev
                  </PageLink>
                  <PageLink href={pageHref(page + 1)} disabled={page >= totalPages}>
                    Next →
                  </PageLink>
                </div>
              </nav>
            </>
          )}
        </Card>
      </div>
    </Layout>
  );
};

const PageLink: FC<{ href: string; disabled: boolean; children: string }> = ({
  href,
  disabled,
  children,
}) =>
  disabled ? (
    <span
      class="inline-flex min-h-[28px] items-center rounded-md border border-line px-2.5 py-1 text-[13px] text-ink-faint opacity-60"
      aria-disabled="true"
    >
      {children}
    </span>
  ) : (
    <a
      href={href}
      class="inline-flex min-h-[28px] items-center rounded-md border border-line-strong bg-surface-raised px-2.5 py-1 text-[13px] font-medium text-ink shadow-sm transition-colors duration-150 hover:bg-surface-overlay"
    >
      {children}
    </a>
  );

function buildQuery(params: Record<string, string | number>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const s = String(v);
    if (s.length === 0) continue;
    if (k === 'page' && s === '1') continue;
    usp.set(k, s);
  }
  const qs = usp.toString();
  return qs ? `/jobs?${qs}` : '/jobs';
}
