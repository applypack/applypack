/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';
import type { JobStatus } from '@prisma/client';
import { Layout } from '../layout';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  Disclosure,
  Empty,
  FilterChip,
  FitBadge,
  Input,
  MarkIcon,
  Notice,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  Tabs,
  Td,
  Tr,
  When,
} from '../ui';
import { formatDateShort, formatSalary, statusLabel } from '../format';
import { formatUsdPerYear } from '../../currency';
import type { WorkplaceCode } from '../../location';
import { placeLine } from '../place-line';
import { techLabel } from '../tech-label';
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
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

interface JobRow {
  id: number;
  title: string;
  url: string;
  location: string;
  /** ADR 0031: the structured reading of `location` — what the row's place line is written from. */
  countries: string[];
  regions: string[];
  workplace: WorkplaceCode;
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
  /** ADR 0056: who hires, when an aggregator named them; the row then says "via" the source. */
  employer: string | null;
  /** ADR 0016: `expired` once a whole board listing dropped it or a check found it gone (TASKS S13). */
  liveness: string | null;
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
  /** The places the running searches hunt in — a row names them before the rest. */
  searchPlaces: string[];
  /** True when the primary profile is blank — classification is idling (issue #50). */
  blankProfileBanner?: boolean;
  /** Stored postings of muted companies the list leaves out (ADR 0056); 0 when shown or none. */
  mutedHidden: number;
}

/** The tabs in order; '' is every status. Each is named when the page renders (`statusLabel`, `jobs.tab.all`). */
const STATUS_TABS: (JobStatus | '')[] = ['', 'NEW', 'ALERTED', 'APPLIED', 'SAVED', 'DISMISSED'];

/** The orders the list offers, each with the catalog key of its name. */
const SORT_OPTIONS: { value: string; label: MessageKey }[] = [
  { value: 'fetchedAt_desc', label: 'jobs.sort.fetched' },
  { value: 'fitScore_desc', label: 'jobs.sort.fit' },
  { value: 'postedAt_desc', label: 'jobs.sort.posted' },
  { value: 'title_asc', label: 'jobs.sort.title' },
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
  mutedHidden,
  searchPlaces,
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
    <Layout title={t('nav.jobs')} active="jobs" fill>
      <PageHeader
        title={t('nav.jobs')}
        meta={t('jobs.count', { n: total })}
        actions={
          <>
            <Button href="/jobs/import" variant="secondary">
              {t('jobs.importAFile')}
            </Button>
            <Button href="/jobs/new" variant="secondary">
              {t('jobs.pasteAJob')}
            </Button>
          </>
        }
      >
        {t('jobs.everyPostingTheSearchFound')}
      </PageHeader>

      {blankProfileBanner && (
        <Notice tone="warn" class="mb-4 shrink-0">
          {tRich('jobs.blankProfile', {}, {
            link: (words) => (
              <a href="/settings?tab=profile" class="font-medium underline">
                {words}
              </a>
            ),
          })}
        </Notice>
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
          <input type="hidden" name="muted" value={filters.muted} />
          <Input
            type="search"
            name="q"
            value={filters.q}
            placeholder={t('jobs.searchTitleDescriptionOrLocation')}
            aria-label={t('jobs.searchJobs')}
            class="sm:!w-56 xl:!w-72"
          />
          <Input
            type="number"
            name="minFit"
            min="0"
            max="100"
            value={filters.minFit}
            placeholder={t('jobs.minFitPlaceholder')}
            aria-label={t('jobs.minimumFitScore')}
            class="!w-20 sm:!w-24"
          />
          <Select name="sort" aria-label={t('jobs.sortBy')} class="!w-auto min-w-0 flex-1 sm:!w-44 sm:flex-none">
            {SORT_OPTIONS.map((o) => (
              <option value={o.value} selected={filters.sort === o.value}>
                {t(o.label)}
              </option>
            ))}
          </Select>
          <Button variant="secondary">{t('jobs.apply')}</Button>
        </form>

        {/* Apply sends the form; Filters are links that act at once — the rule keeps the two apart.
            From lg the row holds both; below it the button wraps and a rule would hang alone. */}
        <span class="mx-1 hidden h-5 w-px bg-line lg:block" aria-hidden="true" />
        {/* `contents`: the button shares the toolbar's row, the panel wraps below it. */}
        <Disclosure variant="button" summary={t('jobs.filters')} count={filterCount(filters)} open={panelOpen} class="contents">
          <div class="order-last grid basis-full gap-x-4 gap-y-3 rounded-lg border border-line bg-surface-raised p-4 shadow-sm sm:grid-cols-[5rem_minmax(0,1fr)]">
            {profiles.length > 1 && (
              <FilterRow name="search" label={t('jobs.filter.search')}>
                <OptionLink href={inPanel({ profile: null })} selected={filters.profile === null}>
                  {t('jobs.filter.allSearches')}
                </OptionLink>
                {profiles.map((p) => (
                  <OptionLink href={inPanel({ profile: p.id })} selected={filters.profile === p.id}>
                    <span translate="no">{p.name}</span>
                  </OptionLink>
                ))}
              </FilterRow>
            )}
            {facets.places.length > 0 && (
              <FilterRow name="where" label={t('jobs.filter.where')}>
                {places.shown.map((c) => (
                  <FacetLink href={inPanel({ country: toggled(filters.country, c.value) })} chip={c} />
                ))}
                {places.more.length > 0 && (
                  <details class="contents">
                    <summary class="inline-flex min-h-[28px] cursor-pointer list-none items-center rounded-md px-2 text-note text-ink-muted underline-offset-2 hover:text-ink hover:underline [&::-webkit-details-marker]:hidden">
                      {t('jobs.filter.more')}
                    </summary>
                    {places.more.map((c) => (
                      <FacetLink href={inPanel({ country: toggled(filters.country, c.value) })} chip={c} />
                    ))}
                  </details>
                )}
              </FilterRow>
            )}
            <FilterRow name="work" label={t('jobs.filter.work')}>
              {facets.workplaces.map((c) => (
                <FacetLink href={inPanel({ workplace: toggled(filters.workplace, c.value) })} chip={c} />
              ))}
            </FilterRow>
            <FilterRow name="posted" label={t('jobs.filter.posted')}>
              {facets.posted.map((c) => (
                <FacetLink href={inPanel({ posted: c.selected ? '' : c.value })} chip={c} />
              ))}
            </FilterRow>
            <FilterRow name="show" label={t('jobs.filter.show')}>
              <OptionLink
                href={inPanel({ verified: filters.verified ? '' : '1' })}
                selected={filters.verified.length > 0}
                title={t('jobs.filter.verifiedTitle')}
              >
                {t('jobs.filter.verified')}
              </OptionLink>
              <OptionLink
                href={inPanel({ watched: filters.watched ? '' : '1' })}
                selected={filters.watched.length > 0}
                title={t('jobs.filter.watchedTitle')}
              >
                {t('jobs.filter.watched')}
              </OptionLink>
              <OptionLink
                href={inPanel({ open: filters.open ? '' : '1' })}
                selected={filters.open.length > 0}
                title={t('jobs.filter.openToMeTitle')}
              >
                {t('jobs.filter.openToMe')}
              </OptionLink>
              <OptionLink
                href={inPanel({ muted: filters.muted ? '' : '1' })}
                selected={filters.muted.length > 0}
                title={t('jobs.filter.mutedTitle')}
              >
                {t('jobs.filter.muted')}
              </OptionLink>
            </FilterRow>
          </div>
        </Disclosure>
      </div>

      <Tabs
        label={t('jobs.jobStatus')}
        class="mb-3 shrink-0"
        tabs={STATUS_TABS.map((status) => ({
          href: jobsHref({ ...filters, status }),
          label: status === '' ? t('jobs.tab.all') : statusLabel(status),
          count: status === '' ? allStatuses : (statusCounts[status] ?? 0),
          current: filters.status === status,
        }))}
      />

      {active.length > 0 && (
        <div class="mb-3 flex shrink-0 flex-wrap items-center gap-1.5">
          {active.map((f) => (
            <FilterChip label={f.label} flag={f.flag} href={f.href} />
          ))}
          <a
            href={clearFiltersHref(filters)}
            class="ml-1 text-note text-ink-muted underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline"
          >
            {t('jobs.clearAll')}
          </a>
        </div>
      )}

      {mutedHidden > 0 && (
        <p data-ui="hint" class="mb-3 shrink-0 text-note text-ink-muted">
          {tRich('jobs.mutedHidden', { n: mutedHidden }, {
            show: (words) => (
              <a href={jobsHref({ ...filters, muted: '1' })} class="font-medium text-accent-strong hover:text-accent-deep">
                {words}
              </a>
            ),
            manage: (words) => (
              <a href="/companies#muted" class="font-medium text-accent-strong hover:text-accent-deep">
                {words}
              </a>
            ),
          })}
        </p>
      )}

      <div class="flex min-h-[320px] min-w-0 flex-1 flex-col">
        <Card flush class="flex min-h-0 flex-1 flex-col">
          {jobs.length === 0 ? (
            <div class="flex flex-1 items-center justify-center py-8">
              {hasFilters ? (
                <Empty
                  bare
                  title={t('jobs.noJobsMatchTheseFilters')}
                  action={
                    <Button href="/jobs" variant="secondary" size="sm">
                      {t('jobs.clearAllFilters')}
                    </Button>
                  }
                >
                  {t('jobs.theFiltersInForceHide')}
                </Empty>
              ) : (
                <Empty
                  bare
                  title={t('jobs.noJobsYet')}
                  action={
                    <ActionForm action="/runs/fetch-now" once>
                      <Button variant="secondary" size="sm">
                        {t('fetch.fetchNow')}
                      </Button>
                    </ActionForm>
                  }
                >
                  {t('jobs.theHourlySearchFillsThis')}
                </Empty>
              )}
            </div>
          ) : (
            <>
              <div class="min-h-0 flex-1 overflow-auto">
                {/* TASKS U7: a phone keeps the title and the fit; the rest joins as the screen widens. */}
                <div class="lg:min-w-[64rem]">
                  <Table caption={t('nav.jobs')}
                    stickyHeader
                    hideBelow={['', 'sm', 'md', '', 'lg', 'sm', 'md']}
                    widths={[
                      'w-[29%]',
                      'w-[15%]',
                      'w-[17%]',
                      'w-[8%]',
                      'w-[12%]',
                      'w-[11%]',
                      'w-[8%]',
                    ]}
                    columns={[
                      t('jobs.column.title'),
                      t('common.company'),
                      t('common.location'),
                      t('jobs.column.fit'),
                      <span class="block text-right">{t('jobs.column.salary')}</span>,
                      t('jobs.column.status'),
                      <span class="block text-right">{t('jobs.column.fetched')}</span>,
                    ]}
                  >
                    {jobs.map((j) => {
                      const place = placeLine(j, searchPlaces);
                      return (
                      <Tr>
                        <Td>
                          <a
                            href={`/jobs/${j.id}`}
                            class="block truncate font-medium text-ink transition-colors duration-150 hover:text-accent-strong"
                            title={j.title}
                            translate="no"
                          >
                            {j.title}
                          </a>
                          {j.liveness === 'expired' && (
                            <div class="text-meta text-warn" title={t('jobs.closedTitle')}>
                              {t('job.closed')}
                            </div>
                          )}
                          {j.techMatch.length > 0 && (
                            <div class="mt-0.5 truncate text-meta text-ink-faint" translate="no">
                              {j.techMatch.map(techLabel).join(' · ')}
                            </div>
                          )}
                        </Td>
                        <Td class="text-ink-muted">
                          <div class="truncate">
                            {j.company.watched && (
                              <span title={t('jobs.onYourWatchlist')} aria-label={t('job.watchedCompany')}>★ </span>
                            )}
                            {/* The company as the posting names it: data, whatever language the page is in. */}
                            <span title={j.employer ?? j.company.name} translate="no">
                              {j.employer ?? j.company.name}
                            </span>
                          </div>
                          {j.employer && j.company.atsType !== 'ADZUNA' && j.company.atsType !== 'FRANCETRAVAIL' && (
                            <div class="truncate text-meta text-ink-faint">
                              {tRich('job.via', {}, { source: () => <span translate="no">{j.company.name}</span> })}
                            </div>
                          )}
                          {j.company.atsType === 'ADZUNA' && <AdzunaLabel market={j.company.atsToken} class="mt-0.5" />}
                          {j.company.atsType === 'FRANCETRAVAIL' && <FranceTravailLine updatedAt={j.sourceUpdatedAt} class="mt-0.5" />}
                        </Td>
                        <Td class="text-ink-muted">
                          {/* The place in a few words — "Remote · USA, Canada +3" — never a row of flags; the tooltip has every country. */}
                          <div class="truncate" title={place.title} translate="no">
                            {place.text}
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
                          class="overflow-hidden whitespace-nowrap text-right text-note tabular-nums text-ink-muted"
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
                                {/* The verifier's own word (legit / suspicious / fake): what a model wrote, left as written. */}
                                <span lang="en">{j.verifications[0].verdict}</span>
                              </Badge>
                            </div>
                          )}
                        </Td>
                        <Td
                          class="whitespace-nowrap text-right text-note text-ink-faint"
                          title={formatDateShort(j.fetchedAt)}
                        >
                          <When at={j.fetchedAt} />
                        </Td>
                      </Tr>
                      );
                    })}
                  </Table>
                </div>
              </div>
              <nav
                aria-label={t('jobs.pagination')}
                class="flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 py-2.5"
              >
                <span class="text-note text-ink-faint tabular-nums">
                  {/* A phone keeps the numbers and drops the word before them. */}
                  {tRich('jobs.showing', { from, to, total }, { wide: (words) => <span class="hidden sm:inline">{words}</span> })}
                </span>
                <div class="flex items-center gap-2">
                  <span class="hidden text-note text-ink-faint tabular-nums md:inline">
                    {t('jobs.pageOf', { page, pages: totalPages })}
                  </span>
                  <PageLink href={jobsHref(filters, { page: page - 1 })} disabled={page <= 1}>
                    {t('jobs.prev')}
                  </PageLink>
                  <PageLink href={jobsHref(filters, { page: page + 1 })} disabled={page >= totalPages}>
                    {t('jobs.next')}
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

/**
 * One line of the filter panel: what it narrows by, then the options — a group
 * named by its visible label. The label step in muted ink, as a table header
 * names its column; centred on a 28 px option's height so the baselines meet.
 */
const FilterRow: FC<PropsWithChildren<{ name: string; label: string }>> = ({ name, label, children }) => {
  // The id is the row's own name, not its words: a label is translated, an id is not.
  const id = `filter-${name}`;
  return (
    <>
      <div id={id} class="flex min-h-[28px] items-center text-label text-ink-muted">
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
    class={`inline-flex min-h-[28px] items-center gap-1.5 rounded-md px-2 py-0.5 text-note transition-colors duration-150 ${
      selected
        ? 'bg-surface-selected font-medium text-accent-strong'
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
      class="inline-flex min-h-[28px] items-center rounded-md border border-line px-2.5 py-1 text-note text-ink-faint opacity-60"
      aria-disabled="true"
    >
      {children}
    </span>
  ) : (
    <a
      href={href}
      class="inline-flex min-h-[28px] items-center rounded-md border border-line-strong bg-surface-raised px-2.5 py-1 text-note font-medium text-ink shadow-sm transition-colors duration-150 hover:bg-surface-overlay"
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
