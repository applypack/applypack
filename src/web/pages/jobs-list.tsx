/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { JobStatus } from '@prisma/client';
import { Layout } from '../layout';
import {
  Button,
  Card,
  Empty,
  Field,
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
  const pageHref = (p: number) => buildQuery({ ...filters, page: p });

  return (
    <Layout title="Jobs" active="jobs">
      <PageHeader
        title="Jobs"
        meta={`${total.toLocaleString()} total · page ${page}/${totalPages}`}
      />

      <form method="get" action="/jobs" class="mb-5 grid gap-3 sm:grid-cols-12">
        <Field label="Search" class="sm:col-span-4">
          <Input type="search" name="q" value={filters.q} placeholder="title or description…" />
        </Field>
        <Field label="Status" class="sm:col-span-3">
          <Select name="status">
            {STATUS_OPTIONS.map((o) => (
              <option value={o.value} selected={filters.status === o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Min fit" class="sm:col-span-2">
          <Input type="number" name="minFit" min="0" max="100" value={filters.minFit} />
        </Field>
        <Field label="Sort" class="sm:col-span-2">
          <Select name="sort">
            {SORT_OPTIONS.map((o) => (
              <option value={o.value} selected={filters.sort === o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <div class="flex items-end sm:col-span-1">
          <Button class="w-full">Apply</Button>
        </div>
      </form>

      {jobs.length === 0 ? (
        <Empty>No jobs match these filters.</Empty>
      ) : (
        <Card flush>
          <Table columns={['Title', 'Company', 'Location', 'Fit', 'Salary', 'Status', 'Fetched']}>
            {jobs.map((j) => (
              <Tr>
                <Td class="min-w-[16rem]">
                  <a href={`/jobs/${j.id}`} class="font-medium text-ink hover:text-accent">
                    {j.title}
                  </a>
                  {j.techMatch.length > 0 && (
                    <div class="mt-0.5 truncate font-mono text-xs text-ink-faint">
                      {j.techMatch.join(', ')}
                    </div>
                  )}
                </Td>
                <Td class="text-ink-muted">{j.company.name}</Td>
                <Td class="text-ink-muted">
                  <div class="max-w-[12rem] truncate" title={j.location}>
                    {j.location || 'Remote'}
                  </div>
                </Td>
                <Td>
                  <FitBadge score={j.fitScore} />
                </Td>
                <Td class="whitespace-nowrap font-mono tabular-nums text-ink-muted">
                  {formatSalary(j.salaryMin, j.salaryMax)}
                </Td>
                <Td>
                  <StatusBadge status={j.status} />
                </Td>
                <Td class="whitespace-nowrap text-xs text-ink-faint" title={formatDateShort(j.fetchedAt)}>
                  {formatRelative(j.fetchedAt)}
                </Td>
              </Tr>
            ))}
          </Table>
        </Card>
      )}

      <nav aria-label="Pagination" class="mt-5 flex items-center justify-between text-sm">
        <PageLink href={pageHref(page - 1)} disabled={page <= 1}>
          ← Prev
        </PageLink>
        <span class="font-mono text-xs text-ink-faint tabular-nums">
          {page} / {totalPages}
        </span>
        <PageLink href={pageHref(page + 1)} disabled={page >= totalPages}>
          Next →
        </PageLink>
      </nav>
    </Layout>
  );
};

const PageLink: FC<{ href: string; disabled: boolean; children: string }> = ({
  href,
  disabled,
  children,
}) =>
  disabled ? (
    <span class="rounded-md border border-line px-3 py-1.5 text-ink-faint" aria-disabled="true">
      {children}
    </span>
  ) : (
    <a
      href={href}
      class="rounded-md border border-line-strong px-3 py-1.5 text-ink transition-colors duration-150 hover:bg-surface-overlay"
    >
      {children}
    </a>
  );

function buildQuery(params: Record<string, string | number>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const s = String(v);
    if (s.length > 0) usp.set(k, s);
  }
  const qs = usp.toString();
  return qs ? `/jobs?${qs}` : '/jobs';
}
