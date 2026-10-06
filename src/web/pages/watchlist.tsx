/** @jsxImportSource hono/jsx */
import type { Child, FC } from 'hono/jsx';
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
  Hint,
  More,
  PageHeader,
  SectionTitle,
  Select,
  SUBMIT_ONCE,
  Table,
  Tag,
  Td,
  Textarea,
  Tr,
} from '../ui';
import { formatRelative, formatUntil } from '../format';
import { wordedSource } from '../source-groups';
import { sourceLabel } from '../source-names';
import { CHECK_INTERVALS, intervalLabel } from '../../watchlist/interval';
import { MAX_LINES } from '../../watchlist/parse-input';
import { verdictLabel } from '../../watchlist/verdict';
import type { ResolvedCompany } from '../../watchlist/resolve';
import type { WatchlistRun } from '../watchlist-runs';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

/** One row of the watchlist section on /companies. */
export interface WatchedRow {
  id: number;
  name: string;
  atsType: string;
  atsToken: string;
  active: boolean;
  careerUrl: string | null;
  checkEvery: string;
  alertPolicy: string;
  nextCheckAt: Date | null;
  lastOkAt: Date | null;
  lastFetchStatus: string | null;
  jobsTotal: number;
  /** Postings stored since the user last opened this page. */
  newJobs: number;
  /** §17 stage C — when we last said this page changed. */
  lastContentAlertAt: Date | null;
  /** A change seen and not reported yet — waiting for the alert hours, for Alerts, or for a retry. */
  changePending: boolean;
  /** TASKS N8, a page drawn in the browser: the last paste, if any. */
  paste: { at: Date; lines: number; added: string[]; roles: string[] } | null;
}

/** A change watch produces no postings, so its row says different things. */
function isChangeWatch(r: WatchedRow): boolean {
  return r.atsType === 'CAREER_PAGE';
}

/** How many new lines a page lists under its paste box. */
const MAX_LISTED_LINES = 20;

/** A page drawn in the browser (TASKS N8): nothing is checked, the user pastes it. */
function needsPaste(r: WatchedRow): boolean {
  return r.atsType === 'BROWSER_PAGE';
}

const INTERVAL_SELECT = (name: string, value: string, company?: string) => (
  <Select name={name} class="min-w-[8rem]" aria-label={company ? t('watchlist.howOftenNamed', { name: company }) : t('watchlist.howOftenThisCompanyIs')}>
    {CHECK_INTERVALS.map((i) => (
      <option value={i} selected={i === value}>
        {intervalLabel(i)}
      </option>
    ))}
  </Select>
);

const POLICY_SELECT = (name: string, value: string, company?: string) => (
  <Select name={name} class="min-w-[8.75rem]" aria-label={company ? t('watchlist.whatNamedAlertsAbout', { name: company }) : t('watchlist.whatThisCompanyAlertsAbout')}>
    <option value="all" selected={value === 'all'}>
      {t('watchlist.policy.all')}
    </option>
    <option value="matches" selected={value !== 'all'}>
      {t('watchlist.policy.matches')}
    </option>
  </Select>
);

/**
 * "Add companies": paste a list of career-page or board URLs, one per line.
 * Deliberately one textarea rather than a wizard — the input a user has is a
 * list of links, and every question the form could ask (name, interval,
 * policy) is answered better on the preview, where they can see what each URL
 * actually resolved to.
 */
/** The body of "Watch specific companies" on /companies — the disclosure's button is its title. */
export const AddCompaniesCard: FC<{ running: WatchlistRun | null }> = ({ running }) => (
  <Card>
    <Hint>{tRich('watchlist.add.hint', { max: MAX_LINES }, { code: (words) => <Code>{words}</Code> })}</Hint>
    <More class="mb-3 mt-1">
      {t('watchlist.eachUrlIsResolvedTo')}
    </More>
    {running ? (
      <Button href={`/companies/watchlist/${running.id}`} variant="secondary">
        {t('watchlist.add.resolving', { done: running.results.length, total: running.total })}
      </Button>
    ) : (
      <form method="post" action="/companies/watchlist" onsubmit={SUBMIT_ONCE}>
        {/* The label is ours; what goes in the box is the user's list, never translated. */}
        <label for="watchlist-urls" class="sr-only">
          {t('watchlist.add.urlsLabel')}
        </label>
        <Textarea
          id="watchlist-urls"
          name="urls"
          rows={6}
          mono
          required
          translate="no"
          placeholder={'Vercel — https://vercel.com/careers\nhttps://www.netlify.com/careers/\nhttps://linear.app/careers'}
        />
        <div class="mt-3">
          <Button>{t('watchlist.resolveThese')}</Button>
        </div>
      </form>
    )}
  </Card>
);

/** Live progress while the URLs are resolved; watchlist.mjs polls the state route. */
export const WatchlistRunPage: FC<{ run: WatchlistRun }> = ({ run }) => (
  <Layout title={t('watchlist.run.title')} active="companies">
    <div class="w-full pt-6 lg:pt-16">
      <Card>
        <div class="mb-1 text-entity text-ink">{t('watchlist.run.heading')}</div>
        <Hint class="mb-4">
          {t('watchlist.eachUrlGetsAtMost')}
        </Hint>
        <div
          id="wl-progress"
          class="text-sm text-ink-muted"
          data-state={`/companies/watchlist/${run.id}/state`}
          data-done={`/companies/watchlist/${run.id}`}
        >
          {t('watchlist.run.progress', { done: run.results.length, total: run.total })}
        </div>
        <ul id="wl-lines" class="mt-3 flex flex-col gap-1 text-note text-ink-muted" />
      </Card>
    </div>
    <WatchlistScript />
  </Layout>
);

/**
 * Loads the browser module. Both pages that use it need it: the run page
 * polls, and the watchlist section's selects submit themselves. Without JS
 * the page still works — the selects keep their <noscript> Save button.
 */
const WatchlistScript: FC = () => (
  <script type="module" dangerouslySetInnerHTML={{ __html: WATCHLIST_BOOT }} />
);

const WATCHLIST_BOOT = `
import { init } from '/static/watchlist.mjs';
init();
`;

const VERDICT_TONE = {
  ats: 'ok',
  feed: 'ok',
  changeWatch: 'info',
  needsBrowser: 'warn',
  watchOnly: 'warn',
  refused: 'danger',
} as const;

/** How the preview's hint sets off the part of each sentence that costs something. */
const STRONG_TAG = { strong: (words: Child[]) => <strong class="font-medium text-ink">{words}</strong> };

/** The verdicts that become a row. A page drawn in the browser is one: the user pastes it (TASKS N8). */
const ADDABLE = ['ats', 'feed', 'changeWatch', 'needsBrowser'] as const;

function isAddable(r: ResolvedCompany): boolean {
  return (ADDABLE as readonly string[]).includes(r.resolution.kind);
}


/**
 * The preview. Every row the resolver could turn into a source is ticked;
 * the rest are shown with the reason and cannot be added, because adding a
 * company we cannot read would be a row that is silent forever.
 */
export const WatchlistPreviewPage: FC<{ run: WatchlistRun }> = ({ run }) => {
  const addable = run.results.filter(isAddable);
  const rest = run.results.filter((r) => !isAddable(r));
  const watching = addable.filter((r) => r.resolution.kind === 'changeWatch').length;
  const browserOnly = addable.filter((r) => r.resolution.kind === 'needsBrowser').length;
  return (
    <Layout title={t('watchlist.addCompanies')} active="companies">
      <PageHeader
        title={t('watchlist.addCompanies')}
        meta={t('watchlist.preview.meta', { n: addable.length, total: run.results.length })}
      />

      {addable.length === 0 ? (
        <Card class="mb-4">
          <Empty
            bare
            title={t('watchlist.nothingToWatchAtThose')}
            action={
              <Button href="/companies" variant="secondary" size="sm">
                {t('watchlist.backToCompanies')}
              </Button>
            }
          >
            {t('watchlist.noneOfThemPublishedA')}
          </Empty>
        </Card>
      ) : (
        <form method="post" action="/companies/watchlist/add" onsubmit={SUBMIT_ONCE}>
          <input type="hidden" name="runId" value={run.id} />
          <Card class="mb-4" flush>
            <div class="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-5 py-4">
              <label class="flex items-center gap-2 text-sm text-ink-muted">
                {tRich('watchlist.preview.check', {}, { select: () => INTERVAL_SELECT('checkEvery', 'day') })}
              </label>
              <label class="flex items-center gap-2 text-sm text-ink-muted">
                {tRich('watchlist.preview.alertAbout', {}, { select: () => POLICY_SELECT('alertPolicy', 'all') })}
              </label>
              <Button class="ml-auto">{t('watchlist.preview.addN', { n: addable.length })}</Button>
            </div>
            <Hint class="border-b border-line px-5 py-3">
              {tRich('watchlist.preview.hint', {}, STRONG_TAG)}
              {watching > 0 && (
                <>
                  {' '}
                  {tRich('watchlist.preview.hintChangeWatch', { n: watching }, STRONG_TAG)}
                </>
              )}
              {browserOnly > 0 && (
                <>
                  {' '}
                  {tRich('watchlist.preview.hintBrowser', { n: browserOnly }, STRONG_TAG)}
                </>
              )}
            </Hint>
            <Table
              columns={['', t('companies.name'), t('watchlist.col.found'), t('companies.col.source')]}
              widths={['w-[5%]', 'w-[28%]', 'w-[32%]', 'w-[35%]']}
            >
              {addable.map((r) => (
                <Tr>
                  <Td>
                    <input
                      type="checkbox"
                      name="pick"
                      value={r.input.url}
                      checked
                      aria-label={t('watchlist.preview.addNamed', { name: r.name })}
                      class="h-4 w-4 cursor-pointer accent-accent"
                    />
                  </Td>
                  <Td>
                    <input
                      type="text"
                      name={`name:${r.input.url}`}
                      value={r.name}
                      maxlength={100}
                      aria-label={t('watchlist.preview.nameFor', { url: r.input.url })}
                      class="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
                    />
                  </Td>
                  <Td>
                    <Badge tone={VERDICT_TONE[r.resolution.kind]}>{verdictLabel(r.resolution)}</Badge>
                  </Td>
                  <Td class="text-ink-muted">
                    <div class="truncate text-meta" title={r.careerUrl} translate="no">
                      <Code>
                        {r.resolution.kind === 'ats'
                          ? r.resolution.atsToken
                          : r.resolution.kind === 'feed'
                            ? r.resolution.url
                            : r.careerUrl}
                      </Code>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Table>
          </Card>
        </form>
      )}

      {rest.length > 0 && (
        <Card class="mb-4">
          <SectionTitle>{t('watchlist.preview.notAdded', { n: rest.length })}</SectionTitle>
          <Hint class="mb-3">
            {t('watchlist.thesePublishNothingAMachine')}
          </Hint>
          <ul class="divide-y divide-line">
            {rest.map((r) => (
              <li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                <div class="min-w-0" translate="no">
                  <span class="text-label text-ink">{r.name}</span>{' '}
                  <a href={r.input.url} class="text-meta text-ink-faint underline" rel="noreferrer noopener" target="_blank">
                    {r.input.url}
                  </a>
                </div>
                <div class="flex items-center gap-2">
                  <Badge tone={VERDICT_TONE[r.resolution.kind]}>{verdictLabel(r.resolution)}</Badge>
                  <span class="text-meta text-ink-muted">
                    {'reason' in r.resolution ? r.resolution.reason : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {run.rejected.length > 0 && (
        <Card class="mb-4">
          <SectionTitle>{t('watchlist.preview.noUrlLines', { n: run.rejected.length })}</SectionTitle>
          <ul class="mt-2 flex flex-col gap-1 text-note text-ink-muted" translate="no">
            {run.rejected.map((line) => (
              <li>
                <Code>{line}</Code>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Button href="/companies" variant="secondary">
        {t('watchlist.backToCompaniesList')}
      </Button>
    </Layout>
  );
};

/** The watchlist section at the top of /companies. */
export const WatchlistSection: FC<{ rows: WatchedRow[] }> = ({ rows }) => {
  if (rows.length === 0) return null;
  return (
    <Card class="mb-4" flush>
      <div class="px-5 pt-4">
        <SectionTitle>
          {t('watchlist.title')} <Badge tone="ok">{rows.length}</Badge>
        </SectionTitle>
        <Hint>
          {t('watchlist.companiesYouChoseByHand')}
        </Hint>
        <More class="mb-3 mt-1">{tRich('watchlist.more', {}, { em: (words) => <em>{words}</em> })}</More>
      </div>
      <Table
        columns={[t('common.company'), t('watchlist.col.checked'), t('watchlist.col.alerts'), t('watchlist.col.nextCheck'), t('watchlist.col.new'), '']}
        widths={['w-[24%]', 'w-[16%]', 'w-[16%]', 'w-[13%]', 'w-[7%]', 'w-[24%]']}
        hideBelow={['', '', '', 'sm', '', '']}
        thClasses={['', '', '', '', '', 'text-right']}
      >
        {rows.map((r) => (
          <Tr>
            <Td>
              <div class="truncate font-medium text-ink" title={r.name} translate="no">
                ★ {r.name}
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-2 text-meta text-ink-faint">
                <span translate={wordedSource(r.atsType) ? undefined : 'no'}>
                  <Tag>{sourceLabel(r.atsType)}</Tag>
                </span>
                {!r.active && !needsPaste(r) && <Badge tone="warn">{t('watchlist.off')}</Badge>}
              </div>
            </Td>
            <Td class="text-ink-muted">
              {needsPaste(r) ? (
                <span class="text-note" title={t('watchlist.thePageDrawsItsJobs')}>
                  {t('watchlist.notChecked')}
                </span>
              ) : (
                <form method="post" action={`/companies/${r.id}/watch`}>
                  {INTERVAL_SELECT('checkEvery', r.checkEvery, r.name)}
                  <input type="hidden" name="alertPolicy" value={r.alertPolicy} />
                  <noscript>
                    <Button size="sm" variant="secondary">{t('common.save')}</Button>
                  </noscript>
                </form>
              )}
            </Td>
            <Td class="text-ink-muted">
              {needsPaste(r) ? (
                <a href="#browser-pages" class="text-note font-medium text-accent-strong hover:text-accent-deep">
                  {t('watchlist.pasteThePage')}
                </a>
              ) : isChangeWatch(r) ? (
                <span class="text-note" title={t('watchlist.thisPagePublishesNoBoard')}>
                  {t('watchlist.pageChanges')}
                </span>
              ) : (
                <form method="post" action={`/companies/${r.id}/watch`}>
                  {POLICY_SELECT('alertPolicy', r.alertPolicy, r.name)}
                  <input type="hidden" name="checkEvery" value={r.checkEvery} />
                  <noscript>
                    <Button size="sm" variant="secondary">{t('common.save')}</Button>
                  </noscript>
                </form>
              )}
            </Td>
            <Td class="whitespace-nowrap text-ink-muted">
              {needsPaste(r) ? '—' : r.nextCheckAt === null ? t('watchlist.nextTick') : formatUntil(r.nextCheckAt)}
            </Td>
            <Td class="whitespace-nowrap">
              {needsPaste(r) ? (
                <span class="text-note text-ink-faint">
                  {r.paste === null
                    ? t('watchlist.notPastedYet')
                    : r.paste.added.length > 0
                      ? t('watchlist.paste.newAt', { n: r.paste.added.length, when: formatRelative(r.paste.at) })
                      : t('watchlist.paste.pastedAt', { when: formatRelative(r.paste.at) })}
                </span>
              ) : isChangeWatch(r) ? (
                <span class="text-note text-ink-faint" title={t('watchlist.aChangeWatchNeverStores')}>
                  {r.changePending
                    ? t('watchlist.changedNoticeWaiting')
                    : r.lastContentAlertAt
                      ? t('watchlist.changedAt', { when: formatRelative(r.lastContentAlertAt) })
                      : t('watchlist.watching')}
                </span>
              ) : r.newJobs > 0 ? (
                <a
                  href={`/jobs?q=${encodeURIComponent(r.name)}`}
                  class="font-medium text-accent-strong hover:text-accent-deep"
                  aria-label={t('watchlist.newJobsAria', { n: r.newJobs, name: r.name })}
                >
                  {r.newJobs}
                </a>
              ) : (
                <span class="text-ink-faint">—</span>
              )}
            </Td>
            <Td>
              {/* Five identical "Check now" buttons read as five identical
                  buttons, so each one names its company. The visible label
                  stays the first words of the accessible one (WCAG 2.5.3). */}
              <div class="flex flex-wrap items-center justify-end gap-2">
                {needsPaste(r) ? (
                  <Button href={r.atsToken} target="_blank" rel="noopener" size="sm" variant="secondary" aria-label={t('watchlist.openPageOf', { name: r.name })}>
                    {t('watchlist.open')}
                  </Button>
                ) : (
                  <ActionForm action={`/companies/${r.id}/check-now`}>
                    <Button size="sm" variant="secondary" aria-label={t('watchlist.checkNamedNow', { name: r.name })}>
                      {t('watchlist.checkNow')}
                    </Button>
                  </ActionForm>
                )}
                {needsPaste(r) ? (
                  // Nothing else reads this row, so leaving the watchlist is removing it.
                  <ConfirmAction
                    action={`/companies/${r.id}/delete`}
                    label={t('common.remove')}
                    variant="ghost"
                    ariaLabel={t('watchlist.removeNamed', { name: r.name })}
                    confirm={t('watchlist.removeConfirm', { name: r.name })}
                  />
                ) : (
                  <ActionForm action={`/companies/${r.id}/unwatch`}>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('watchlist.unwatchNamed', { name: r.name })}
                    >
                      {t('watchlist.unwatch')}
                    </Button>
                  </ActionForm>
                )}
              </div>
            </Td>
          </Tr>
        ))}
      </Table>
      <BrowserPages rows={rows.filter(needsPaste)} />
      <WatchlistScript />
    </Card>
  );
};

/**
 * TASKS N8: the pages that draw their jobs in the browser, each with its
 * paste box. What was new in the last paste stays listed, the lines a search
 * would take marked, until the next paste replaces it.
 */
const BrowserPages: FC<{ rows: WatchedRow[] }> = ({ rows }) =>
  rows.length === 0 ? null : (
    <div id="browser-pages" class="scroll-mt-4 border-t border-line px-5 py-4">
      <div class="text-label text-ink">{t('watchlist.pagesDrawnInTheBrowser')}</div>
      <Hint class="mt-0.5">
        {t('watchlist.theirJobsAppearOnlyWhen')}
      </Hint>
      <div class="mt-3 space-y-3">
        {rows.map((r) => (
          <Disclosure summary={t('watchlist.pastePageOf', { name: r.name })} open={r.paste === null && rows.length === 1}>
            <form method="post" action={`/companies/${r.id}/paste`} class="mt-2 space-y-2">
              <Textarea
                name="page"
                rows={5}
                required
                aria-label={t('watchlist.pageTextOf', { name: r.name })}
                placeholder={t('watchlist.pastePlaceholder')}
              />
              <Button size="sm" variant="secondary">
                {t('watchlist.readIt')}
              </Button>
            </form>
            {r.paste && (r.paste.added.length > 0 || r.paste.roles.length > 0) && (
              <div class="mt-3">
                <Hint>
                  {r.paste.added.length > 0
                    ? t('watchlist.paste.lastNew', { when: formatRelative(r.paste.at) })
                    : t('watchlist.paste.lastRoles', { when: formatRelative(r.paste.at) })}
                </Hint>
                <ul class="mt-1 space-y-0.5 text-sm text-ink">
                  {(r.paste.added.length > 0 ? r.paste.added : r.paste.roles).slice(0, MAX_LISTED_LINES).map((line) => (
                    <li class="flex flex-wrap items-center gap-2">
                      <span translate="no">{line}</span>
                      {r.paste?.roles.includes(line) && r.paste.added.length > 0 && <Badge tone="ok">{t('watchlist.yourSearch')}</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Disclosure>
        ))}
      </div>
    </div>
  );
