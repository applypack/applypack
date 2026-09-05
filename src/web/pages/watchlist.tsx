/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  Code,
  Empty,
  Hint,
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
import { sourceLabel } from '../source-names';
import { CHECK_INTERVALS, intervalLabel } from '../../watchlist/interval';
import { MAX_LINES } from '../../watchlist/parse-input';
import { verdictLabel } from '../../watchlist/verdict';
import type { ResolvedCompany } from '../../watchlist/resolve';
import type { WatchlistRun } from '../watchlist-runs';

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
}

/** A change watch produces no postings, so its row says different things. */
function isChangeWatch(r: WatchedRow): boolean {
  return r.atsType === 'CAREER_PAGE';
}

const INTERVAL_SELECT = (name: string, value: string, company?: string) => (
  <Select name={name} class="min-w-[8rem]" aria-label={company ? `How often ${company} is checked` : 'How often this company is checked'}>
    {CHECK_INTERVALS.map((i) => (
      <option value={i} selected={i === value}>
        {intervalLabel(i)}
      </option>
    ))}
  </Select>
);

const POLICY_SELECT = (name: string, value: string, company?: string) => (
  <Select name={name} class="min-w-[8.75rem]" aria-label={company ? `What ${company} alerts about` : 'What this company alerts about'}>
    <option value="all" selected={value === 'all'}>
      Every posting
    </option>
    <option value="matches" selected={value !== 'all'}>
      Matches only
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
export const AddCompaniesCard: FC<{ running: WatchlistRun | null }> = ({ running }) => (
  <Card class="mb-4">
    <SectionTitle>Watch specific companies</SectionTitle>
    <Hint class="mb-3">
      One URL per line — a careers page or a board link. Optionally{' '}
      <Code>Name — https://…</Code>. Each one is resolved to a job board or a feed; whatever we
      cannot read is listed honestly rather than half-added. Up to {MAX_LINES} at a time.
      <br />
      Watched companies are checked <strong class="font-medium text-ink">on the same tick as
      your search</strong>, so they follow your schedule — nothing is fetched during hours you
      told the search to sleep.
    </Hint>
    {running ? (
      <Button href={`/companies/watchlist/${running.id}`} variant="secondary">
        Resolving {running.results.length}/{running.total}… watch
      </Button>
    ) : (
      <form method="post" action="/companies/watchlist" onsubmit={SUBMIT_ONCE}>
        <Textarea
          name="urls"
          rows={6}
          mono
          required
          aria-label="Company URLs, one per line"
          placeholder={'Vercel — https://vercel.com/careers\nhttps://www.netlify.com/careers/\nhttps://linear.app/careers'}
        />
        <div class="mt-3">
          <Button>Resolve these</Button>
        </div>
      </form>
    )}
  </Card>
);

/** Live progress while the URLs are resolved; watchlist.mjs polls the state route. */
export const WatchlistRunPage: FC<{ run: WatchlistRun }> = ({ run }) => (
  <Layout title="Resolving companies…" active="companies">
    <div class="w-full pt-6 lg:pt-16">
      <Card>
        <div class="mb-1 text-sm font-semibold text-ink">Resolving companies</div>
        <Hint class="mb-4">
          Each URL gets at most five requests: robots.txt, the page, and up to three feed paths.
          A polite second between them, so twenty companies take a couple of minutes.
        </Hint>
        <div
          id="wl-progress"
          class="text-sm text-ink-muted"
          data-state={`/companies/watchlist/${run.id}/state`}
          data-done={`/companies/watchlist/${run.id}`}
        >
          {run.results.length} of {run.total} resolved
        </div>
        <ul id="wl-lines" class="mt-3 flex flex-col gap-1 text-[13px] text-ink-muted" />
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
export const WatchlistScript: FC = () => (
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
  watchOnly: 'warn',
  refused: 'danger',
} as const;

/** The three verdicts that become a row. */
const ADDABLE = ['ats', 'feed', 'changeWatch'] as const;

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
  return (
    <Layout title="Add companies" active="companies">
      <PageHeader
        title="Add companies"
        meta={`${addable.length} of ${run.results.length} can be watched`}
      />

      {addable.length === 0 ? (
        <Card class="mb-4">
          <Empty>
            None of those URLs published a job board or a job feed we can read. Paste a board URL
            directly (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Personio,
            Teamtailor …) if you know it.
          </Empty>
        </Card>
      ) : (
        <form method="post" action="/companies/watchlist/add" onsubmit={SUBMIT_ONCE}>
          <input type="hidden" name="runId" value={run.id} />
          <Card class="mb-4" flush>
            <div class="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-5 py-4">
              <label class="flex items-center gap-2 text-sm text-ink-muted">
                Check {INTERVAL_SELECT('checkEvery', 'day')}
              </label>
              <label class="flex items-center gap-2 text-sm text-ink-muted">
                Alert me about {POLICY_SELECT('alertPolicy', 'all')}
              </label>
              <Button class="ml-auto">
                Add {addable.length} compan{addable.length === 1 ? 'y' : 'ies'}
              </Button>
            </div>
            <Hint class="border-b border-line px-5 py-3">
              &ldquo;Every posting&rdquo; ignores your filter and your fit threshold for these
              companies, so the <strong class="font-medium text-ink">first check scores
              everything they currently have up</strong> — on five companies that was 217
              postings. A longer interval is the lever if that is more AI than you want.
              {watching > 0 && (
                <>
                  {' '}
                  <strong class="font-medium text-ink">
                    {watching} of these publish no board and no feed
                  </strong>
                  , so they are watched a different way: we hash the page&rsquo;s text and tell
                  you when it changes, at most once a day. Those never produce postings and
                  never cost AI — they say &ldquo;have a look&rdquo;.
                </>
              )}
            </Hint>
            <Table
              columns={['', 'Name', 'What we found', 'Source']}
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
                      aria-label={`Add ${r.name}`}
                      class="h-4 w-4 cursor-pointer accent-accent"
                    />
                  </Td>
                  <Td>
                    <input
                      type="text"
                      name={`name:${r.input.url}`}
                      value={r.name}
                      maxlength={100}
                      aria-label={`Name for ${r.input.url}`}
                      class="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
                    />
                  </Td>
                  <Td>
                    <Badge tone={VERDICT_TONE[r.resolution.kind]}>{verdictLabel(r.resolution)}</Badge>
                  </Td>
                  <Td class="text-ink-muted">
                    <div class="truncate text-xs" title={r.careerUrl}>
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
          <SectionTitle>Not added ({rest.length})</SectionTitle>
          <Hint class="mb-3">
            These publish nothing a machine can read at that URL. If you know the company&rsquo;s
            board (Greenhouse, Lever, Ashby …), paste that link instead — big career sites usually
            have one, they just do not link it.
          </Hint>
          <ul class="divide-y divide-line">
            {rest.map((r) => (
              <li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                <div class="min-w-0">
                  <span class="text-[13px] font-medium text-ink">{r.name}</span>{' '}
                  <a href={r.input.url} class="text-xs text-ink-faint underline" rel="noreferrer noopener" target="_blank">
                    {r.input.url}
                  </a>
                </div>
                <div class="flex items-center gap-2">
                  <Badge tone={VERDICT_TONE[r.resolution.kind]}>{verdictLabel(r.resolution)}</Badge>
                  <span class="text-xs text-ink-muted">
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
          <SectionTitle>Lines with no URL ({run.rejected.length})</SectionTitle>
          <ul class="mt-2 flex flex-col gap-1 text-[13px] text-ink-muted">
            {run.rejected.map((line) => (
              <li>
                <Code>{line}</Code>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Button href="/companies" variant="secondary">
        Back to companies
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
          Watchlist <Badge tone="ok">{rows.length}</Badge>
        </SectionTitle>
        <Hint class="mb-3">
          Companies you chose by hand. They are checked on the same tick as your search, so they
          follow your schedule — set it on Settings → General. &ldquo;Every posting&rdquo; alerts
          you about everything they put up, whatever your fit threshold says. A row marked{' '}
          <em>Page changes</em> publishes no board and no feed: we cannot read its jobs, so we
          watch the page&rsquo;s text and say when it moves.
        </Hint>
      </div>
      <Table
        columns={['Company', 'Checked', 'Alerts', 'Next check', 'New', '']}
        widths={['w-[24%]', 'w-[16%]', 'w-[16%]', 'w-[13%]', 'w-[7%]', 'w-[24%]']}
        hideBelow={['', '', '', 'sm', '', '']}
        thClasses={['', '', '', '', '', 'text-right']}
      >
        {rows.map((r) => (
          <Tr>
            <Td>
              <div class="truncate font-medium text-ink" title={r.name}>
                ★ {r.name}
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                <Tag>{sourceLabel(r.atsType)}</Tag>
                {!r.active && <Badge tone="warn">Off</Badge>}
              </div>
            </Td>
            <Td class="text-ink-muted">
              <form method="post" action={`/companies/${r.id}/watch`}>
                {INTERVAL_SELECT('checkEvery', r.checkEvery, r.name)}
                <input type="hidden" name="alertPolicy" value={r.alertPolicy} />
                <noscript>
                  <Button size="sm" variant="secondary">Save</Button>
                </noscript>
              </form>
            </Td>
            <Td class="text-ink-muted">
              {isChangeWatch(r) ? (
                <span class="text-[13px]" title="This page publishes no board and no feed, so there are no postings to score — we tell you when its text changes, at most once a day.">
                  Page changes
                </span>
              ) : (
                <form method="post" action={`/companies/${r.id}/watch`}>
                  {POLICY_SELECT('alertPolicy', r.alertPolicy, r.name)}
                  <input type="hidden" name="checkEvery" value={r.checkEvery} />
                  <noscript>
                    <Button size="sm" variant="secondary">Save</Button>
                  </noscript>
                </form>
              )}
            </Td>
            <Td class="whitespace-nowrap text-ink-muted">
              {r.nextCheckAt === null ? 'next tick' : formatUntil(r.nextCheckAt)}
            </Td>
            <Td class="whitespace-nowrap">
              {isChangeWatch(r) ? (
                <span class="text-[13px] text-ink-faint" title="A change watch never stores postings.">
                  {r.lastContentAlertAt ? `changed ${formatRelative(r.lastContentAlertAt)}` : 'watching'}
                </span>
              ) : r.newJobs > 0 ? (
                <a
                  href={`/jobs?q=${encodeURIComponent(r.name)}`}
                  class="font-medium text-accent"
                  aria-label={`${r.newJobs} posting${r.newJobs === 1 ? '' : 's'} from ${r.name} in the last week`}
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
                <ActionForm action={`/companies/${r.id}/check-now`}>
                  <Button size="sm" variant="secondary" aria-label={`Check ${r.name} now`}>
                    Check now
                  </Button>
                </ActionForm>
                <ActionForm action={`/companies/${r.id}/unwatch`}>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Unwatch ${r.name} — it stays in the hourly tick`}
                  >
                    Unwatch
                  </Button>
                </ActionForm>
              </div>
            </Td>
          </Tr>
        ))}
      </Table>
      <WatchlistScript />
    </Card>
  );
};
