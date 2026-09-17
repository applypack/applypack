/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';
import type { JobStatus } from '@prisma/client';
import { Layout } from '../layout';
import {
  Badge,
  Button,
  Card,
  Disclosure,
  FilterChip,
  FitBadge,
  Input,
  MarkIcon,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  Tabs,
  Td,
  Tr,
} from '../ui';
import { formatDateShort, formatRelative, formatSalary } from '../format';
import { formatUsdPerYear } from '../../currency';
import { flagOf } from '../../countries';
import {
  activeFilters,
  clearFiltersHref,
  filterCount,
  jobsHref,
  splitPlaces,
  toggled,
  type FacetChip,
  type FacetChips,
  type JobsFilters,
} from '../job-facets';
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
  company: { name: string; atsType: string; atsToken: string; watched: boolean };
  verifications: { verdict: string }[];
  /** Present only when one search is selected: that search's own verdict. */
  scores?: { fitScore: number }[];
}

export interface JobsListProps {
  jobs: JobRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: JobsFilters;
  /** The filter panel renders open: the request came from a link inside it. */
  panelOpen: boolean;
  /** Jobs per status under every other filter in force — what each tab would show. */
  statusCounts: Partial<Record<JobStatus, number>>;
  /** Chips with counts for the three facets (ADR 0031). */
  facets: FacetChips;
  /** Every running search — one chip each (ADR 0028). */
  profiles: { id: number; name: string }[];
  /** True when the primary profile is blank — classification is idling (issue #50). */
  blankProfileBanner?: boolean;
}

const STATUS_TABS: { value: JobStatus | ''; label: string }[] = [
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
  panelOpen,
  statusCounts,
  blankProfileBanner,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const active = activeFilters(filters, profiles);
  const hasFilters = active.length > 0 || filters.q.length > 0 || filters.status.length > 0 || filters.minFit.length > 0;
  const places = splitPlaces(facets.places);
  // A link inside the panel keeps it open on the page it loads.
  const inPanel = (next: Partial<JobsFilters>) => jobsHref({ ...filters, ...next }, { panel: true });
  const allStatuses = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);

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

      <div class="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <form method="get" action="/jobs" class="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <input type="hidden" name="status" value={filters.status} />
          <input type="hidden" name="verified" value={filters.verified} />
          <input type="hidden" name="profile" value={filters.profile ?? ''} />
          <input type="hidden" name="country" value={filters.country.join(',')} />
          <input type="hidden" name="workplace" value={filters.workplace.join(',')} />
          <input type="hidden" name="posted" value={filters.posted} />
          <input type="hidden" name="open" value={filters.open} />
          <input type="hidden" name="watched" value={filters.watched} />
          <Input
            type="search"
            name="q"
            value={filters.q}
            placeholder="Search title, description or location…"
            aria-label="Search jobs"
            class="sm:!w-72"
          />
          <Input
            type="number"
            name="minFit"
            min="0"
            max="100"
            value={filters.minFit}
            placeholder="Fit ≥"
            aria-label="Minimum fit score"
            class="!w-20 sm:!w-24"
          />
          <Select name="sort" aria-label="Sort by" class="!w-auto min-w-0 flex-1 sm:!w-44 sm:flex-none">
            {SORT_OPTIONS.map((o) => (
              <option value={o.value} selected={filters.sort === o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Button variant="secondary">Apply</Button>
        </form>

        {/* Apply sends the form; Filters are links that act at once — the rule keeps the two apart. */}
        <span class="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden="true" />
        {/* `contents`: the button shares the toolbar's row, the panel wraps below it. */}
        <Disclosure variant="button" summary="Filters" count={filterCount(filters)} open={panelOpen} class="contents">
          <div class="order-last grid basis-full gap-x-4 gap-y-3 rounded-lg border border-line bg-surface-raised p-4 shadow-sm sm:grid-cols-[5rem_minmax(0,1fr)]">
            {profiles.length > 1 && (
              <FilterRow label="Search">
                {[{ id: null as number | null, name: 'All' }, ...profiles].map((p) => (
                  <OptionLink href={inPanel({ profile: p.id })} selected={filters.profile === p.id}>
                    {p.name}
                  </OptionLink>
                ))}
              </FilterRow>
            )}
            {facets.places.length > 0 && (
              <FilterRow label="Where">
                {places.shown.map((c) => (
                  <FacetLink href={inPanel({ country: toggled(filters.country, c.value) })} chip={c} />
                ))}
                {places.more.length > 0 && (
                  <details class="contents">
                    <summary class="inline-flex min-h-[28px] cursor-pointer list-none items-center rounded-md px-2 text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline [&::-webkit-details-marker]:hidden">
                      More…
                    </summary>
                    {places.more.map((c) => (
                      <FacetLink href={inPanel({ country: toggled(filters.country, c.value) })} chip={c} />
                    ))}
                  </details>
                )}
              </FilterRow>
            )}
            <FilterRow label="Work">
              {facets.workplaces.map((c) => (
                <FacetLink href={inPanel({ workplace: toggled(filters.workplace, c.value) })} chip={c} />
              ))}
            </FilterRow>
            <FilterRow label="Posted">
              {facets.posted.map((c) => (
                <FacetLink href={inPanel({ posted: c.selected ? '' : c.value })} chip={c} />
              ))}
            </FilterRow>
            <FilterRow label="Show">
              <OptionLink
                href={inPanel({ verified: filters.verified ? '' : '1' })}
                selected={filters.verified.length > 0}
                title="Only jobs with an “Is this job real?” verdict"
              >
                Verified
              </OptionLink>
              <OptionLink
                href={inPanel({ watched: filters.watched ? '' : '1' })}
                selected={filters.watched.length > 0}
                title="Only postings from companies on your watchlist"
              >
                ★ Watched
              </OptionLink>
              <OptionLink
                href={inPanel({ open: filters.open ? '' : '1' })}
                selected={filters.open.length > 0}
                title="Only roles a search of yours can take from where you live"
              >
                Open to me
              </OptionLink>
            </FilterRow>
          </div>
        </Disclosure>
      </div>

      <Tabs
        label="Job status"
        class="mb-3 shrink-0"
        tabs={STATUS_TABS.map((t) => ({
          href: jobsHref({ ...filters, status: t.value }),
          label: t.label,
          count: t.value === '' ? allStatuses : (statusCounts[t.value] ?? 0),
          current: filters.status === t.value,
        }))}
      />

      {active.length > 0 && (
        <div class="mb-3 flex shrink-0 flex-wrap items-center gap-1.5">
          {active.map((f) => (
            <FilterChip label={f.label} flag={f.flag} href={f.href} />
          ))}
          <a
            href={clearFiltersHref(filters)}
            class="ml-1 text-[13px] text-ink-muted underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline"
          >
            Clear all
          </a>
        </div>
      )}

      <div class="flex min-h-[320px] min-w-0 flex-1 flex-col">
        <Card flush class="flex min-h-0 flex-1 flex-col">
          {jobs.length === 0 ? (
            <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <div class="text-sm font-medium text-ink">No jobs match these filters</div>
              <p data-ui="hint" class="text-[13px] text-ink-faint">
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
                  <Table caption="Jobs"
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
                            {j.company.watched && (
                              <span title="On your watchlist" aria-label="Watched company">★ </span>
                            )}
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
                  <PageLink href={jobsHref(filters, { page: page - 1 })} disabled={page <= 1}>
                    ← Prev
                  </PageLink>
                  <PageLink href={jobsHref(filters, { page: page + 1 })} disabled={page >= totalPages}>
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

/** One line of the filter panel: what it narrows by, then the options — a group named by its visible label. */
const FilterRow: FC<PropsWithChildren<{ label: string }>> = ({ label, children }) => {
  const id = `filter-${label.toLowerCase()}`;
  return (
    <>
      <div id={id} class="pt-1 text-[13px] font-medium text-ink-muted">
        {label}
      </div>
      <div role="group" aria-labelledby={id} class="flex flex-wrap items-center gap-1.5">
        {children}
      </div>
    </>
  );
};

/**
 * An option of the filter panel: a link that toggles its value. Square and on
 * the subtle surface, so it reads as neither a status pill nor a tab; a chosen
 * one is tinted, heavier and carries a drawn check — never colour alone.
 */
const OptionLink: FC<PropsWithChildren<{ href: string; selected: boolean; title?: string }>> = ({
  href,
  selected,
  title,
  children,
}) => (
  <a
    href={href}
    title={title}
    aria-current={selected ? 'true' : undefined}
    class={`inline-flex min-h-[28px] items-center gap-1.5 rounded-md px-2 py-0.5 text-[13px] transition-colors duration-150 ${
      selected
        ? 'bg-accent/10 font-medium text-accent-strong'
        : 'bg-surface-overlay text-ink-muted hover:text-ink'
    }`}
  >
    {selected && <MarkIcon kind="check" class="!h-3 !w-3" />}
    {children}
  </a>
);

/** A facet's option: flag, label, and the count that reads without colour. */
const FacetLink: FC<{ href: string; chip: FacetChip }> = ({ href, chip }) => (
  <OptionLink href={href} selected={chip.selected}>
    {chip.flag && <span aria-hidden="true">{chip.flag}</span>}
    {chip.label}
    <span class={`tabular-nums font-normal ${chip.selected ? '' : 'text-ink-faint'}`}>{chip.count}</span>
  </OptionLink>
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
