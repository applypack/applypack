/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';
import { Layout } from '../layout';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  Code,
  FILE_INPUT_CLASS,
  Field,
  FitBadge,
  Flash,
  Hint,
  Input,
  MarkIcon,
  PillCheckbox,
  Select,
} from '../ui';
import type { FlashMessage } from '../flash';
import { formatDuration } from '../format';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { SENIORITY_LEVELS } from '../../resume/profile-draft';
import type { AiProviderId } from '../../ai-engine';
import { WELCOME_STEPS, type WelcomeStep } from '../welcome-steps';

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
}

export interface LastSearch {
  fetched: number;
  sources: number;
  failed: number;
  stored: number;
  durationMs: number;
}

export interface ProfileDraftCard {
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
  ai: { engines: EngineStatusRow[] };
  search: { jobCount: number; last: LastSearch | null; runningRunId: string | null };
  profile: {
    id: number;
    name: string;
    stackRequired: string[];
    roleTypes: string[];
    seniority: string[];
    resumes: { id: number; name: string }[];
    draft: ProfileDraftCard | null;
  };
  matches: {
    scoredCount: number;
    matchCount: number;
    minFitScore: number;
    top: TopJob[];
    /** Stored-unscored jobs that fit the profile's words — what one more "Score" press would take. */
    waiting: number;
    runningRunId: string | null;
  };
  flash?: FlashMessage | null;
}

const STEP_TITLES: Record<WelcomeStep, string> = {
  ai: 'Connect an AI',
  search: 'Test the search',
  profile: 'Tell us about you',
  matches: 'See your first matches',
};

/** Plain-language setup cards for the "nothing detected" state, in the order a newcomer reads them. */
const ENGINE_CARDS: { id: AiProviderId; title: string; how: string; env: string | null }[] = [
  {
    id: 'claude_code',
    title: 'I have a Claude subscription',
    how: 'Run `claude setup-token` on your computer, paste the token into .env, then `docker compose up -d`.',
    env: 'CLAUDE_CODE_OAUTH_TOKEN=…',
  },
  {
    id: 'anthropic_api',
    title: 'I have an Anthropic API key',
    how: 'Keys live at console.anthropic.com → API keys. Pays per token — the classifier is cheap.',
    env: 'ANTHROPIC_API_KEY=sk-ant-…',
  },
  {
    id: 'gemini_cli',
    title: 'I have a Gemini key — the free tier works',
    how: 'Get one at aistudio.google.com/apikey.',
    env: 'GEMINI_API_KEY=…',
  },
  {
    id: 'openai_api',
    title: 'OpenAI, OpenRouter, Groq or a local model',
    how: 'Any server that speaks /chat/completions; add OPENAI_BASE_URL for the non-OpenAI ones.',
    env: 'OPENAI_API_KEY=…',
  },
  {
    id: 'codex_cli',
    title: 'I have a ChatGPT subscription',
    how: 'Run `codex login` on your computer and mount ~/.codex into the containers — see docs/ai-engines.md.',
    env: null,
  },
];

export const WelcomePage: FC<WelcomeProps> = (p) => (
  <Layout title="Welcome">
    <header class="mb-6">
      <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div>
          <h1 class="text-xl font-semibold tracking-tight">Welcome to ApplyPack</h1>
          <p class="mt-1 text-[13px] leading-5 text-ink-faint">
            Four short steps: connect an AI, prove the search works, tell us about you, see your
            first matches. Everything here can be changed later in Settings.
          </p>
        </div>
        {!p.setupCompleted && (
          <ActionForm action="/welcome/skip">
            <Button size="sm" variant="ghost" title="Mark setup as done; every step stays reachable in Settings">
              Skip setup
            </Button>
          </ActionForm>
        )}
      </div>
    </header>
    <Flash flash={p.flash} />

    <ol class="mb-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Setup steps">
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
                class={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-medium ${
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
              <span class="truncate">{STEP_TITLES[s.key]}</span>
              {state === 'done' && <span class="sr-only">(done)</span>}
            </a>
          </li>
        );
      })}
    </ol>

    {p.current === 'ai' && <AiStep {...p} />}
    {p.current === 'search' && <SearchStep {...p} />}
    {p.current === 'profile' && <ProfileStep {...p} />}
    {p.current === 'matches' && <MatchesStep {...p} />}
    {p.current === null && <AllDone {...p} />}
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
      <h2 class="text-sm font-semibold text-ink">
        Step {n} — {STEP_TITLES[step]}
      </h2>
      {done && <Badge tone="ok">done</Badge>}
    </div>
    {children}
  </Card>
);

/* ---------- step 1 ---------- */

const AiStep: FC<WelcomeProps> = ({ ai, steps }) => {
  const connected = ai.engines.filter((e) => e.ok);
  const done = steps.find((s) => s.key === 'ai')?.done ?? false;
  return (
    <StepCard n={1} step="ai" done={done}>
      {connected.length > 0 ? (
        <>
          <p class="text-sm text-ink-muted">
            An AI reads every job and scores how well it matches you. Detected on this machine:
          </p>
          <ul class="mt-3 space-y-1.5">
            {connected.map((e) => (
              <li class="flex items-center gap-2 text-sm text-ink">
                <MarkIcon kind="check" class="text-ok" />
                <span class="font-medium">{e.label}</span>
                <span class="text-ink-faint">— {e.detail}</span>
              </li>
            ))}
          </ul>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <Button href="/welcome?step=search">Continue →</Button>
            <ActionForm action="/welcome/ai/test">
              <Button variant="violet" title="One tiny live call — proves the connection end to end">
                Send a test message
              </Button>
            </ActionForm>
            <Hint>Optional: the test takes a few seconds and spends one tiny AI call.</Hint>
          </div>
        </>
      ) : (
        <>
          <p class="text-sm text-ink-muted">
            An AI reads every job and scores how well it matches you. Nothing usable was detected
            yet — pick the one you have, add the line to <Code>.env</Code>, restart with{' '}
            <Code>docker compose up -d</Code> and press Check again.
          </p>
          <ul class="mt-4 grid gap-3 lg:grid-cols-2">
            {ENGINE_CARDS.map((card) => {
              const status = ai.engines.find((e) => e.id === card.id);
              return (
                <li class="rounded-md border border-line px-4 py-3">
                  <div class="text-sm font-medium text-ink">{card.title}</div>
                  <p class="mt-1 text-[13px] leading-5 text-ink-faint">{card.how}</p>
                  {card.env && (
                    <pre class="mt-2 overflow-x-auto rounded bg-surface-overlay px-2.5 py-1.5 font-mono text-xs text-ink">
                      {card.env}
                    </pre>
                  )}
                  {status && (
                    <p class="mt-2 text-xs text-ink-faint">Right now: {status.detail}</p>
                  )}
                </li>
              );
            })}
          </ul>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <Button href="/welcome">Check again</Button>
            <Hint>
              Full instructions per engine:{' '}
              <a
                href="https://github.com/applypack/applypack/blob/main/docs/ai-engines.md"
                class="font-medium text-accent-strong hover:text-accent-deep"
              >
                docs/ai-engines.md
              </a>
              .
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
            <span class="font-medium">{search.jobCount.toLocaleString()} jobs</span> are in your
            database.
            {last && (
              <>
                {' '}
                The last search saw {last.fetched.toLocaleString()} from {last.sources} sources
                {last.failed > 0 ? ` (${last.failed} did not answer)` : ''} in{' '}
                {formatDuration(last.durationMs)} and stored {last.stored.toLocaleString()} new.
              </>
            )}
          </p>
          <p class="mt-1 text-sm text-ink-muted">
            The search works — now let's find the ones that match <em>you</em>.
          </p>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <Button href="/welcome?step=profile">Continue →</Button>
            <ActionForm action="/runs/fetch-now" hidden={{ back: '/welcome' }}>
              <Button variant="secondary">Search again</Button>
            </ActionForm>
          </div>
        </>
      ) : (
        <>
          <p class="text-sm text-ink-muted">
            Does the job search actually work? Find out before setting anything up: this asks
            every enabled job board and stores what it finds — no AI, no profile needed. It takes a
            few minutes; you'll watch the sources answer one by one.
          </p>
          {last && last.fetched === 0 && (
            <p class="mt-2 text-[13px] leading-5 text-warn">
              The last search got nothing from {last.sources} sources — that usually means no
              network. Check the connection and try again; the Companies page shows which boards
              stopped answering.
            </p>
          )}
          <div class="mt-4 flex flex-wrap items-center gap-2">
            {search.runningRunId ? (
              <Button href={`/runs/fetch-now/${search.runningRunId}`}>Watch the search →</Button>
            ) : (
              <ActionForm action="/runs/fetch-now" hidden={{ back: '/welcome' }}>
                <Button>Run a test search</Button>
              </ActionForm>
            )}
          </div>
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
          <p class="text-sm text-ink-muted">From your resume "{d.resumeName}":</p>
          <p class="mt-2 text-sm leading-6 text-ink">
            Looks like you're a <span class="font-medium">{d.title ?? 'software professional'}</span>
            {d.primarySkills.length > 0 && (
              <>
                {' '}
                — main tools <span class="font-medium">{d.primarySkills.join(', ')}</span>
              </>
            )}
            {d.skillCount > 0 && <>, plus {d.skillCount} more skills</>}.{' '}
            We'll hunt for{d.seniority ? ` ${d.seniority}` : ''}{' '}
            {d.roleTypes.length > 0 ? d.roleTypes.join(' / ') : 'matching'} roles using these.
          </p>
          {d.warnings.length > 0 && (
            <p class="mt-2 text-[13px] leading-5 text-warn">Note: {d.warnings.join('; ')}.</p>
          )}
          <div class="mt-4 flex flex-wrap items-center gap-2">
            {d.changed.length > 0 ? (
              <ActionForm action="/welcome/profile/apply" hidden={{ resumeId: d.resumeId }}>
                <Button>Yes, that's me — start matching</Button>
              </ActionForm>
            ) : (
              <Button href="/welcome?step=matches">Continue →</Button>
            )}
            <ActionForm
              action={`/settings/profiles/${profile.id}/fill-from-resume`}
              hidden={{ resumeId: d.resumeId }}
            >
              <Button variant="secondary">Let me adjust</Button>
            </ActionForm>
          </div>
          <Hint class="mt-3">Nothing is saved until you press one of these.</Hint>
        </>
      ) : done ? (
        <>
          <p class="text-sm text-ink">
            <MarkIcon kind="check" class="mr-1 inline text-ok" />
            Profile <span class="font-medium">"{profile.name}"</span> hunts for{' '}
            {profile.roleTypes.length > 0 ? profile.roleTypes.join(' / ') : 'matching'} roles
            {profile.stackRequired.length > 0 && <> built with {profile.stackRequired.join(', ')}</>}.
          </p>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <Button href="/welcome?step=matches">Continue →</Button>
            <Button href="/settings?tab=profile" variant="secondary">
              Adjust in Settings
            </Button>
          </div>
        </>
      ) : (
        <>
          <p class="text-sm text-ink-muted">
            Upload your resume and we'll read the tools you use and the roles you do. Takes about a
            minute; the file stays on your Resumes page for later comparisons and cover letters.
          </p>
          <form
            method="post"
            action="/welcome/resume"
            enctype="multipart/form-data"
            class="mt-4 flex flex-wrap items-end gap-3"
          >
            <Field label="Your resume" hint={`${ACCEPTED_EXTENSIONS.join(', ')} · up to 5 MB`} class="min-w-0 flex-1">
              <input
                type="file"
                name="file"
                accept={ACCEPTED_EXTENSIONS.join(',')}
                required
                class={`block w-full text-sm text-ink-muted ${FILE_INPUT_CLASS}`}
              />
            </Field>
            <Button>Upload your resume</Button>
          </form>
          {profile.resumes.length > 0 && (
            <form method="post" action="/welcome/resume" class="mt-3 flex flex-wrap items-end gap-3">
              <Field label="…or use one you already uploaded" class="min-w-0 flex-1">
                <Select name="resumeId">
                  {profile.resumes.map((r) => (
                    <option value={r.id}>{r.name}</option>
                  ))}
                </Select>
              </Field>
              <Button variant="secondary">Use this resume</Button>
            </form>
          )}
          <details class="mt-5 rounded-md border border-line">
            <summary class="cursor-pointer select-none px-4 py-2.5 text-[13px] font-medium text-ink hover:text-accent-strong">
              No file handy? Answer three questions instead.
            </summary>
            <form method="post" action="/welcome/profile" class="space-y-4 border-t border-line px-4 py-4">
              <Field
                label="Main technologies"
                hint="Languages and frameworks a job must use — comma-separated."
              >
                <Input
                  type="text"
                  name="stackRequired"
                  placeholder="php, laravel, mysql"
                  value={profile.stackRequired.join(', ')}
                />
              </Field>
              <Field label="Role words" hint="Words from job titles you'd apply to.">
                <Input
                  type="text"
                  name="roleTypes"
                  placeholder="backend, full-stack"
                  value={profile.roleTypes.join(', ')}
                />
              </Field>
              <fieldset>
                <legend class="text-[13px] font-medium text-ink">Seniority</legend>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  {SENIORITY_LEVELS.map((s) => (
                    <PillCheckbox name="seniority" value={s} checked={profile.seniority.includes(s)}>
                      {s}
                    </PillCheckbox>
                  ))}
                </div>
              </fieldset>
              <Button>Save and continue</Button>
            </form>
          </details>
        </>
      )}
    </StepCard>
  );
};

/* ---------- step 4 ---------- */

const MatchesStep: FC<WelcomeProps> = (p) => {
  const { matches, steps } = p;
  const done = steps.find((s) => s.key === 'matches')?.done ?? false;
  return (
    <StepCard n={4} step="matches" done={done}>
      {done ? (
        <>
          <p class="text-sm text-ink">
            <MarkIcon kind="check" class="mr-1 inline text-ok" />
            <span class="font-medium">
              {matches.matchCount} of {matches.scoredCount}
            </span>{' '}
            scored jobs look like a match (score {matches.minFitScore} or more).
            {matches.top.length > 0 && ' Top of the list:'}
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
                      <span class="block truncate font-medium text-ink">{j.title}</span>
                      <span class="block truncate text-[13px] text-ink-faint">{j.companyName}</span>
                    </span>
                    <FitBadge score={j.fitScore} label="match" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {matches.waiting > 0 && (
            <p class="mt-3 text-[13px] leading-5 text-ink-faint">
              {matches.waiting.toLocaleString()} more stored jobs fit your words and are still
              unscored.
            </p>
          )}
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <ScoreOrWatch {...p} />
          </div>
        </>
      ) : (
        <>
          <p class="text-sm text-ink-muted">
            The AI reads the jobs we found against your profile and gives each a match score. This
            pass takes up to 100 of the most recent jobs that mention your tools or role words —
            jobs that don't are set aside without spending anything. A few minutes.
          </p>
          {matches.waiting === 0 && (
            <p class="mt-2 text-[13px] leading-5 text-warn">
              None of the stored jobs mention your technologies or role words yet — the hourly watch
              keeps looking once you start it below.
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
        <Button href={`/target/runs/${matches.runningRunId}`} variant="violet">
          Watch the scoring →
        </Button>
      ) : matches.waiting > 0 ? (
        <ActionForm action="/welcome/score">
          <Button variant="violet">{done ? 'Score 100 more' : 'Score the jobs we found'}</Button>
        </ActionForm>
      ) : null}
      <ActionForm action="/welcome/finish">
        <Button variant={done || matches.waiting === 0 ? 'primary' : 'secondary'}>
          {fetchingEnabled ? 'Finish setup' : 'Start the hourly watch'}
        </Button>
      </ActionForm>
      {!telegramEnabled && (
        <Hint>
          Want new matches on your phone? Set up Telegram later in{' '}
          <a href="/settings?tab=notifications" class="font-medium text-accent-strong hover:text-accent-deep">
            Settings → Notifications
          </a>
          .
        </Hint>
      )}
    </>
  );
};

/* ---------- all done ---------- */

const AllDone: FC<WelcomeProps> = ({ setupCompleted, fetchingEnabled, matches }) => (
  <Card>
    <h2 class="text-sm font-semibold text-ink">Everything is set up</h2>
    <p class="mt-1 text-sm text-ink-muted">
      AI connected, {matches.scoredCount.toLocaleString()} jobs scored, profile filled.{' '}
      {fetchingEnabled
        ? 'The hourly watch is running — new matches land on the Overview.'
        : 'The hourly watch is paused; start it to keep the matches coming.'}
    </p>
    <div class="mt-4 flex flex-wrap items-center gap-2">
      {setupCompleted && fetchingEnabled ? (
        <Button href="/">Go to the Overview →</Button>
      ) : (
        <ActionForm action="/welcome/finish">
          <Button>{fetchingEnabled ? 'Finish setup' : 'Start the hourly watch'}</Button>
        </ActionForm>
      )}
      {matches.waiting > 0 && (
        <ActionForm action="/welcome/score">
          <Button variant="violet">Score 100 more</Button>
        </ActionForm>
      )}
    </div>
  </Card>
);
