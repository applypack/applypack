/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { AtsType } from '@prisma/client';
import { Layout } from '../layout';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  Code,
  ConfirmAction,
  Disclosure,
  Empty,
  Field,
  Flash,
  Hint,
  Input,
  More,
  PageHeader,
  SectionTitle,
  Select,
  Table,
  Tag,
  Td,
  Tr,
  When,
} from '../ui';
import { formatRelative, safeHref } from '../format';
import { sourceFamily } from '../source-groups';
import { sourceLabel } from '../source-names';
import { companyDeleteConfirm, type CompanyDeleteImpact } from '../delete-confirm';
import {
  QUIET_STREAK,
  SILENT_DAYS,
  describeStatus,
  type HealthTone,
  type QuietReason,
} from '../../fetchers/source-health';
import type { FlashMessage } from '../flash';
import { healthLabel, healthStreak } from '../health-label';
import { StarterPackPicker, type PackSegmentChoice } from './starter-pack';
import type { SourceSuggestion } from '../../starter-packs/suggest';
import { AddCompaniesCard, WatchlistSection, type WatchedRow } from './watchlist';
import { MutedCompaniesSection, type MutedRow } from './muted-companies';
import type { PackOffer } from '../pack-offers';
import type { WatchlistRun } from '../watchlist-runs';
import { t } from '../../i18n/t';
import { tRich } from '../rich';
import { AddFolderCard, FolderSourcesSection, type FolderHost, type FolderSourceRow } from './folder-source';

interface CompanyRow {
  id: number;
  name: string;
  atsType: AtsType;
  atsToken: string;
  active: boolean;
  careerUrl: string | null;
  jobsTotal: number;
  /** What Delete would cascade — jobs, and the work recorded against them. */
  deleteImpact: CompanyDeleteImpact;
  alertedTotal: number;
  lastFetchedAt: Date | null;
  lastFetchStatus: string | null;
  consecutiveFailures: number;
  lastOkAt: Date | null;
  quiet: QuietReason | null;
}

export interface CompaniesProps {
  companies: CompanyRow[];
  /** §17: the companies the user chose by hand, shown apart from the rest. */
  watchlist: WatchedRow[];
  /** A resolve run in flight, so the add card links to it instead of offering a second one. */
  watchlistRun: WatchlistRun | null;
  packs: PackSegmentChoice[];
  /** Token-driven sources the running searches' countries call for (plan §4.3). */
  suggestions: SourceSuggestion[];
  /** Keyed sources whose credential is in place — the only ones the form offers (ADR 0034). */
  keyedUnlocked: string[];
  /** TASKS S26: the starter packs that fit the running searches, as the wizard offers them. */
  fitPacks: PackOffer[];
  flash?: FlashMessage | null;
  fetchingEnabled: boolean;
  /** ADR 0056: the companies the user does not want to see. */
  muted: MutedRow[];
  /** ADR 0062: the folders among the sources, and where one may be on this install. */
  folders: FolderSourceRow[];
  folderHost: FolderHost;
}

const DOT_TONE: Record<HealthTone, string> = {
  good: 'bg-ok',
  idle: 'bg-ink-faint',
  bad: 'bg-danger',
  warn: 'bg-warn',
  none: 'bg-line',
};

/** Status dot + label, the per-row half of ADR 0019. */
const HealthDot: FC<{ status: string | null; streak: number; atsType: string }> = ({ status, streak, atsType }) => {
  const { tone } = describeStatus(status, atsType);
  const label = healthLabel(status, atsType);
  return (
    <span
      class="inline-flex items-center gap-2 whitespace-nowrap"
      title={streak > 0 ? t('sources.health.withStreak', { label, n: streak }) : label}
    >
      <span class={`h-2 w-2 shrink-0 rounded-full ${DOT_TONE[tone]}`} aria-hidden="true" />
      <span class="text-note text-ink-muted">{label}</span>
      {/* The label is already text, so the dot is decorative and the streak is the
          only part a screen reader would otherwise miss. */}
      {streak > 0 && <span class="sr-only">{t('sources.health.streakAfterLabel', { n: streak })}</span>}
    </span>
  );
};

const QuietSources: FC<{ companies: CompanyRow[]; fetchingEnabled: boolean }> = ({
  companies,
  fetchingEnabled,
}) => {
  const quiet = companies.filter((c) => c.quiet !== null);
  if (quiet.length === 0) return null;
  return (
    <Card class="mb-4">
      <SectionTitle>
        {t('companies.quiet.title')} <Badge tone="warn">{quiet.length}</Badge>
      </SectionTitle>
      <Hint class="mb-4">
        {tRich('companies.quiet.hint', { streak: QUIET_STREAK, days: SILENT_DAYS }, { em: (words) => <em>{words}</em> })}
        {!fetchingEnabled && (
          <>
            {' '}
            {tRich('companies.quiet.paused', {}, { strong: (words) => <strong class="font-medium text-ink">{words}</strong> })}
          </>
        )}
      </Hint>
      <div class="flex flex-col gap-2">
        {quiet.map((c) => (
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised px-4 py-3">
            <div class="min-w-0">
              <div class="truncate font-medium text-ink" translate="no">
                {c.name}
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-2 text-note text-ink-muted">
                <span translate="no">
                  <Tag>{c.atsType.replace('_', ' ')}</Tag>
                </span>
                <span translate="no">
                  <Code>{c.atsToken}</Code>
                </span>
                <Badge tone={c.quiet === 'failing' ? 'danger' : 'warn'}>
                  {c.quiet === 'failing' ? t('companies.failing') : t('companies.silent')}
                </Badge>
                <span>
                  {c.quiet === 'failing'
                    ? healthStreak(c.lastFetchStatus, c.atsType, c.consecutiveFailures)
                    : c.lastOkAt
                      ? t('companies.quiet.lastPosting', { when: formatRelative(c.lastOkAt) })
                      : t('companies.noPostingSinceWeStarted')}
                </span>
              </div>
            </div>
            {c.atsType === AtsType.FOLDER ? (
              // A folder has no board to probe: its files say what went wrong.
              <Button href={`/companies/${c.id}/files`} size="sm" variant="secondary">
                {t('companies.files')}
              </Button>
            ) : (
              <ActionForm action={`/companies/${c.id}/reprobe`}>
                <Button size="sm" variant="secondary">
                  {t('companies.reProbe')}
                </Button>
              </ActionForm>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};

const PROBEABLE_ATS: AtsType[] = [
  AtsType.GREENHOUSE,
  AtsType.LEVER,
  AtsType.ASHBY,
  AtsType.WORKABLE,
  AtsType.SMARTRECRUITERS,
  AtsType.RECRUITEE,
  AtsType.BREEZY,
  AtsType.BAMBOOHR,
  AtsType.PINPOINT,
  AtsType.RIPPLING,
  AtsType.PERSONIO,
  AtsType.TEAMTAILOR,
  AtsType.DOU,
  AtsType.DJINNI,
  AtsType.JOBTECH,
  AtsType.ADZUNA,
  AtsType.FRANCETRAVAIL,
  AtsType.FEED,
  AtsType.CAREER_PAGE,
];

/** Every cross-company feed, read off the enum so the list cannot fall behind it (MANUAL is not a source), in the Sources grid's order. */
const AGGREGATOR_LABELS = Object.values(AtsType)
  .filter((ats) => ats !== AtsType.MANUAL && sourceFamily(ats) === 'aggregator')
  .map(sourceLabel)
  .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

/** Sources that need the user's own vendor account (ADR 0034) — hidden until it exists. */
const KEYED_ATS: string[] = [AtsType.ADZUNA, AtsType.FRANCETRAVAIL];

/**
 * "Enable sources for your countries" (plan §4.3): DOU and Djinni rows for a
 * search that names Ukraine, the Arbeitnow rows for Germany or the UK, built
 * from each search's stack. Added off, like a pack; the row's own toggle
 * switches it on. Nothing to show when no running search names such a place.
 */
const SuggestedSources: FC<{ suggestions: SourceSuggestion[]; packs: PackOffer[] }> = ({ suggestions, packs }) => {
  if (suggestions.length === 0 && packs.length === 0) return null;
  const waiting = suggestions.filter((s) => s.state !== 'on').length;
  return (
    <Card>
      {suggestions.length > 0 && (
        <>
          <Hint class="mb-3">
            {t('companies.feedsThatFitWhereYour')}
          </Hint>
          {waiting > 1 && (
            <ActionForm action="/companies/suggested/all" class="mb-3" once>
              <Button size="sm">{t('companies.enableAllN', { n: waiting })}</Button>
            </ActionForm>
          )}
          <ul class="divide-y divide-line">
            {suggestions.map((s) => (
              <li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                <div class="min-w-0">
                  <div class="text-label text-ink" translate="no">
                    {s.name}
                  </div>
                  <div class="truncate text-meta text-ink-faint">
                    {s.reason} ·{' '}
                    <span translate="no">
                      <Code>{s.atsToken}</Code>
                    </span>
                  </div>
                </div>
                {s.state === 'missing' && (
                  <form method="post" action="/companies/suggested">
                    <input type="hidden" name="atsType" value={s.atsType} />
                    <input type="hidden" name="atsToken" value={s.atsToken} />
                    <Button size="sm" variant="secondary">{t('companies.addOff')}</Button>
                  </form>
                )}
                {s.state === 'off' && s.companyId !== null && (
                  <form method="post" action={`/companies/${s.companyId}/toggle-active`}>
                    <Button size="sm">{t('ui.enable')}</Button>
                  </form>
                )}
                {s.state === 'on' && <Badge tone="ok">{t('companies.on')}</Badge>}
              </li>
            ))}
          </ul>
        </>
      )}
      {packs.length > 0 && (
        <div class={suggestions.length > 0 ? 'mt-4 border-t border-line pt-4' : ''}>
          <div class="text-label text-ink">{t('companies.companyPacksForYourSearches')}</div>
          <Hint class="mt-0.5">
            {t('companies.boardsPickedAndCheckedBy')}
          </Hint>
          <form method="post" action="/companies/starter-pack" class="mt-2">
            {packs.map((p) => (
              <input type="hidden" name="segment" value={p.id} />
            ))}
            <ul class="mb-3 space-y-1 text-sm">
              {packs.map((p) => (
                <li>
                  {/* The pack's name is the catalog's own (starter-packs/catalog.json), in English. */}
                  <span class="font-medium text-ink" lang="en">
                    {p.label}
                  </span>{' '}
                  <span class="text-ink-faint">· {t('packs.notHereYet', { missing: p.count - p.tracked, total: p.count })}</span>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="secondary">
              {t('companies.previewPacks', { n: packs.length })}
            </Button>
          </form>
        </div>
      )}
    </Card>
  );
};

export const CompaniesPage: FC<CompaniesProps> = ({
  companies,
  watchlist,
  watchlistRun,
  packs,
  suggestions,
  keyedUnlocked,
  fitPacks,
  flash,
  fetchingEnabled,
  muted,
  folders,
  folderHost,
}) => {
  const empty = companies.length === 0;
  return (
  <Layout title={t('nav.companies')} active="companies">
    <PageHeader title={t('nav.companies')} meta={t('companies.sourcesCount', { n: companies.length })}>
      {t('companies.theBoardsAndFeedsThe')}
    </PageHeader>
    <Flash flash={flash} />

    <WatchlistSection rows={watchlist} />
    <QuietSources companies={companies} fetchingEnabled={fetchingEnabled} />
    <FolderSourcesSection folders={folders} />

    {companies.length === 0 ? (
      <Empty title={t('companies.noCompaniesYet')}>
        {t('companies.theHourlySearchReadsThe')}
      </Empty>
    ) : (
      <Card flush>
        <div class="overflow-x-auto">
          {/* TASKS U7: a phone keeps the name, the health and the actions. */}
          <div class="lg:min-w-[56rem]">
            <Table caption={t('companies.companiesAndSources')}
              hideBelow={['', 'sm', 'lg', '', 'md', 'lg', 'md', 'sm', '']}
              columns={[
                t('companies.name'),
                t('companies.col.source'),
                t('companies.col.token'),
                t('companies.col.health'),
                <span class="block text-right">{t('companies.jobs')}</span>,
                <span class="block text-right">{t('companies.alerted')}</span>,
                <span class="block text-right">{t('companies.lastFetch')}</span>,
                t('companies.col.active'),
                <span class="block text-right">{t('common.actions')}</span>,
              ]}
            >
              {companies.map((c) => (
                <Tr>
                  <Td class="max-w-[14rem] font-medium text-ink">
                    <div class="truncate" title={c.name} translate="no">
                      {safeHref(c.careerUrl) ? (
                        <a
                          href={safeHref(c.careerUrl)!}
                          target="_blank"
                          rel="noopener"
                          class="transition-colors duration-150 hover:text-accent-strong"
                        >
                          {c.name}
                        </a>
                      ) : (
                        c.name
                      )}
                    </div>
                  </Td>
                  <Td>
                    <span translate="no">
                      <Tag>{c.atsType.replace('_', ' ')}</Tag>
                    </span>
                  </Td>
                  {/* A feed query can run to fifty characters; untruncated it pushed Active and
                      Delete out of a 1440 px window, behind a sideways scroll inside the card. */}
                  <Td class="max-w-[11rem] font-mono text-meta text-ink-muted">
                    <div class="truncate" title={c.atsToken} translate="no">
                      {c.atsToken}
                    </div>
                  </Td>
                  <Td>
                    <HealthDot status={c.lastFetchStatus} streak={c.consecutiveFailures} atsType={c.atsType} />
                  </Td>
                  <Td class="text-right tabular-nums text-ink-muted">{c.jobsTotal}</Td>
                  <Td
                    class={`text-right tabular-nums ${
                      c.alertedTotal ? 'font-medium text-ok' : 'text-ink-faint'
                    }`}
                  >
                    {c.alertedTotal}
                  </Td>
                  <Td class="whitespace-nowrap text-right text-note text-ink-faint">
                    <When at={c.lastFetchedAt} />
                  </Td>
                  <Td>
                    <ActionForm action={`/companies/${c.id}/toggle-active`}>
                      {/* The badge shows the state; the button's name says the action and the company (A11Y-4). */}
                      <button
                        type="submit"
                        class="cursor-pointer rounded-full"
                        aria-label={t(c.active ? 'companies.disableNamed' : 'companies.enableNamed', { name: c.name })}
                        title={t(c.active ? 'companies.disableNamed' : 'companies.enableNamed', { name: c.name })}
                      >
                        <Badge tone={c.active ? 'ok' : 'neutral'}>
                          {c.active ? t('companies.active') : t('companies.inactive')}
                        </Badge>
                      </button>
                    </ActionForm>
                  </Td>
                  <Td>
                    <ConfirmAction
                      action={`/companies/${c.id}/delete`}
                      label={t('common.delete')}
                      ariaLabel={t('companies.deleteNamed', { name: c.name })}
                      confirm={companyDeleteConfirm(c.name, c.deleteImpact)}
                      class="flex justify-end"
                    />
                  </Td>
                </Tr>
              ))}
            </Table>
          </div>
        </div>
      </Card>
    )}

    {/* The list is what the page is about; the four ways to add to it open on demand,
        and stand open while there is nothing in the list yet. */}
    <div class="mt-8">
      <SectionTitle level="section">{t('companies.addSources')}</SectionTitle>
      <div class="flex flex-wrap items-start gap-2">
        <Disclosure variant="button" summary={t('companies.watchSpecificCompanies')} open={empty || watchlistRun !== null} class="contents">
          <div class="order-last basis-full">
            <AddCompaniesCard running={watchlistRun} />
          </div>
        </Disclosure>
        <Disclosure variant="button" summary={t('companies.addAStarterPack')} open={empty} class="contents">
          <div class="order-last basis-full">
            <StarterPackPicker segments={packs} />
          </div>
        </Disclosure>
        <Disclosure variant="button" summary={t('companies.addOneCompany')} open={empty} class="contents">
          <div class="order-last basis-full">
            <Card>
              <Hint>{t('companies.thePublicAtsEndpointIs')}</Hint>
              <More summary={t('companies.tokensThatAreNotA')} class="mb-4 mt-1">
                {tRich('companies.tokensHelp', {}, { code: (words) => <Code>{words}</Code> })}
              </More>
            <form
              method="post"
              action="/companies/new"
              class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_auto_1fr_1.2fr_auto]"
            >
              <Field label={t('companies.name')}>
                <Input type="text" name="name" required placeholder="Honeycomb.io" translate="no" />
              </Field>
              <Field label={t('companies.ats')}>
                <Select name="atsType">
                  {PROBEABLE_ATS.filter((ats) => !KEYED_ATS.includes(ats) || keyedUnlocked.includes(ats)).map((ats) => (
                    <option value={ats} translate="no">
                      {ats}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('companies.atsTokenSlug')}>
                <Input type="text" name="atsToken" required placeholder="honeycombio" mono translate="no" />
              </Field>
              <Field label={t('companies.careerUrlOptional')}>
                <Input type="url" name="careerUrl" placeholder="https://acme.com/careers" translate="no" />
              </Field>
              <div class="flex items-end">
                <Button class="w-full">{t('companies.add')}</Button>
              </div>
            </form>
            </Card>
          </div>
        </Disclosure>
        <Disclosure variant="button" summary={t('companies.aFolderOnThisComputer')} class="contents">
          <div class="order-last basis-full">
            <AddFolderCard host={folderHost} />
          </div>
        </Disclosure>
        {(suggestions.length > 0 || fitPacks.length > 0) && (
          <Disclosure
            variant="button"
            summary={t('companies.sourcesForYourSearches')}
            count={suggestions.filter((x) => x.state !== 'on').length + fitPacks.length}
            open={empty}
            class="contents"
          >
            <div class="order-last basis-full">
              <SuggestedSources suggestions={suggestions} packs={fitPacks} />
            </div>
          </Disclosure>
        )}
      </div>
    </div>

    <MutedCompaniesSection rows={muted} />

    <details class="mt-4 rounded-lg border border-line bg-surface-raised shadow-sm">
      <summary class="cursor-pointer select-none px-5 py-3 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-overlay/50">
        {t('companies.howCoverageWorks')}
      </summary>
      {/* Two columns keep a readable measure while filling the panel. */}
      <div class="grid gap-x-8 gap-y-2 border-t border-line px-5 py-4 text-sm leading-6 text-ink-muted sm:grid-cols-2">
        <p>
          {tRich('companies.coverage.vendors', {}, {
            strong: (words) => <strong class="font-medium text-ink">{words}</strong>,
            code: (words) => <Code>{words}</Code>,
            link: (words) => (
              <a
                href="https://github.com/applypack/applypack/blob/main/docs/adr/0005-no-linkedin-indeed-workday.md"
                class="font-medium text-accent-strong hover:text-accent-deep"
              >
                {words}
              </a>
            ),
          })}
        </p>
        <p>
          {tRich('companies.coverage.aggregators', { n: AGGREGATOR_LABELS.length, list: AGGREGATOR_LABELS.join(', ') }, {
            link: (words) => (
              <a href="/settings?tab=sources" class="font-medium text-accent-strong hover:text-accent-deep">
                {words}
              </a>
            ),
          })}
        </p>
      </div>
    </details>
  </Layout>
  );
};
