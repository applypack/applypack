/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { JobStatus } from '@prisma/client';
import { Layout } from '../layout';
import {
  Badge,
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
import { formatUsdPerYear } from '../../currency';
import { flagOf } from '../../countries';
import { splitPlaces, toggled, type FacetChip, type FacetChips } from '../job-facets';
import { AdzunaLabel, FranceTravailLine } from './attribution';
import { VERDICT_TONE } from './verification-card';

interface JobRow {
  id: number;
  title: string;
  url: string;
  location: string;
  /** ADR 0031: the structured reading of `location`; flags decorate the row. */
  countries: string[];
  fitScore: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  sourceUpdatedAt: Date | null;
  status: JobStatus;
  fetchedAt: Date;
  postedAt: Date;
  techMatch: string[];
  company: { name: string; atsType: string; atsToken: string };
  verifications: { verdict: string }[];
  /** Present only when one search is selected: that search's own verdict. */
  scores?: { fitScore: number }[];
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
    verified: string;
    /** ADR 0033: "1" = only rows a search of mine can take. */
    open: string;
    /** Which search the list is narrowed to; null = all of them. */
    profile: number | null;
    /** ADR 0031 facets: place values (codes or "unknown"), workplace values, posted window. */
    country: string[];
    workplace: string[];
    posted: string;
  };
  /** Chips with counts for the three facets (ADR 0031). */
  facets: FacetChips;
  /** Every running search — one chip each (ADR 0028). */
  profiles: { id: number; name: string }[];
  /** True when the primary profile is blank — classification is idling (issue #50). */
  blankProfileBanner?: boolean;
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
  profiles,
  facets,
  total,
  page,
  pageSize,
  filters,
  blankProfileBanner,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const pageHref = (p: number) => buildQuery({ ...filters, page: p });
  const hasFilters =
    filters.q.length > 0 ||
    filters.status.length > 0 ||
    filters.minFit.length > 0 ||
    filters.verified.length > 0 ||
    filters.country.length > 0 ||
    filters.workplace.length > 0 ||
    filters.posted.length > 0;
  const places = splitPlaces(facets.places);

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

      {blankProfileBanner && (
        <div class="mb-4 shrink-0 rounded-md border border-warn/25 bg-warn/5 px-3.5 py-2.5 text-[13px] leading-5 text-warn">
          Every running search is empty — classification idle. New jobs are fetched but
          not scored or alerted until one lists a required stack or role types.{' '}
          <a href="/settings?tab=profile" class="font-medium underline">
            Fix the search
          </a>
          .
        </div>
      )}

      {profiles.length > 1 && (
        <nav
          aria-label="Filter by search"
          class="mb-3 flex shrink-0 flex-wrap items-center gap-1"
        >
          <span class="mr-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
            Search
          </span>
          {[{ id: null as number | null, name: 'All' }, ...profiles].map((p) => {
            const on = filters.profile === p.id;
            return (
              <a
                href={buildQuery({ ...filters, profile: p.id ?? '', page: 1 })}
                aria-current={on ? 'true' : undefined}
                class={`rounded-full border px-3 py-1 text-[13px] transition-colors duration-150 ${
                  on
                    ? 'border-accent/40 bg-accent/10 font-medium text-accent-strong'
                    : 'border-line text-ink-muted hover:bg-surface-overlay/70 hover:text-ink'
                }`}
              >
                {p.name}
              </a>
            );
          })}
        </nav>
      )}

      {facets.places.length > 0 && (
      <nav aria-label="Filter by place" class="mb-2 flex shrink-0 flex-wrap items-center gap-1">
        <span class="mr-1 text-xs font-medium uppercase tracking-wide text-ink-faint">Where</span>
        {places.shown.map((c) => (
          <FacetLink
            href={buildQuery({ ...filters, country: toggled(filters.country, c.value), page: 1 })}
            chip={c}
          />
        ))}
        {places.more.length > 0 && (
          <details class="contents">
            <summary class="cursor-pointer rounded-full border border-transparent px-2.5 py-1 text-[13px] text-ink-faint hover:text-ink [&::-webkit-details-marker]:hidden">
              More…
            </summary>
            {places.more.map((c) => (
              <FacetLink
                href={buildQuery({ ...filters, country: toggled(filters.country, c.value), page: 1 })}
                chip={c}
              />
            ))}
          </details>
        )}
      </nav>
      )}

      <div class="mb-4 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <nav aria-label="Filter by workplace" class="flex flex-wrap items-center gap-1">
          <span class="mr-1 text-xs font-medium uppercase tracking-wide text-ink-faint">Work</span>
          {facets.workplaces.map((c) => (
            <FacetLink
              href={buildQuery({ ...filters, workplace: toggled(filters.workplace, c.value), page: 1 })}
              chip={c}
            />
          ))}
        </nav>
        <nav aria-label="Filter by posting date" class="flex flex-wrap items-center gap-1">
          <span class="mr-1 text-xs font-medium uppercase tracking-wide text-ink-faint">Posted</span>
          {facets.posted.map((c) => (
            <FacetLink
              href={buildQuery({ ...filters, posted: c.selected ? '' : c.value, page: 1 })}
              chip={c}
            />
          ))}
        </nav>
      </div>

      <div class="mb-4 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <nav aria-label="Job filters" class="flex flex-wrap items-center gap-1">
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
          <span class="mx-1 h-4 w-px bg-line" aria-hidden="true" />
          <a
            href={buildQuery({ ...filters, verified: filters.verified ? '' : '1' })}
            aria-current={filters.verified ? 'true' : undefined}
            title="Only jobs with an “Is this job real?” verdict"
            class={`rounded-md border px-2.5 py-1 text-[13px] transition-colors duration-150 ${
              filters.verified
                ? 'border-line-strong bg-surface-overlay font-medium text-ink'
                : 'border-transparent text-ink-muted hover:bg-surface-overlay/70 hover:text-ink'
            }`}
          >
            Verified
          </a>
          <a
            href={buildQuery({ ...filters, open: filters.open ? '' : '1', page: 1 })}
            aria-current={filters.open ? 'true' : undefined}
            title="Only roles a search of yours can take from where you live"
            class={`rounded-md border px-2.5 py-1 text-[13px] transition-colors duration-150 ${
              filters.open
                ? 'border-line-strong bg-surface-overlay font-medium text-ink'
                : 'border-transparent text-ink-muted hover:bg-surface-overlay/70 hover:text-ink'
            }`}
          >
            Open to me
          </a>
        </nav>

        <form method="get" action="/jobs" class="ml-auto flex flex-wrap items-center gap-2">
          <input type="hidden" name="status" value={filters.status} />
          <input type="hidden" name="verified" value={filters.verified} />
          <input type="hidden" name="profile" value={filters.profile ?? ''} />
          <input type="hidden" name="country" value={filters.country.join(',')} />
          <input type="hidden" name="workplace" value={filters.workplace.join(',')} />
          <input type="hidden" name="posted" value={filters.posted} />
          <input type="hidden" name="open" value={filters.open} />
          <Input
            type="search"
            name="q"
            value={filters.q}
            placeholder="Search title, description or location…"
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
                          {j.company.atsType === 'ADZUNA' && <AdzunaLabel market={j.company.atsToken} class="mt-0.5" />}
                          {j.company.atsType === 'FRANCETRAVAIL' && <FranceTravailLine updatedAt={j.sourceUpdatedAt} class="mt-0.5" />}
                        </Td>
                        <Td class="text-ink-muted">
                          <div class="truncate" title={j.location || 'Remote'}>
                            {j.countries.length > 0 && (
                              <span class="mr-1" aria-hidden="true">
                                {j.countries.map(flagOf).join('')}
                              </span>
                            )}
                            {j.location || 'Remote'}
                          </div>
                        </Td>
                        <Td class="whitespace-nowrap">
                          <FitBadge
                            score={
                              filters.profile ? (j.scores?.[0]?.fitScore ?? null) : j.fitScore
                            }
                          />
                        </Td>
                        <Td
                          class="overflow-hidden whitespace-nowrap text-right text-[13px] tabular-nums text-ink-muted"
                          title={salaryTitle(j)}
                        >
                          {formatSalary(j.salaryMin, j.salaryMax, j.salaryCurrency, j.salaryPeriod)}
                        </Td>
                        <Td class="whitespace-nowrap">
                          <StatusBadge status={j.status} />
                          {j.verifications[0] && (
                            <div class="mt-1">
                              <Badge
                                tone={VERDICT_TONE[j.verifications[0].verdict] ?? 'neutral'}
                              >
                                {j.verifications[0].verdict}
                              </Badge>
                            </div>
                          )}
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

/** One facet chip: a link that toggles its value; the count reads without colour. */
const FacetLink: FC<{ href: string; chip: FacetChip }> = ({ href, chip }) => (
  <a
    href={href}
    aria-current={chip.selected ? 'true' : undefined}
    class={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] transition-colors duration-150 ${
      chip.selected
        ? 'border-accent/40 bg-accent/10 font-medium text-accent-strong'
        : 'border-line text-ink-muted hover:bg-surface-overlay/70 hover:text-ink'
    }`}
  >
    {chip.flag && <span aria-hidden="true">{chip.flag}</span>}
    {chip.label}
    <span class="tabular-nums text-ink-faint">{chip.count}</span>
  </a>
);

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

/** The cell shows the posting's own money; the tooltip adds the USD a year it compares to. */
function salaryTitle(j: { salaryMin: number | null; salaryMax: number | null; salaryCurrency: string | null; salaryPeriod: string | null }): string {
  const own = formatSalary(j.salaryMin, j.salaryMax, j.salaryCurrency, j.salaryPeriod);
  const usd = formatUsdPerYear(j.salaryMin, j.salaryMax, j.salaryCurrency, j.salaryPeriod);
  return usd ? `${own} (${usd})` : own;
}

function buildQuery(params: Record<string, string | number | string[] | null>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null) continue;
    const s = Array.isArray(v) ? v.join(',') : String(v);
    if (s.length === 0) continue;
    if (k === 'page' && s === '1') continue;
    usp.set(k, s);
  }
  const qs = usp.toString();
  return qs ? `/jobs?${qs}` : '/jobs';
}
