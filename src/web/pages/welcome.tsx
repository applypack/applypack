/** @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import { Layout } from '../layout';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  Code,
  Field,
  FILE_INPUT_CLASS,
  FitBadge,
  Flash,
  Hint,
  Input,
  MarkIcon,
  More,
  NEEDS_FILE_JS,
  PillCheckbox,
  Select,
  TagListInput,
} from '../ui';
import type { FlashMessage } from '../flash';
import { formatDuration } from '../format';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { SENIORITY_LEVELS } from '../../resume/profile-draft';
import type { AiProviderId } from '../../ai-engine';
import { SCORE_BATCH } from '../../jobs/score-pick';
import { WELCOME_STEPS, type WelcomeStep } from '../welcome-steps';
import type { SourceSuggestion } from '../../starter-packs/suggest';
import type { PackOffer } from '../pack-offers';
import { LanguageMenu } from '../language-menu';
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

/*
 * First-run wizard (docs/onboarding-plan.md §2). One screen, one action:
 * the checklist on top, the first undone step below it. Copy stays in plain
 * words — "match score", never "classifier" — the jargon lives in Settings.
 */

export interface EngineStatusRow {
  id: AiProviderId;
  label: string;
  ok: boolean;
  detail: string;
  /** The .env variable this engine's key mirrors; null = login-only (ADR 0027). */
  keyEnvVar: string | null;
}

export interface LastSearch {
  fetched: number;
  sources: number;
  failed: number;
  stored: number;
  durationMs: number;
}

export interface ProfileDraftCard {
  /** true = the card offers a second search; false = it fills the active profile. */
  asNew: boolean;
  /** What the search would be called — the resume's headline, usually. */
  profileName: string;
  resumeId: number;
  resumeName: string;
  title: string | null;
  primarySkills: string[];
  skillCount: number;
  seniority: string | null;
  roleTypes: string[];
  /** Editor-facing labels of the fields the draft fills. */
  changed: string[];
  warnings: string[];
}

/** Step 1's "A model on this computer" card (TASKS S1): the servers found at their default addresses. */
export interface LocalModelView {
  servers: { name: string; engine: 'local_api' | 'openai_api'; base: string; host: string; models: string[]; preferred: string | null }[];
  /** The address of the found server the engine already uses first, if any. */
  inUse: string | null;
}

export interface TopJob {
  id: number;
  title: string;
  companyName: string;
  fitScore: number | null;
}

export interface WelcomeProps {
  steps: { key: WelcomeStep; done: boolean }[];
  /** The expanded step; null when every step is done. */
  current: WelcomeStep | null;
  setupCompleted: boolean;
  fetchingEnabled: boolean;
  telegramEnabled: boolean;
  ai: { engines: EngineStatusRow[]; local: LocalModelView };
  search: {
    jobCount: number;
    last: LastSearch | null;
    runningRunId: string | null;
    /** The aggregators switched on — what the test search asks (docs/onboarding-sources.md, Decision B). */
    aggregators: number;
    /** The primary search's countries, as the chip editor shows them. */
    countries: string[];
  };
  profile: {
    id: number;
    name: string;
    stackRequired: string[];
    roleTypes: string[];
    seniority: string[];
    resumes: { id: number; name: string }[];
    draft: ProfileDraftCard | null;
    /** What reading the resume costs, in one sentence (web/cost-hint.ts). */
    scanCost: string;
  };
  /** The boards that fit where the searches hunt, with their state here (#148). */
  sources: { suggestions: SourceSuggestion[]; packs: PackOffer[] };
  matches: {
    scoredCount: number;
    matchCount: number;
    minFitScore: number;
    top: TopJob[];
    /** Stored-unscored jobs that fit the profile's words — what one more "Score" press would take. */
    waiting: number;
    runningRunId: string | null;
    /** What one scoring call costs, in one sentence (web/cost-hint.ts). */
    scoreCost: string;
  };
  flash?: FlashMessage | null;
}

/** The step titles, as catalog keys: read at render, in the reader's language. */
const STEP_TITLES = {
  ai: 'welcome.step.ai',
  search: 'welcome.step.search',
  profile: 'welcome.step.profile',
  sources: 'welcome.step.sources',
  matches: 'welcome.step.matches',
} as const satisfies Record<WelcomeStep, MessageKey>;

/** Plain-language setup cards for the "nothing detected" state, in the order a newcomer reads them. */
const ENGINE_CARDS: { id: AiProviderId; title: MessageKey; how: MessageKey; env: string | null }[] = [
  { id: 'claude_code', title: 'welcome.engine.claude_code.title', how: 'welcome.engine.claude_code.how', env: 'CLAUDE_CODE_OAUTH_TOKEN' },
  { id: 'anthropic_api', title: 'welcome.engine.anthropic_api.title', how: 'welcome.engine.anthropic_api.how', env: 'ANTHROPIC_API_KEY' },
  { id: 'gemini_cli', title: 'welcome.engine.gemini_cli.title', how: 'welcome.engine.gemini_cli.how', env: 'GEMINI_API_KEY' },
  { id: 'agy_cli', title: 'welcome.engine.agy_cli.title', how: 'welcome.engine.agy_cli.how', env: null },
  { id: 'openai_api', title: 'welcome.engine.openai_api.title', how: 'welcome.engine.openai_api.how', env: 'OPENAI_API_KEY' },
  { id: 'codex_cli', title: 'welcome.engine.codex_cli.title', how: 'welcome.engine.codex_cli.how', env: null },
];

/** What a source's badge says for its state here. */
const SOURCE_STATE = {
  on: 'welcome.sources.state.on',
  off: 'welcome.sources.state.off',
  missing: 'welcome.sources.state.missing',
} as const satisfies Record<SourceSuggestion['state'], MessageKey>;

const QUIET_LINK = 'font-medium text-accent-strong hover:text-accent-deep';

/** A command or a variable's name inside a sentence: the message keeps it, the page sets it as code. */
const asCode = (words: Child[]): Child => <Code>{words}</Code>;

/** The part of a sentence the eye should land on: a count, a name. */
const bold = (words: Child[]): Child => <span class="font-medium">{words}</span>;

export const WelcomePage: FC<WelcomeProps> = (p) => (
  <Layout title={t('welcome.title')}>
    <header class="mb-6">
      <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div>
          <h1 class="text-title text-ink">{t('welcome.heading')}</h1>
          <p data-ui="hint" class="mt-1 text-note leading-5 text-ink-faint">
            {t('welcome.editableLater')}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          {/* The language is the first choice of a first run (ADR 0061), on whichever step the wizard opens — an
              install with an engine already connected starts on step 2 (#358); later it lives in the menu and in Settings. */}
          {!p.setupCompleted && <LanguageMenu variant="inline" />}
          {!p.setupCompleted && (
            <ActionForm action="/welcome/skip">
              <Button size="sm" variant="ghost" title={t('welcome.skip.title')}>
                {t('welcome.skip')}
              </Button>
            </ActionForm>
          )}
        </div>
      </div>
    </header>
    <Flash flash={p.flash} />

    <ol class="mb-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('welcome.stepsLabel')}>
      {p.steps.map((s, i) => {
        const state = s.done ? 'done' : s.key === p.current ? 'active' : 'pending';
        return (
          <li>
            <a
              href={`/welcome?step=${s.key}`}
              aria-current={state === 'active' ? 'step' : undefined}
              class={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm transition-colors duration-150 ${
                state === 'active'
                  ? 'border-accent/40 bg-accent/5 text-ink'
                  : state === 'done'
                    ? 'border-line bg-surface-raised text-ink'
                    : 'border-line bg-surface-raised text-ink-faint hover:text-ink'
              }`}
            >
              <span
                class={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-meta font-medium ${
                  state === 'done'
                    ? 'bg-ok/10 text-ok'
                    : state === 'active'
                      ? 'bg-accent text-white'
                      : 'bg-surface-overlay text-ink-faint'
                }`}
                aria-hidden="true"
              >
                {state === 'done' ? <MarkIcon kind="check" /> : i + 1}
              </span>
              <span class="truncate">{t(STEP_TITLES[s.key])}</span>
              {state === 'done' && <span class="sr-only">{t('welcome.step.doneSr')}</span>}
            </a>
          </li>
        );
      })}
    </ol>

    {p.current === 'ai' && <AiStep {...p} />}
    {p.current === 'search' && <SearchStep {...p} />}
    {p.current === 'profile' && <ProfileStep {...p} />}
    {p.current === 'sources' && <SourcesStep {...p} />}
    {p.current === 'matches' && <MatchesStep {...p} />}
    {p.current === null && <AllDone {...p} />}
    <script type="module" dangerouslySetInnerHTML={{ __html: SEARCH_BOOT }} />
  </Layout>
);

const StepCard: FC<PropsWithChildren<{ n: number; step: WelcomeStep; done: boolean }>> = ({
  n,
  step,
  done,
  children,
}) => (
  <Card>
    <div class="mb-1 flex flex-wrap items-center gap-2">
      <h2 class="text-entity text-ink">{t('welcome.step.heading', { n, title: t(STEP_TITLES[step]) })}</h2>
      {done && <Badge tone="ok">{t('welcome.step.doneBadge')}</Badge>}
    </div>
    {children}
  </Card>
);

/* ---------- step 1 ---------- */

/**
 * A model on this computer (TASKS S1): Ollama or LM Studio answering at its
 * default address, found by one local request each — or, when nothing is
 * running and nothing else is connected either, how to get one.
 */
const LocalModelCard: FC<{ local: LocalModelView; offerInstall: boolean }> = ({ local, offerInstall }) => {
  const servers = local.servers.filter((s) => s.base !== local.inUse && s.models.length > 0);
  const empty = local.servers.find((s) => s.models.length === 0);
  if (servers.length === 0 && !offerInstall) return null;
  return (
    <div class="mt-4 rounded-md border border-line px-4 py-3">
      <div class="text-sm font-medium text-ink">{t('welcome.local.title')}</div>
      {servers.length > 0 ? (
        servers.map((s) => (
          <form method="post" action="/welcome/ai/local" class="mt-2">
            <input type="hidden" name="engine" value={s.engine} />
            <input type="hidden" name="base" value={s.base} />
            <p data-ui="hint" class="text-note leading-5 text-ink-faint">
              {t('welcome.local.found', { name: s.name, host: s.host, n: s.models.length })}{' '}
              {s.engine === 'local_api'
                ? t('welcome.local.contextOllama')
                : t('welcome.local.contextOther')}
            </p>
            <div class="mt-2.5 flex flex-wrap items-end gap-2">
              <Select name="model" aria-label={t('welcome.local.modelOn', { name: s.name })} class="min-w-[12rem] flex-1">
                {s.models.map((m) => (
                  <option value={m} selected={m === s.preferred} translate="no">
                    {m}
                  </option>
                ))}
              </Select>
              <Button variant="secondary">
                {offerInstall ? t('welcome.local.use') : t('welcome.local.useFirst')}
              </Button>
            </div>
          </form>
        ))
      ) : empty ? (
        <p data-ui="hint" class="mt-1 text-note leading-5 text-ink-faint">
          {tRich('welcome.local.empty', { name: empty.name, host: empty.host }, { code: asCode })}
        </p>
      ) : (
        <p data-ui="hint" class="mt-1 text-note leading-5 text-ink-faint">
          {tRich('welcome.local.install', {}, { code: asCode })}
        </p>
      )}
    </div>
  );
};

const AiStep: FC<WelcomeProps> = ({ ai, steps }) => {
  const connected = ai.engines.filter((e) => e.ok);
  const done = steps.find((s) => s.key === 'ai')?.done ?? false;
  return (
    <StepCard n={1} step="ai" done={done}>
      {connected.length > 0 ? (
        <>
          <p data-ui="hint" class="text-sm text-ink-muted">
            {t('welcome.ai.detected')}
          </p>
          <ul class="mt-3 space-y-1.5">
            {connected.map((e) => (
              <li class="flex items-center gap-2 text-sm text-ink">
                <MarkIcon kind="check" class="text-ok" />
                <span class="font-medium" translate="no">
                  {e.label}
                </span>
                <span class="text-ink-faint">— {e.detail}</span>
              </li>
            ))}
          </ul>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <Button href="/welcome?step=search">{t('welcome.continue')}</Button>
            <ActionForm action="/welcome/ai/test">
              <Button variant="violet" title={t('welcome.ai.test.title')}>
                {t('welcome.ai.test')}
              </Button>
            </ActionForm>
            <Hint>{t('welcome.ai.test.hint')}</Hint>
          </div>
          <LocalModelCard local={ai.local} offerInstall={false} />
        </>
      ) : (
        <>
          <p data-ui="hint" class="text-sm text-ink-muted">
            {t('welcome.ai.none')}
          </p>
          <LocalModelCard local={ai.local} offerInstall />
          <ul class="mt-4 grid gap-3 lg:grid-cols-2">
            {ENGINE_CARDS.map((card) => {
              const status = ai.engines.find((e) => e.id === card.id);
              return (
                <li class="rounded-md border border-line px-4 py-3">
                  <div class="text-sm font-medium text-ink">{t(card.title)}</div>
                  <p data-ui="hint" class="mt-1 text-note leading-5 text-ink-faint">{t(card.how)}</p>
                  {status?.keyEnvVar && (
                    <form
                      method="post"
                      action="/welcome/ai/key"
                      class="mt-2.5 flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="provider" value={card.id} />
                      <Input
                        type="password"
                        name="key"
                        required
                        autocomplete="off"
                        spellcheck="false"
                        aria-label={t('welcome.ai.keyLabel', { engine: status.label })}
                        placeholder={t('welcome.ai.keyPlaceholder')}
                        mono
                        class="min-w-[12rem] flex-1"
                      />
                      <Button variant="secondary">
                        {t('common.save')}
                      </Button>
                    </form>
                  )}
                  {status && (
                    <p data-ui="hint" class="mt-2 text-meta text-ink-faint">{t('welcome.ai.rightNow', { detail: status.detail })}</p>
                  )}
                  {card.env && (
                    <p data-ui="hint" class="mt-1 text-meta text-ink-faint">
                      {tRich('welcome.ai.envFile', { name: card.env }, { code: asCode })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <Button href="/welcome">{t('welcome.ai.checkAgain')}</Button>
            <Hint>
              {tRich('welcome.ai.docs', {}, {
                link: (words) => (
                  <a href="https://github.com/applypack/applypack/blob/main/docs/ai-engines.md" class={QUIET_LINK}>
                    {words}
                  </a>
                ),
              })}
            </Hint>
          </div>
        </>
      )}
    </StepCard>
  );
};

/* ---------- step 2 ---------- */

const SearchStep: FC<WelcomeProps> = ({ search, steps }) => {
  const done = steps.find((s) => s.key === 'search')?.done ?? false;
  const last = search.last;
  return (
    <StepCard n={2} step="search" done={done}>
      {done ? (
        <>
          <p class="text-sm text-ink">
            <MarkIcon kind="check" class="mr-1 inline text-ok" />
            {tRich('welcome.search.stored', { n: search.jobCount }, { b: bold })}
            {last && (
              <>
                {' '}
                {t('welcome.search.last', {
                  fetched: last.fetched,
                  sources: last.sources,
                  failed: last.failed,
                  duration: formatDuration(last.durationMs),
                  stored: last.stored,
                })}
              </>
            )}
          </p>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <Button href="/welcome?step=profile">{t('welcome.continue')}</Button>
            <ActionForm action="/welcome/search">
              <Button variant="secondary">{t('welcome.search.again')}</Button>
            </ActionForm>
          </div>
        </>
      ) : (
        <>
          <p data-ui="hint" class="text-sm text-ink-muted">
            {t('welcome.search.intro', { n: search.aggregators })}
          </p>
          <More class="mt-1">
            {t('welcome.search.more')}
          </More>
          {last && last.fetched === 0 && (
            <p class="mt-2 text-note leading-5 text-warn">
              {t('welcome.search.nothing', { n: last.sources })}
            </p>
          )}
          {search.runningRunId ? (
            <div class="mt-4">
              <Button href={`/runs/fetch-now/${search.runningRunId}`}>{t('welcome.search.watch')}</Button>
            </div>
          ) : (
            <form method="post" action="/welcome/search" class="mt-4">
              <TagListInput
                label={t('welcome.search.where')}
                hint={t('welcome.search.where.hint')}
                more={t('welcome.search.where.more')}
                name="countries"
                values={search.countries}
                placeholder={t('welcome.search.where.placeholder')}
                rows={1}
                picker="countries"
              />
              <Button class="mt-3">{t('welcome.search.run')}</Button>
            </form>
          )}
        </>
      )}
    </StepCard>
  );
};

/* ---------- step 3 ---------- */

const ProfileStep: FC<WelcomeProps> = ({ profile, steps }) => {
  const done = steps.find((s) => s.key === 'profile')?.done ?? false;
  const d = profile.draft;
  return (
    <StepCard n={3} step="profile" done={done}>
      {d ? (
        <>
          <p data-ui="hint" class="text-sm text-ink-muted">{t('welcome.draft.from', { name: d.resumeName })}</p>
          <p class="mt-2 text-sm leading-6 text-ink">
            {/* Two sentences, each whole: who the resume says you are, then what the search will look for. */}
            {tRich(
              'welcome.draft.youAre',
              {
                titled: d.title ? 'yes' : 'no',
                title: d.title ?? '',
                tools: d.primarySkills.length > 0 ? 'yes' : 'no',
                skills: d.primarySkills.join(', '),
                more: d.skillCount,
              },
              { b: bold },
            )}{' '}
            {tRich(
              d.asNew ? 'welcome.draft.huntNew' : 'welcome.draft.hunt',
              {
                name: d.profileName,
                level: d.seniority ? 'yes' : 'no',
                seniority: d.seniority ?? '',
                typed: d.roleTypes.length > 0 ? 'yes' : 'no',
                roles: d.roleTypes.join(' / '),
              },
              { b: bold },
            )}
          </p>
          {d.warnings.length > 0 && (
            <p class="mt-2 text-note leading-5 text-warn">{t('welcome.draft.note', { warnings: d.warnings.join('; ') })}</p>
          )}
          <div class="mt-4 flex flex-wrap items-center gap-2">
            {d.asNew ? (
              <>
                <ActionForm action="/welcome/profile/create" hidden={{ resumeId: d.resumeId }}>
                  <Button>{t('welcome.draft.create')}</Button>
                </ActionForm>
                <Button href="/welcome?step=profile" variant="secondary">
                  {t('ui.cancel')}
                </Button>
              </>
            ) : (
              <>
                {d.changed.length > 0 ? (
                  <ActionForm action="/welcome/profile/apply" hidden={{ resumeId: d.resumeId }}>
                    <Button>{t('welcome.draft.apply')}</Button>
                  </ActionForm>
                ) : (
                  <Button href="/welcome?step=matches">{t('welcome.continue')}</Button>
                )}
                <ActionForm
                  action={`/settings/profiles/${profile.id}/fill-from-resume`}
                  hidden={{ resumeId: d.resumeId }}
                >
                  <Button variant="secondary">{t('welcome.draft.adjust')}</Button>
                </ActionForm>
              </>
            )}
          </div>
          <Hint class="mt-3">
            {d.asNew
              ? t('welcome.draft.hintNew')
              : t('welcome.draft.hint')}
          </Hint>
        </>
      ) : done ? (
        <>
          <p class="text-sm text-ink">
            <MarkIcon kind="check" class="mr-1 inline text-ok" />
            {tRich(
              'welcome.profile.done',
              {
                name: profile.name,
                typed: profile.roleTypes.length > 0 ? 'yes' : 'no',
                roles: profile.roleTypes.join(' / '),
                stacked: profile.stackRequired.length > 0 ? 'yes' : 'no',
                stack: profile.stackRequired.join(', '),
              },
              { b: bold },
            )}
          </p>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <Button href="/welcome?step=matches">{t('welcome.continue')}</Button>
            <Button href="/settings?tab=profile" variant="secondary">
              {t('welcome.profile.adjust')}
            </Button>
          </div>
          <details class="mt-5 rounded-md border border-line">
            <summary class="cursor-pointer select-none px-4 py-2.5 text-note font-medium text-ink hover:text-accent-strong">
              {t('welcome.profile.another.summary')}
            </summary>
            <div class="space-y-3 border-t border-line px-4 py-4">
              <Hint class="!mt-0">
                {t('welcome.profile.another.hint')}
              </Hint>
              <form
                method="post"
                action="/welcome/resume"
                enctype="multipart/form-data"
                class="flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="mode" value="new" />
                <Field label={t('welcome.profile.another.file')} class="min-w-0 flex-1">
                  <input
                    type="file"
                    name="file"
                    accept={ACCEPTED_EXTENSIONS.join(',')}
                    required
                    class={`block w-full text-sm text-ink-muted ${FILE_INPUT_CLASS}`}
                  />
                </Field>
                <Button variant="secondary">{t('welcome.profile.another.upload')}</Button>
              </form>
              {profile.resumes.length > 0 && (
                <form method="post" action="/welcome/resume" class="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="mode" value="new" />
                  <Field label={t('welcome.profile.another.existing')} class="min-w-0 flex-1">
                    <Select name="resumeId">
                      {profile.resumes.map((r) => (
                        <option value={r.id} translate="no">
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button variant="secondary">{t('welcome.profile.useResume')}</Button>
                </form>
              )}
            </div>
          </details>
        </>
      ) : (
        <>
          <p data-ui="hint" class="text-sm text-ink-muted">
            {t('welcome.profile.intro', { cost: profile.scanCost })}
          </p>
          <form
            method="post"
            action="/welcome/resume"
            enctype="multipart/form-data"
            class="mt-4 flex flex-wrap items-end gap-3"
            data-needs-file
          >
            <Field label={t('welcome.profile.file')} hint={t('welcome.profile.file.hint', { formats: ACCEPTED_EXTENSIONS.join(', ') })} class="min-w-0 flex-1">
              <input
                type="file"
                name="file"
                accept={ACCEPTED_EXTENSIONS.join(',')}
                required
                class={`block w-full text-sm text-ink-muted ${FILE_INPUT_CLASS}`}
              />
            </Field>
            <Button>{t('welcome.profile.upload')}</Button>
          </form>
          <script dangerouslySetInnerHTML={{ __html: NEEDS_FILE_JS }} />
          {profile.resumes.length > 0 && (
            <form method="post" action="/welcome/resume" class="mt-3 flex flex-wrap items-end gap-3">
              <Field label={t('welcome.profile.existing')} class="min-w-0 flex-1">
                <Select name="resumeId">
                  {profile.resumes.map((r) => (
                    <option value={r.id} translate="no">
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button variant="secondary">{t('welcome.profile.useResume')}</Button>
            </form>
          )}
          <details class="mt-5 rounded-md border border-line">
            <summary class="cursor-pointer select-none px-4 py-2.5 text-note font-medium text-ink hover:text-accent-strong">
              {t('welcome.profile.questions')}
            </summary>
            <form method="post" action="/welcome/profile" class="space-y-4 border-t border-line px-4 py-4">
              <Field
                label={t('welcome.profile.stack')}
                hint={t('welcome.profile.stack.hint')}
              >
                <Input
                  type="text"
                  name="stackRequired"
                  placeholder={t('welcome.profile.stack.placeholder')}
                  value={profile.stackRequired.join(', ')}
                />
              </Field>
              <Field label={t('welcome.profile.roles')} hint={t('welcome.profile.roles.hint')}>
                <Input
                  type="text"
                  name="roleTypes"
                  placeholder={t('welcome.profile.roles.placeholder')}
                  value={profile.roleTypes.join(', ')}
                />
              </Field>
              <fieldset>
                <legend class="text-label text-ink">{t('welcome.profile.seniority')}</legend>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  {SENIORITY_LEVELS.map((s) => (
                    <PillCheckbox name="seniority" value={s} checked={profile.seniority.includes(s)}>
                      {/* The level as the profile stores it and postings write it: a term, in every language. */}
                      <span translate="no">{s}</span>
                    </PillCheckbox>
                  ))}
                </div>
              </fieldset>
              <Button>{t('welcome.profile.save')}</Button>
            </form>
          </details>
        </>
      )}
    </StepCard>
  );
};

/* ---------- step 4 ---------- */

const SourcesStep: FC<WelcomeProps> = ({ sources, steps }) => {
  const done = steps.find((s) => s.key === 'sources')?.done ?? false;
  const waiting = sources.suggestions.filter((s) => s.state !== 'on').length;
  return (
    <StepCard n={4} step="sources" done={done}>
      {sources.suggestions.length === 0 ? (
        <p data-ui="hint" class="text-sm text-ink-muted">
          {sources.packs.length > 0
            ? t('welcome.sources.onlyPacks')
            : t('welcome.sources.nothing')}
        </p>
      ) : (
        <>
          <p data-ui="hint" class="text-sm text-ink-muted">
            {t('welcome.sources.intro')}
          </p>
          <ul class="mt-3 divide-y divide-line rounded-md border border-line">
            {sources.suggestions.map((s) => (
              <li class="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                <span class="min-w-0">
                  <span class="block truncate font-medium text-ink" translate="no">
                    {s.name}
                  </span>
                  <span class="block truncate text-note text-ink-faint">{s.reason}</span>
                </span>
                <Badge tone={s.state === 'on' ? 'ok' : 'neutral'}>{t(SOURCE_STATE[s.state])}</Badge>
              </li>
            ))}
          </ul>
        </>
      )}
      {sources.packs.length > 0 && (
        <div class="mt-4">
          <p class="text-label text-ink">{t('welcome.packs.title')}</p>
          <Hint>
            {t('welcome.packs.hint')}
          </Hint>
          <More summary={t('welcome.packs.more')} class="mt-1">
            {/* A pack's name and blurb are the catalog's own (starter-packs/catalog.json), in English. */}
            {sources.packs.map((pack) => (
              <p lang="en">
                <span class="font-medium text-ink-muted">{pack.label}:</span> {pack.blurb}
              </p>
            ))}
          </More>
          <ul class="mt-2 divide-y divide-line rounded-md border border-line">
            {sources.packs.map((p) => (
              <li class="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                <span class="min-w-0">
                  <span class="block font-medium text-ink">
                    <span lang="en">{p.label}</span>{' '}
                    <span class="font-normal text-ink-faint tabular-nums">
                      {t('welcome.packs.count', { count: p.count, tracked: p.tracked })}
                    </span>
                  </span>
                </span>
                <ActionForm action="/companies/starter-pack" hidden={{ segment: p.id, next: 'welcome' }}>
                  <Button size="sm" variant="secondary">
                    {t('welcome.packs.preview')}
                  </Button>
                </ActionForm>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div class="mt-4 flex flex-wrap items-center gap-2">
        {waiting > 0 && (
          <ActionForm action="/companies/suggested/all" hidden={{ next: 'welcome' }} once>
            <Button>{t('welcome.sources.enableAll', { n: waiting })}</Button>
          </ActionForm>
        )}
        <Button href="/welcome?step=matches" variant={waiting > 0 ? 'secondary' : 'primary'}>
          {waiting > 0 ? t('welcome.sources.skip') : t('welcome.continue')}
        </Button>
      </div>
    </StepCard>
  );
};

/* ---------- step 5 ---------- */

const MatchesStep: FC<WelcomeProps> = (p) => {
  const { matches, steps } = p;
  // A pass in flight already scored a few rows — show the running copy, not "0 of 3".
  const done = (steps.find((s) => s.key === 'matches')?.done ?? false) && !matches.runningRunId;
  return (
    <StepCard n={5} step="matches" done={done}>
      {done ? (
        <>
          <p class="text-sm text-ink">
            <MarkIcon kind="check" class="mr-1 inline text-ok" />
            {tRich('welcome.matches.summary', { matches: matches.matchCount, scored: matches.scoredCount, min: matches.minFitScore }, { b: bold })}
            {matches.top.length > 0 && <> {t('welcome.matches.top')}</>}
          </p>
          {matches.top.length > 0 && (
            <ul class="mt-3 divide-y divide-line rounded-md border border-line">
              {matches.top.map((j) => (
                <li>
                  <a
                    href={`/jobs/${j.id}`}
                    class="flex items-center justify-between gap-4 px-4 py-2.5 text-sm transition-colors duration-150 hover:bg-surface-overlay/50"
                  >
                    <span class="min-w-0">
                      <span class="block truncate font-medium text-ink" translate="no">
                        {j.title}
                      </span>
                      <span class="block truncate text-note text-ink-faint" translate="no">
                        {j.companyName}
                      </span>
                    </span>
                    <FitBadge score={j.fitScore} label={t('welcome.matches.badge')} />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {matches.waiting > 0 && (
            <p data-ui="hint" class="mt-3 text-note leading-5 text-ink-faint">
              {t('welcome.matches.waiting', { n: matches.waiting, batch: SCORE_BATCH, cost: matches.scoreCost })}
            </p>
          )}
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <ScoreOrWatch {...p} />
          </div>
        </>
      ) : (
        <>
          <p data-ui="hint" class="text-sm text-ink-muted">
            {t('welcome.matches.intro', { batch: SCORE_BATCH, cost: matches.scoreCost })}
          </p>
          {matches.waiting === 0 && (
            <p class="mt-2 text-note leading-5 text-warn">
              {t('welcome.matches.noneWaiting')}
            </p>
          )}
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <ScoreOrWatch {...p} />
          </div>
        </>
      )}
    </StepCard>
  );
};

/** The score button (or the live-run link), plus the closing "Start the hourly watch". */
const ScoreOrWatch: FC<WelcomeProps> = ({ matches, fetchingEnabled, telegramEnabled, steps }) => {
  const done = steps.find((s) => s.key === 'matches')?.done ?? false;
  return (
    <>
      {matches.runningRunId ? (
        <Button href={`/target/runs/${matches.runningRunId}`} variant="secondary">
          {t('welcome.matches.watch')}
        </Button>
      ) : matches.waiting > 0 ? (
        <ActionForm action="/welcome/score">
          <Button variant="violet">
            {done ? t('welcome.matches.scoreMore', { n: SCORE_BATCH }) : t('welcome.matches.score')}
          </Button>
        </ActionForm>
      ) : null}
      <ActionForm action="/welcome/finish">
        <Button variant={done || matches.waiting === 0 ? 'primary' : 'secondary'}>
          {fetchingEnabled ? t('welcome.finish') : t('welcome.startWatch')}
        </Button>
      </ActionForm>
      {!telegramEnabled && (
        <Hint>
          {tRich('welcome.matches.phone', {}, {
            link: (words) => (
              <a href="/settings?tab=notifications" class={QUIET_LINK}>
                {words}
              </a>
            ),
          })}
        </Hint>
      )}
    </>
  );
};

/* ---------- all done ---------- */

const AllDone: FC<WelcomeProps> = ({ setupCompleted, fetchingEnabled, matches }) => (
  <Card>
    <h2 class="text-entity text-ink">{t('welcome.done.title')}</h2>
    <p data-ui="hint" class="mt-1 text-sm text-ink-muted">
      {t('welcome.done.summary', { n: matches.scoredCount })}{' '}
      {fetchingEnabled
        ? t('welcome.done.watchOn')
        : t('welcome.done.watchOff')}
    </p>
    <div class="mt-4 flex flex-wrap items-center gap-2">
      {setupCompleted && fetchingEnabled ? (
        <Button href="/">{t('welcome.done.overview')}</Button>
      ) : (
        <ActionForm action="/welcome/finish">
          <Button>{fetchingEnabled ? t('welcome.finish') : t('welcome.startWatch')}</Button>
        </ActionForm>
      )}
      {matches.waiting > 0 && (
        <ActionForm action="/welcome/score">
          <Button variant="violet">{t('welcome.matches.scoreMore', { n: SCORE_BATCH })}</Button>
        </ActionForm>
      )}
    </div>
  </Card>
);

/** Step 2's country field: the chip editor, then the gazetteer suggestions on top of it. */
const SEARCH_BOOT = `
import { mountChipEditors } from '/static/chips.mjs';
mountChipEditors();
import { mountCountryPickers } from '/static/countries.mjs';
mountCountryPickers();
`;
