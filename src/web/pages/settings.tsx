/** @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import type { Profile } from '@prisma/client';
import { Layout } from '../layout';
import { ActionForm, Badge, Button, Card, Code, Empty, Field, FILE_INPUT_CLASS, Flash, Hint, Input, More, PageHeader, PillCheckbox, Radio, SectionTitle, Select, Table, Tag, Td, Textarea, ToggleRow, Tr, TagListInput } from '../ui';
import { formatRelative } from '../format';
import type { FlashMessage } from '../flash';
import { describeCount, type SourceGroup } from '../source-groups';
import { dotClassFor, MAX_WORK_STAGES } from '../stage-config';
import { formatPriorityRulesText, parsePriorityRules } from '../../priority-rules';
import { COUNTRIES, REGIONS, flagOf, placeLabel } from '../../countries';
import { RELOCATION_CODES, RELOCATION_LABEL } from '../../eligibility';
import { PROFILE_WORKPLACES, WORKPLACE_LABEL } from '../../location';
import { isBlankProfile, MAX_ACTIVE_PROFILES } from '../../profile-guards';
import { SENIORITY_LEVELS } from '../../resume/profile-draft';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MAX_UPLOAD_MB } from '../upload';
import { ALERT_MODES, ALL_DAYS, DAY_LABELS, FETCH_EVERY, MAX_DIGEST_HOURS, describeSchedule, type Schedule } from '../../user-schedule';
import { KIND_LABEL } from '../../notify/targets';
import { SCHEDULE_HREF, type HeldLine } from '../held-line';

interface MaskedTarget {
  id: number;
  name: string;
  kind: TargetKind;
  /** The token / chat or the webhook, its secret masked (notify/targets.ts). */
  destination: string;
  active: boolean;
  createdAt: Date;
  lastUsed: Date | null;
}

interface ProfileListItem {
  id: number;
  name: string;
  /** Running: scored on every tick, alerts on its own threshold (ADR 0028). */
  running: boolean;
  /** The primary — supplies defaults everywhere, and always runs. */
  primary: boolean;
  /** No required stack and no role types — running is gated (issue #50). */
  blank: boolean;
}

type TargetKind = keyof typeof KIND_LABEL;

interface AvailableTarget {
  id: number;
  name: string;
  kind: TargetKind;
  active: boolean;
}

interface ResumeListItem {
  id: number;
  name: string;
  isDefault: boolean;
  scannedAt: Date | null;
}

export interface AiEngineRow {
  id: string;
  label: string;
  desc: string;
  ok: boolean;
  detail: string;
  enabled: boolean;
  /** Index in the priority chain; -1 when disabled. */
  position: number;
  /** Not enabled, but answering every call because nothing enabled can run here. */
  lastResort: boolean;
  /** False when Disable would store the same list again — the .env engine alone in it. */
  canToggle: boolean;
  classifierModel: string;
  resumeModel: string;
  coverModel: string;
  classifierDefault: string;
  resumeDefault: string;
  coverDefault: string;
  /** Family model ids for the selects; empty = free-text input. */
  options: string[];
  freeTextModels: boolean;
  /** Metered billing — every call costs money (vs a flat subscription). */
  paid: boolean;
  /** The .env variable this engine's key mirrors; null = login-only engine. */
  keyEnvVar: string | null;
  /** Where the credential comes from right now (ADR 0027). */
  keySource: 'db' | 'env' | 'none';
  /** Last four characters of the stored key — never the key itself. */
  maskedKey: string;
}

/** Everything the Schedule card renders, resolved by the route (TASKS §16). */
export interface ScheduleView {
  schedule: Schedule;
  /** IANA zones the runtime knows, for the picker. */
  zones: string[];
  /** "today at 14:05" — already formatted in the schedule's own zone. */
  nextFetch: string;
  /** Matches waiting to be sent — for the window, for Alerts, for a chat — or null. */
  held: HeldLine | null;
}

export interface AiStatusSummary {
  active: string;
  chain: string[];
  skipped: string[];
  usage7d: { label: string; classifier: number; resume: number; cover: number }[];
}

/**
 * Link-based sub-navigation (?tab=…): one route, server picks the sections.
 * POST routes redirect back to the tab their setting lives on.
 */
const SETTINGS_TABS = [
  { id: 'general', label: 'General' },
  { id: 'profile', label: 'Profile' },
  { id: 'ai', label: 'AI engine' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'sources', label: 'Sources' },
  { id: 'screening', label: 'Screening' },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

export function isSettingsTab(value: unknown): value is SettingsTab {
  return SETTINGS_TABS.some((t) => t.id === value);
}


/** What "Fill from resume" replaced — rendered as an unsaved-draft notice. */
export interface ProfileDraftNotice {
  resumeName: string;
  changed: string[];
  warnings: string[];
}

export interface SettingsProps {
  telegramEnabled: boolean;
  classifierMode: 'single' | 'two_stage';
  applicationTrackingEnabled: boolean;
  /** Full funnel order with job counts; fixed rows carry no edit controls. */
  pipelineStages: { key: string; label: string; count: number; fixed: boolean }[];
  staleApplicationsDigestEnabled: boolean;
  sourceHealthAlerts: boolean;
  disabledSources: string[];
  /** ADR 0034: the keyed sources' credential rows — origins and masks only, never a value. */
  sourceKeyRows: SourceKeyRow[];
  sourceGroups: SourceGroup[];
  fetchingEnabled: boolean;
  schedule: ScheduleView;
  aiEngines: AiEngineRow[];
  aiStatus: AiStatusSummary;
  targets: MaskedTarget[];
  profiles: ProfileListItem[];
  activeProfile: Profile | null;
  availableTargets: AvailableTarget[];
  resumes: ResumeListItem[];
  /** Employer mode (ADR 0049) and its guardrails (ADR 0048). */
  screening: ScreeningSettings;
  activeTab: SettingsTab;
  flash?: FlashMessage | null;
  /** Set by the fill-from-resume POST: the editor shows draft values. */
  profileDraft?: ProfileDraftNotice | null;
}

export interface ScreeningSettings {
  enabled: boolean;
  retentionDays: number;
  retentionMin: number;
  retentionMax: number;
  /** The engine the calls would go to, and whether it is a personal subscription (guardrail 5). */
  engineLabel: string;
  engineSubscription: boolean;
  screenings: number;
  notice: string;
  legalNote: string;
}

/**
 * A settings section: its title and one sentence above its controls; what else
 * is worth knowing sits behind "How this works" (DESIGN.md, the Disclosure Rule).
 */
const Section: FC<PropsWithChildren<{ title: string; desc?: string | Child; more?: Child }>> = ({
  title,
  desc,
  more,
  children,
}) => (
  <section class="border-t border-line py-7 first:border-t-0 first:pt-0">
    <h2 class="text-section text-ink">{title}</h2>
    {desc && <p data-ui="hint" class="mt-1 text-sm leading-5 text-ink-muted">{desc}</p>}
    {more && <More class="mt-1">{more}</More>}
    <div class="mt-4 min-w-0 space-y-4">{children}</div>
  </section>
);


/**
 * The Schedule card (TASKS §16.3). Whole hours only, one time zone for
 * everything the user sees, and every control saves with the form — no
 * JavaScript, so the day pills are plain checkboxes and the route reads them
 * with `parseBody({ all: true })` (gotcha 1).
 */
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const HourSelect: FC<{ name: string; value: number; label: string; hint?: string }> = ({ name, value, label, hint }) => (
  <Field label={label} hint={hint} class="w-40">
    <Select name={name}>
      {HOURS.map((h) => (
        <option value={String(h)} selected={h === value}>
          {String(h).padStart(2, '0')}:00
        </option>
      ))}
    </Select>
  </Field>
);

const DayPills: FC<{ name: string; days: readonly number[] }> = ({ name, days }) => (
  <fieldset class="mt-1.5">
    <legend class="sr-only">Days</legend>
    <div class="flex flex-wrap gap-1.5">
      {ALL_DAYS.map((d) => (
        <PillCheckbox name={name} value={String(d)} checked={days.includes(d)}>
          {DAY_LABELS[d - 1]}
        </PillCheckbox>
      ))}
    </div>
  </fieldset>
);

const EVERY_LABEL: Record<(typeof FETCH_EVERY)[number], string> = {
  hour: 'Every hour',
  '2h': 'Every 2 hours',
  '4h': 'Every 4 hours',
  day: 'Once a day',
};

const ALERT_MODE_TITLE: Record<(typeof ALERT_MODES)[number], string> = {
  instant: 'Right away',
  window: 'Only during these hours',
  digest: 'As one digest',
};

const ScheduleCard: FC<{ view: ScheduleView }> = ({ view }) => {
  const { schedule: s, zones, nextFetch, held } = view;
  return (
    <Card>
      <form method="post" action="/settings/schedule" class="space-y-5">
        <Field label="Time zone" hint="One zone for every hour on this card." class="max-w-sm">
          <Select name="timezone">
            {zones.map((z) => (
              <option value={z} selected={z === s.timezone}>
                {z}
              </option>
            ))}
          </Select>
        </Field>

        <div class="border-t border-line pt-4">
          <div class="text-label text-ink">Check for jobs</div>
          <Hint class="mt-0.5 mb-2">
            {describeSchedule(s)}
            {nextFetch ? ` · next check ${nextFetch}` : ''}
          </Hint>
          <div class="flex flex-wrap items-end gap-3">
            <Field label="How often" class="w-44">
              <Select name="fetchEvery">
                {FETCH_EVERY.map((e) => (
                  <option value={e} selected={e === s.fetch.every}>
                    {EVERY_LABEL[e]}
                  </option>
                ))}
              </Select>
            </Field>
            <HourSelect name="fetchFrom" value={s.fetch.from} label="From" />
            <HourSelect name="fetchTo" value={s.fetch.to} label="To (inclusive)" />
          </div>
          <DayPills name="fetchDays" days={s.fetch.days} />
          <Hint class="mt-2">"Fetch now" ignores the schedule.</Hint>
        </div>

        <div class="border-t border-line pt-4">
          <div class="text-label text-ink">Send alerts</div>
          {held && (
            <Hint class="mt-0.5 text-warn">
              {held.text}
              {/* The window is this card; any other reason is set elsewhere. */}
              {held.href === SCHEDULE_HREF ? '.' : (
                <>
                  {' — '}
                  <a href={held.href} class="font-medium underline">{held.action}</a>.
                </>
              )}
            </Hint>
          )}
          <div class="mt-2 grid gap-2 sm:grid-cols-3">
            {ALERT_MODES.map((mode) => (
              <Radio
                name="alertMode"
                value={mode}
                checked={mode === s.alerts.mode}
                title={ALERT_MODE_TITLE[mode]}
              >
                {mode === 'instant'
                  ? 'One message per match, as soon as it is scored.'
                  : mode === 'window'
                    ? 'Matches found outside the hours arrive in one message when it opens.'
                    : 'Everything comes at the digest times below.'}
              </Radio>
            ))}
          </div>
          <div class="mt-4 border-t border-line pt-3">
            <Hint>These hours and days apply to "Only during these hours".</Hint>
            <div class="mt-2 flex flex-wrap items-end gap-3">
              <HourSelect name="alertFrom" value={s.alerts.from} label="Alerts from" />
              <HourSelect name="alertTo" value={s.alerts.to} label="Until (inclusive)" />
            </div>
            <DayPills name="alertDays" days={s.alerts.days} />
          </div>
          <Field
            label="Digest times"
            hint={`Up to ${MAX_DIGEST_HOURS}; the daily recap and the stale-application nudge go out then too.`}
            class="mt-3"
          >
            <div class="flex flex-wrap gap-1.5">
              {HOURS.map((h) => (
                <PillCheckbox name="digestAt" value={String(h)} checked={s.alerts.digestAt.includes(h)}>
                  {String(h).padStart(2, '0')}
                </PillCheckbox>
              ))}
            </div>
          </Field>
        </div>

        <Button type="submit">Save schedule</Button>
      </form>
    </Card>
  );
};

export const SettingsPage: FC<SettingsProps> = ({
  telegramEnabled,
  classifierMode,
  applicationTrackingEnabled,
  pipelineStages,
  staleApplicationsDigestEnabled,
  sourceHealthAlerts,
  disabledSources,
  sourceKeyRows,
  sourceGroups,
  fetchingEnabled,
  schedule,
  aiEngines,
  aiStatus,
  targets,
  profiles,
  activeProfile,
  availableTargets,
  resumes,
  screening,
  activeTab,
  flash,
  profileDraft,
}) => (
  <Layout title="Settings" active="settings">
    <div class="w-full">
      <PageHeader title="Settings">
        Saved changes reach the background worker within the hour.
      </PageHeader>
      <Flash flash={flash} />

      <div class="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
      {/* One nav, two shapes: a segmented row below lg, a sticky column of links from lg —
          a rule down its side, the current tab marked on it. Same URLs, same order. */}
      <nav
        aria-label="Settings sections"
        class="mb-6 inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface-overlay p-0.5 lg:sticky lg:top-0 lg:mb-0 lg:flex lg:flex-col lg:gap-0 lg:self-start lg:rounded-none lg:border-0 lg:border-l lg:bg-transparent lg:p-0"
      >
        {SETTINGS_TABS.map((t) => (
          <a
            href={`/settings?tab=${t.id}`}
            aria-current={t.id === activeTab ? 'page' : undefined}
            class={`rounded-[6px] px-3 py-1.5 text-[13px] transition-colors duration-150 lg:-ml-px lg:rounded-none lg:border-l-2 lg:py-1.5 lg:pl-3 lg:text-sm ${
              t.id === activeTab
                ? 'bg-surface-raised font-medium text-ink shadow-sm lg:border-accent-strong lg:bg-transparent lg:shadow-none'
                : 'text-ink-muted hover:text-ink lg:border-transparent lg:hover:border-line-strong'
            }`}
          >
            {t.label}
          </a>
        ))}
      </nav>

      <div class="min-w-0">
      {/* Sections are declared in one flow; activeTab picks which render. */}
      {activeTab === 'general' && (
      <Section title="Job fetching">
        <Card>
          <ToggleRow
            label="Pipeline"
            enabled={fetchingEnabled}
            action="/settings/fetching-toggle"
            onLabel="Running"
            offLabel="Paused"
            enableText="Resume"
            disableText="Pause"
            more="The pipeline is the hourly fetch and the monthly “Who is hiring” pull from Hacker News."
          >
            Pausing stops new jobs and alerts; the dashboard, digests and cleanup keep running.
          </ToggleRow>
        </Card>
      </Section>
      )}

      {activeTab === 'general' && (
      <Section title="Schedule">
        <ScheduleCard view={schedule} />
      </Section>
      )}

      {activeTab === 'profile' && (
      <Section
        title="Profile"
        desc="One AI call scores every posting against every running search."
      >
        {/* Order follows the user's journey: contextual warnings → fill from a
            resume → the editor → profile management last (docs/onboarding-plan.md §3). */}
        {profiles.some((p) => p.running && p.blank) && profiles.every((p) => !p.running || p.blank) && (
          <div class="rounded-md border border-warn/25 bg-warn/5 px-3.5 py-2.5 text-[13px] leading-5 text-warn">
            Every running search is empty — classification idle. New jobs are fetched but
            not scored or alerted until one lists a required stack or role types.
            {resumes.length > 0
              ? ' Fastest fix: fill the fields from a resume below.'
              : ' Fastest fix: upload a resume below and fill the fields from it.'}
          </div>
        )}
        {activeProfile && !profiles.some((p) => p.id === activeProfile.id && p.running) && (
          <div class="rounded-md border border-line bg-surface-overlay px-3.5 py-2.5 text-[13px] leading-5 text-ink-muted">
            Editing a paused search — it scores nothing until you press Run below.
            {isBlankProfile(activeProfile) &&
              ' It starts running automatically on the first save with a required stack or role types.'}
          </div>
        )}
        {activeProfile && (
          <Card>
            <div class="mb-1 text-entity text-ink">Fill from a resume</div>
            {resumes.length > 0 ? (
              <>
                <Hint>
                  AI drafts the fields below from a resume; nothing is saved until you press "Save
                  profile".
                </Hint>
                <More class="mb-3 mt-1">
                  The resume's primary stack goes to required, its other skills to nice-to-have, plus
                  role types and seniority. The resume is scanned again when its scan is out of date.
                </More>
                <form
                  method="post"
                  action={`/settings/profiles/${activeProfile.id}/fill-from-resume`}
                  class="flex flex-wrap items-center gap-2"
                >
                  <Select
                    name="resumeId"
                    class="!w-auto min-w-0 max-w-full"
                    aria-label="Resume to fill the profile from"
                  >
                    {resumes.map((r) => (
                      <option value={r.id} selected={r.isDefault}>
                        {r.name}
                        {r.isDefault ? ' (default)' : ''}
                        {r.scannedAt ? '' : ' (not scanned yet)'}
                      </option>
                    ))}
                  </Select>
                  <Button variant="violet">Fill from resume</Button>
                </form>
              </>
            ) : (
              <>
                <Hint>
                  Pick a file ({ACCEPTED_EXTENSIONS.join(', ')} · up to {MAX_UPLOAD_MB} MB): one AI
                  call, about half a minute, drafts the fields below. Nothing is saved until you
                  press "Save profile".
                </Hint>
                <More class="mb-3 mt-1">
                  The resume's primary stack goes to required, its other skills to nice-to-have, plus
                  role types and seniority. The file also lands in Resumes.
                </More>
                <form
                  method="post"
                  action={`/settings/profiles/${activeProfile.id}/fill-from-resume`}
                  enctype="multipart/form-data"
                  class="flex flex-wrap items-center gap-2"
                >
                  <Input
                    type="file"
                    name="file"
                    required
                    accept={ACCEPTED_EXTENSIONS.join(',')}
                    aria-label="Resume file"
                    class={`!w-auto min-w-0 max-w-full ${FILE_INPUT_CLASS}`}
                  />
                  <Button variant="violet">Upload &amp; fill</Button>
                </form>
              </>
            )}
          </Card>
        )}
        {activeProfile ? (
          <Card>
            <ProfileEditor
              profile={activeProfile}
              availableTargets={availableTargets}
              resumes={resumes}
              draft={profileDraft}
            />
          </Card>
        ) : (
          <Empty title="No search selected">
            The editor opens one search at a time. Pick one under Searches below, or create a new one there.
          </Empty>
        )}
        <div class="space-y-2">
          <div class="text-entity text-ink">Searches</div>
          <Hint>
            Each running search has its own threshold and alert target. Up to{' '}
            {MAX_ACTIVE_PROFILES} at once.
          </Hint>
          <ul class="divide-y divide-line rounded-md border border-line">
            {profiles.map((p) => (
              <li class="flex flex-wrap items-center gap-2 px-3 py-2">
                <span
                  class={`h-1.5 w-1.5 shrink-0 rounded-full ${p.running ? 'bg-ok' : 'bg-line-strong'}`}
                  aria-hidden="true"
                />
                {/* On a narrow screen the name takes its own line — the row's
                    four actions otherwise squeeze it down to "S…". */}
                <span class="min-w-0 basis-[calc(100%-1.5rem)] truncate text-[13px] text-ink sm:basis-0 sm:flex-1">
                  {p.name}
                  {p.primary && (
                    <span class="ml-1.5 text-xs text-ink-faint">· primary</span>
                  )}
                  {p.blank && (
                    <span class="ml-1.5 text-xs text-warn">· empty, fill it in first</span>
                  )}
                  {!p.running && !p.blank && (
                    <span class="ml-1.5 text-xs text-ink-faint">· paused</span>
                  )}
                </span>
                <a
                  href={`/settings?tab=profile&profile=${p.id}`}
                  class="text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  Edit
                </a>
                {!p.primary && (
                  <ActionForm
                    action="/settings/profiles/active"
                    hidden={{ id: p.id, active: p.running ? '' : '1' }}
                  >
                    <Button variant="secondary" size="sm" disabled={p.blank && !p.running}>
                      {p.running ? 'Pause' : 'Run'}
                    </Button>
                  </ActionForm>
                )}
                {!p.primary && (
                  <ActionForm action="/settings/profiles/activate" hidden={{ id: p.id }}>
                    <Button variant="secondary" size="sm" disabled={p.blank}>
                      Make primary
                    </Button>
                  </ActionForm>
                )}
                {!p.primary && (
                  <ActionForm action="/settings/profiles/delete" hidden={{ id: p.id }}>
                    <Button
                      variant="danger"
                      size="sm"
                      onclick="return confirm('Delete this search? This cannot be undone.')"
                    >
                      Delete
                    </Button>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <ActionForm action="/settings/profiles/new">
            <Button variant="secondary">+ New search</Button>
          </ActionForm>
        </div>
      </Section>
      )}

      {activeTab === 'ai' && (
      <>
      <Section
        title="AI engines"
        desc="In priority order: #1 serves every call, and the next enabled engine takes over when it errors or hits a rate limit."
        more="An engine is an AI subscription or an API key of yours. How to set each one up, locally and in Docker: docs/ai-engines.md in the repo."
      >
        <div class="space-y-3">
          <div class="text-[13px] text-ink-muted">
            Active now: <span class="font-medium text-ink">{aiStatus.active}</span>
            {aiStatus.chain.length > 1 && (
              <span> → fallback: {aiStatus.chain.slice(1).join(' → ')}</span>
            )}
          </div>
          <div class="text-[13px] text-ink-faint">
            Last 7 days:{' '}
            {aiStatus.usage7d.length === 0
              ? 'no AI calls recorded yet'
              : aiStatus.usage7d
                  .map(
                    (u) =>
                      `${u.label} ${u.classifier + u.resume + u.cover} (${u.classifier} classify · ${u.resume} resume · ${u.cover} letter)`,
                  )
                  .join(' — ')}
          </div>
          {aiStatus.skipped.length > 0 && (
            <div class="rounded-md border border-warn/25 bg-warn/5 px-3.5 py-2.5 text-[13px] leading-5 text-warn">
              Enabled but skipped for now: {aiStatus.skipped.join(', ')} — not usable on this
              host yet. Each joins the chain automatically once its key or login appears.
            </div>
          )}
          {aiEngines.map((e) => (
            <AiEngineCard engine={e} />
          ))}
        </div>
      </Section>

      <Section
        title="Classifier"
        desc="What each fetched job costs before it reaches you."
      >
        <Card>
          <form method="post" action="/settings/classifier-mode" class="space-y-2">
            <Radio
              name="mode"
              value="single"
              checked={classifierMode === 'single'}
              title="Single stage"
            >
              Every job goes straight to the full classifier. Highest precision, full cost.
            </Radio>
            <Radio
              name="mode"
              value="two_stage"
              checked={classifierMode === 'two_stage'}
              title="Two stage (cheaper)"
            >
              A short yes/no prefilter gates the full classifier. When most fetched jobs are
              off-target, spend drops ~30-40% with marginal precision loss.
            </Radio>
            <div class="pt-2">
              <Button variant="secondary">Save mode</Button>
            </div>
          </form>
        </Card>
      </Section>
      </>
      )}

      {activeTab === 'general' && (
      <Section title="Application tracking">
        <Card>
          <div class="space-y-5">
            <ToggleRow
              label="Tracking"
              enabled={applicationTrackingEnabled}
              action="/settings/application-tracking-toggle"
            >
              The tracking card on each job and the Applications board; off keeps what is stored.
            </ToggleRow>
            <div class="border-t border-line pt-5">
              <ToggleRow
                label="Stale digest"
                enabled={staleApplicationsDigestEnabled}
                action="/settings/stale-digest-toggle"
              >
                A daily nudge for applications with no recruiter contact for 14+ days; off while
                alerts are off.
              </ToggleRow>
            </div>
          </div>
        </Card>
      </Section>
      )}

      {activeTab === 'general' && (
      <div id="stages" class="scroll-mt-4">
      <Section
        title="Board columns"
        desc="Applied and the two Closed columns are fixed; the ones between are yours."
      >
        <Card>
          <ul class="divide-y divide-line">
            {pipelineStages.map((s, i) => {
              const work = pipelineStages.filter((x) => !x.fixed);
              const prevFixed = pipelineStages[i - 1]?.fixed ?? true;
              const nextFixed = pipelineStages[i + 1]?.fixed ?? true;
              return (
                <li class="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0">
                  <span
                    class={`h-2 w-2 shrink-0 rounded-full ${dotClassFor(work, s.key)}`}
                    aria-hidden="true"
                  />
                  {s.fixed ? (
                    <>
                      <span class="min-w-0 flex-1 text-sm text-ink">{s.label}</span>
                      <span class="text-xs tabular-nums text-ink-faint">
                        {s.count} job{s.count === 1 ? '' : 's'}
                      </span>
                      <span class="rounded-full border border-line px-2 py-0.5 text-xs text-ink-faint">
                        fixed
                      </span>
                    </>
                  ) : (
                    <>
                      <form
                        method="post"
                        action={`/settings/stages/${s.key}/rename`}
                        class="flex min-w-0 flex-1 items-center gap-1.5"
                      >
                        <Input
                          name="label"
                          value={s.label}
                          required
                          maxlength={40}
                          aria-label={`Rename ${s.label}`}
                          class="max-w-[14rem]"
                        />
                        <Button size="sm" variant="ghost" aria-label={`Save name for ${s.label}`}>
                          Save
                        </Button>
                      </form>
                      <span class="text-xs tabular-nums text-ink-faint">
                        {s.count} job{s.count === 1 ? '' : 's'}
                      </span>
                      <ActionForm action={`/settings/stages/${s.key}/move`} hidden={{ dir: 'up' }}>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={prevFixed || undefined}
                          aria-label={`Move ${s.label} up`}
                        >
                          ↑
                        </Button>
                      </ActionForm>
                      <ActionForm action={`/settings/stages/${s.key}/move`} hidden={{ dir: 'down' }}>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={nextFixed || undefined}
                          aria-label={`Move ${s.label} down`}
                        >
                          ↓
                        </Button>
                      </ActionForm>
                      {s.count === 0 && work.length > 1 ? (
                        <ActionForm
                          action={`/settings/stages/${s.key}/remove`}
                          confirm={`Delete the "${s.label}" column?`}
                        >
                          <Button size="sm" variant="danger" aria-label={`Delete ${s.label}`}>
                            Delete
                          </Button>
                        </ActionForm>
                      ) : (
                        <span class="text-xs text-ink-faint">
                          {s.count > 0 ? 'move jobs out to delete' : 'last column'}
                        </span>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {pipelineStages.filter((s) => !s.fixed).length < MAX_WORK_STAGES ? (
            <form
              method="post"
              action="/settings/stages/add"
              class="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4"
            >
              <Input
                name="label"
                placeholder="e.g. Take-home"
                required
                maxlength={40}
                aria-label="New column name"
                class="max-w-[14rem]"
              />
              <Button size="sm">Add column</Button>
            </form>
          ) : (
            <Hint class="mt-4 border-t border-line pt-4">
              Column limit ({MAX_WORK_STAGES}) reached — remove one to add another.
            </Hint>
          )}
        </Card>
      </Section>
      </div>
      )}

      {activeTab === 'notifications' && (
      <Section
        title="Notifications"
        desc="Telegram chats and Discord webhooks that receive job alerts."
      >
        <Card>
          {/* Same spacing and rule as the General tab's toggle pair: bare
              siblings here had the two rows touching, so the second row's
              button looked like it belonged to the first. */}
          <div class="space-y-5">
            <ToggleRow label="Alerts" enabled={telegramEnabled} action="/settings/telegram-toggle">
              Off sends nothing to any target; what is found meanwhile waits, and arrives in one message per chat when you switch it back on.
            </ToggleRow>
            <div class="border-t border-line pt-5">
              <ToggleRow
                label="Source health alerts"
                enabled={sourceHealthAlerts}
                action="/settings/source-health-toggle"
                more="A board usually goes quiet because its slug was rotated. The quiet-sources card on Companies shows it whether this is on or off."
              >
                One line in the daily digest when a tracked board stops answering.
              </ToggleRow>
            </div>
          </div>
        </Card>

        {targets.length === 0 ? (
          <Empty title="No targets yet">
            An alert has nowhere to go until a target exists. Add a Telegram chat or a Discord webhook below.
          </Empty>
        ) : (
          <Card flush>
            <Table
              columns={[
                'Name',
                'Channel',
                'Destination',
                'Last used',
                'Active',
                <span class="block text-right">Actions</span>,
              ]}
            >
              {targets.map((t) => (
                <Tr>
                  <Td class="font-medium text-ink">{t.name}</Td>
                  <Td>
                    <Badge tone="neutral">{KIND_LABEL[t.kind]}</Badge>
                  </Td>
                  <Td class="font-mono text-xs text-ink-muted">{t.destination}</Td>
                  <Td class="whitespace-nowrap text-[13px] text-ink-faint">
                    {formatRelative(t.lastUsed)}
                  </Td>
                  <Td>
                    <ActionForm action={`/settings/targets/${t.id}/toggle`}>
                      {/* The badge shows the state; the button's name says the action and its
                          object — "Toggle" told a screen reader neither (audit A11Y-4). */}
                      <button
                        type="submit"
                        class="cursor-pointer rounded-full"
                        aria-label={`${t.active ? 'Disable' : 'Enable'} ${t.name}`}
                        title={`${t.active ? 'Disable' : 'Enable'} ${t.name}`}
                      >
                        <Badge tone={t.active ? 'ok' : 'neutral'}>
                          {t.active ? 'Active' : 'Disabled'}
                        </Badge>
                      </button>
                    </ActionForm>
                  </Td>
                  <Td>
                    <div class="flex justify-end gap-2">
                      <ActionForm action={`/settings/targets/${t.id}/test`}>
                        <Button size="sm" variant="secondary">
                          Test
                        </Button>
                      </ActionForm>
                      <ActionForm
                        action={`/settings/targets/${t.id}/delete`}
                        confirm="Delete this target?"
                      >
                        <Button size="sm" variant="danger">
                          Delete
                        </Button>
                      </ActionForm>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Table>
          </Card>
        )}

        <div class="grid gap-4 lg:grid-cols-2">
          <Card>
            <div class="mb-3 text-entity text-ink">Add a Telegram target</div>
            <form method="post" action="/settings/targets" class="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="kind" value="telegram" />
              <Field label="Name">
                <Input type="text" name="name" required placeholder="My phone" />
              </Field>
              <Field label="Chat id">
                <Input type="text" name="chatId" required placeholder="-100…" mono />
              </Field>
              <Field label="Bot token" class="sm:col-span-2">
                <Input
                  type="password"
                  name="botToken"
                  required
                  autocomplete="off"
                  placeholder="123456789:ABC…"
                  mono
                />
              </Field>
              <div class="sm:col-span-2">
                <Button>Add target</Button>
              </div>
            </form>
            <Hint class="mt-3">ApplyPack sends a test message before saving.</Hint>
          </Card>
          <Card>
            <div class="mb-3 text-entity text-ink">Add a Discord webhook</div>
            <form method="post" action="/settings/targets" class="grid gap-3">
              <input type="hidden" name="kind" value="discord" />
              <Field label="Name">
                <Input type="text" name="name" required placeholder="#job-alerts" />
              </Field>
              <Field
                label="Webhook URL"
                more="In Discord: Server settings → Integrations → Webhooks → New webhook → Copy URL."
              >
                <Input
                  type="password"
                  name="webhookUrl"
                  required
                  autocomplete="off"
                  placeholder="https://discord.com/api/webhooks/…"
                  mono
                />
              </Field>
              <div>
                <Button>Add webhook</Button>
              </div>
            </form>
            <Hint class="mt-3">
              ApplyPack posts a test message before saving. The URL is a secret: anyone holding it
              can post to the channel.
            </Hint>
          </Card>
        </div>
      </Section>
      )}

      {activeTab === 'sources' && (
      <Section
        title="Job sources"
        desc="Switch a whole source family off; per-company toggles on Companies still apply."
      >
        <Card>
          <form method="post" action="/settings/sources" class="space-y-4">
            {sourceGroups.map((g) => (
              <div>
                <div class="text-label text-ink">{g.title}</div>
                <p data-ui="hint" class="mb-2 text-xs leading-5 text-ink-faint">{g.caption}</p>
                <div class="flex flex-wrap gap-1.5">
                  {g.pills.map((p) => (
                    <PillCheckbox name="enabled" value={p.atsType} checked={!disabledSources.includes(p.atsType)}>
                      {p.label}
                      <span data-ui="hint" class="text-xs text-ink-faint">
                        {p.locked ? (
                          <a href="#source-keys" class="text-warn hover:underline">
                            needs a key
                          </a>
                        ) : (
                          describeCount(p, g.family)
                        )}
                      </span>
                    </PillCheckbox>
                  ))}
                </div>
              </div>
            ))}
            <Hint>
              Keep the aggregators on: they carry the companies you do not track, and turning them
              off usually means near-zero new jobs.
            </Hint>
            <Button variant="secondary">Save sources</Button>
          </form>
        </Card>
        <SourceKeysCard rows={sourceKeyRows} />
      </Section>
      )}

      {activeTab === 'general' && (
      <Section
        title="Resumes"
        desc="The resumes you send out."
      >
        <Card>
          {resumes.length > 0 ? (
            <ul class="divide-y divide-line rounded-md border border-line">
              {resumes.map((r) => (
                <li class="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-sm">
                  <a
                    href={`/resumes/${r.id}`}
                    class="font-medium text-ink transition-colors duration-150 hover:text-accent-strong"
                  >
                    {r.name}
                  </a>
                  {r.isDefault && <Badge tone="ok">default</Badge>}
                  {!r.scannedAt && <Badge tone="warn">not scanned</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty bare title="No resumes yet">
              A job page compares and drafts a letter from a resume. Upload one on the Resumes page.
            </Empty>
          )}
          <a href="/resumes" class="mt-3 inline-block text-[13px] font-medium text-accent-strong hover:text-accent-deep">
            Upload &amp; manage resumes →
          </a>
        </Card>
      </Section>
      )}

      {activeTab === 'screening' && (
      <Section
        title="Employer mode"
        desc="The other side of the table: rank a folder of resumes against one position. Off by default, because it reads other people's data."
      >
        <Card>
          <ToggleRow
            label="Employer mode"
            enabled={screening.enabled}
            action="/settings/employer-mode-toggle"
            onLabel="On"
            offLabel="Off"
            enableText="Turn on"
            disableText="Turn off"
            more="A screening is one position and its applicants: the posting is read into a rubric you edit, every resume is stripped of the person before a model reads it, one independent call per applicant marks the evidence with quotes, and the code computes the score."
          >
            Adds a Screening section to the menu. The table is an order to talk to people in; the
            decisions stay yours.
            {screening.screenings > 0 && !screening.enabled && (
              <> Turning it off hides {screening.screenings} stored screening{screening.screenings === 1 ? '' : 's'}; the files stay until their retention date.</>
            )}
            {screening.enabled && (
              <>
                {' '}
                <a href="/screen" class="font-medium text-accent-strong hover:text-accent-deep">
                  Open Screening →
                </a>
              </>
            )}
          </ToggleRow>
        </Card>
      </Section>
      )}

      {activeTab === 'screening' && (
      <Section title="Retention" desc="Applicants' files and every verdict are deleted with the screening on its date. A hiring round, not a talent pool.">
        <Card>
          <form method="post" action="/settings/screening-retention" class="flex flex-wrap items-end gap-3">
            <Field label="Keep a screening for" hint={`${screening.retentionMin}–${screening.retentionMax} days; each screening's page can extend its own date.`}>
              <div class="flex items-center gap-2">
                <Input type="number" name="days" min={screening.retentionMin} max={screening.retentionMax} value={screening.retentionDays} class="w-28" />
                <span class="text-sm text-ink-muted">days</span>
              </div>
            </Field>
            <Button variant="secondary">Save</Button>
          </form>
          <Hint class="mt-3">
            The weekly cleanup deletes what has passed its date. Deleting a screening yourself removes the files at
            once.
          </Hint>
        </Card>
      </Section>
      )}

      {activeTab === 'screening' && (
      <Section title="Which engine reads applicants" desc="Every screening call uses the first engine in your chain, with its resume model.">
        <Card>
          <p class="text-sm text-ink">
            First in the chain: <span class="font-medium">{screening.engineLabel}</span>
            {screening.engineSubscription ? (
              <Badge tone="warn" class="ml-2">
                personal subscription
              </Badge>
            ) : (
              <Badge tone="ok" class="ml-2">
                API or local
              </Badge>
            )}
          </p>
          <Hint class="mt-2">
            {screening.engineSubscription
              ? 'A CLI on a personal subscription runs under terms and data settings the subscriber controls, not the employer. For applicants’ data the defensible path is an API engine under a data-processing agreement, or a local model through the OpenAI-compatible engine (a localhost base URL). The screening page warns about this too; it does not block.'
              : 'An API or a local model is what other people’s data should go through — check the vendor’s data-processing terms, or keep the model on your own machine.'}{' '}
            Change the order on the AI engine tab.
          </Hint>
        </Card>
      </Section>
      )}

      {activeTab === 'screening' && (
      <Section title="What this means legally" desc="Not legal advice — the facts to check with whoever gives you that.">
        <Card>
          <p class="text-sm leading-6 text-ink-muted">{screening.legalNote}</p>
        </Card>
        <Card>
          <div class="flex flex-wrap items-baseline justify-between gap-3">
            <SectionTitle>Notice for applicants</SectionTitle>
            <Button variant="secondary" size="sm" type="button" data-copy={screening.notice}>
              Copy
            </Button>
          </div>
          <Hint>
            Paste it into the posting or the reply applicants get. It says what reads the application, that no
            decision is automatic, what the tool never sees, and how to ask for a human review — the duties GDPR
            art. 13–14 and the AI Act's transparency rule put on the employer.
          </Hint>
          <pre class="mt-3 whitespace-pre-wrap rounded-md bg-surface-overlay p-3 font-sans text-[13px] leading-5 text-ink">{screening.notice}</pre>
        </Card>
      </Section>
      )}
      </div>
      </div>
    </div>
    <script dangerouslySetInnerHTML={{ __html: SETTINGS_JS }} />
    <script type="module" dangerouslySetInnerHTML={{ __html: "import { wireCopy } from '/static/copy.mjs'; wireCopy(document);" }} />
    <script type="module" dangerouslySetInnerHTML={{ __html: MODELS_BOOT }} />
  </Layout>
);

/** One keyed source on the Sources tab (ADR 0034): where each field comes from, never what it is. */
export interface SourceKeyRow {
  source: string;
  label: string;
  /** One sentence: what this source adds that the free ones do not. */
  what: string;
  /** When a user actually needs it — and by omission, when they do not. */
  worthIt: string;
  /** What the vendor asks in return, in the user's words. */
  cost: string;
  signupUrl: string;
  signupLabel: string;
  /** Free access, but the vendor's own terms — shown so the user knows what they agreed to. */
  terms: string;
  termsUrl: string;
  /** True when every field is in place: the source is usable. */
  ready: boolean;
  fields: { field: string; label: string; envVar: string; origin: 'db' | 'env' | 'none'; masked: string }[];
}

const SourceKeysCard: FC<{ rows: SourceKeyRow[] }> = ({ rows }) => (
  <Card class="mt-4" id="source-keys">
    <SectionTitle>Extra sources — a free account of your own</SectionTitle>
    <Hint class="mb-3">
      Two wider sources, each behind a free account you register with the vendor. Until its values
      are saved here, a source stays out of the app.
    </Hint>
    {/* One region, a divider between the vendors — not a bordered box inside the card. */}
    <div class="divide-y divide-line">
      {rows.map((r) => (
        <div class="py-4 first:pt-0 last:pb-0">
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span class="text-entity text-ink">{r.label}</span>
            <Badge tone={r.ready ? 'ok' : 'neutral'}>{r.ready ? 'ready' : 'not set up'}</Badge>
          </div>
          <p data-ui="hint" class="mt-1 text-sm leading-5 text-ink-muted">{r.what}</p>
          <More summary="When it is worth it, and what the vendor asks" class="mt-1">
            <p>
              <span class="font-medium text-ink-muted">Worth it if:</span> {r.worthIt}
            </p>
            <p>
              <span class="font-medium text-ink-muted">In exchange:</span> {r.cost}
            </p>
          </More>
          <p class="mt-1.5 text-[13px] leading-5">
            <a href={r.signupUrl} target="_blank" rel="noopener" class="text-accent-strong hover:underline">
              {r.signupLabel}
            </a>
            <span class="text-ink-faint"> · </span>
            <a href={r.termsUrl} target="_blank" rel="noopener" class="text-ink-muted hover:underline">
              {r.terms}
            </a>
          </p>
          {r.fields.map((f) => (
            <form method="post" action="/settings/sources/key" class="mt-2.5 flex flex-wrap items-end gap-2">
              <input type="hidden" name="source" value={r.source} />
              <input type="hidden" name="field" value={f.field} />
              <div class="flex min-w-[9rem] flex-col gap-1 text-xs text-ink-muted">
                <span class="font-medium text-ink">{f.label}</span>
                {f.origin === 'db' && (
                  <span>
                    <Badge tone="ok">saved</Badge> <span class="font-mono">{f.masked}</span>
                  </span>
                )}
                {f.origin === 'env' && <Badge tone="neutral">from .env</Badge>}
                {f.origin === 'none' && <span class="text-ink-faint">{f.envVar}</span>}
              </div>
              <Input
                type="password"
                name="key"
                autocomplete="off"
                spellcheck="false"
                aria-label={`${r.label} ${f.label}`}
                placeholder={f.origin === 'db' ? 'Paste a new one to replace it' : 'Paste it here'}
                mono
                class="min-w-[14rem] flex-1"
              />
              <Button size="sm" variant="secondary">
                Save
              </Button>
              {f.origin === 'db' && (
                <Button size="sm" variant="danger" name="clear" value="1">
                  Remove
                </Button>
              )}
            </form>
          ))}
          <Hint class="mt-2">
            {r.ready
              ? `Ready. Add it on Companies → "Sources for your searches", then switch the row on.`
              : `Once both values are saved, add it on Companies → "Sources for your searches".`}
          </Hint>
        </div>
      ))}
    </div>
  </Card>
);

/**
 * Paste-a-credential row (ADR 0027). The field is always empty: a stored key
 * is only ever described (last four characters, where it came from), so the
 * page can never hand the secret back or have a mask saved over the real one.
 */
const EngineKeyRow: FC<{ engine: AiEngineRow }> = ({ engine: e }) => {
  const label = e.keyEnvVar?.endsWith('_TOKEN') ? 'Access token' : 'API key';
  return (
    <div class="mt-3 rounded-md border border-line bg-surface-raised px-3.5 py-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-label text-ink">{label}</span>
        {e.keySource === 'db' && (
          <>
            <Badge tone="ok">saved</Badge>
            <span class="font-mono text-xs text-ink-muted">{e.maskedKey}</span>
          </>
        )}
        {e.keySource === 'env' && <Badge tone="neutral">from .env</Badge>}
        {e.keySource === 'db' && (
          <ActionForm
            action="/settings/ai/key"
            hidden={{ provider: e.id, clear: '1' }}
            confirm={`Remove the saved ${e.label} ${label.toLowerCase()}?`}
            class="ml-auto"
          >
            <Button size="sm" variant="danger">
              Remove
            </Button>
          </ActionForm>
        )}
      </div>
      <form method="post" action="/settings/ai/key" class="mt-2.5 flex flex-wrap items-end gap-2">
        <input type="hidden" name="provider" value={e.id} />
        <Input
          type="password"
          name="key"
          required
          autocomplete="off"
          spellcheck="false"
          aria-label={`${e.label} ${label.toLowerCase()}`}
          placeholder={e.keySource === 'db' ? 'Paste a new one to replace it' : 'Paste it here'}
          mono
          class="min-w-[16rem] flex-1"
        />
        <Button size="sm" variant="secondary">
          Save
        </Button>
      </form>
      <Hint class="mt-2">
        {e.keySource === 'db'
          ? `Saved in your database and used instead of ${e.keyEnvVar} from .env.`
          : e.keySource === 'env'
            ? `Read from ${e.keyEnvVar} in .env; a key pasted here overrides it.`
            : `Stored in your database; ${e.keyEnvVar} in .env works too.`}
      </Hint>
    </div>
  );
};

const AiEngineCard: FC<{ engine: AiEngineRow }> = ({ engine: e }) => (
  <Card class={e.enabled || e.lastResort ? '' : 'opacity-75'}>
    <div class="flex flex-wrap items-center gap-2">
      {e.enabled && <Badge tone="violet">#{e.position + 1}</Badge>}
      <span class="text-entity text-ink">{e.label}</span>
      <Badge tone={e.ok ? 'ok' : 'neutral'}>{e.ok ? 'available' : 'not detected'}</Badge>
      {e.lastResort && <Badge tone="warn">last resort</Badge>}
      {e.paid && <Badge tone="warn">pay per token</Badge>}
      <div class="ml-auto flex flex-wrap justify-end gap-2">
        {e.enabled && e.position > 0 && (
          <ActionForm action="/settings/ai/move" hidden={{ provider: e.id }}>
            <Button size="sm" variant="secondary" title="Move one step up the priority order">
              ↑ Priority
            </Button>
          </ActionForm>
        )}
        <ActionForm action="/settings/ai/test" hidden={{ provider: e.id }}>
          <Button size="sm" variant="violet" title="Run a tiny live call through this engine">
            Test
          </Button>
        </ActionForm>
        {e.canToggle && (
          <ActionForm action="/settings/ai/enable" hidden={{ provider: e.id }}>
            <Button size="sm" variant={e.enabled ? 'secondary' : 'primary'}>
              {e.enabled ? 'Disable' : 'Enable'}
            </Button>
          </ActionForm>
        )}
      </div>
    </div>
    {/* The live state stays in sight; what the engine is sits one press away. */}
    <Hint class="mt-1.5">{e.detail}</Hint>
    <More summary="What this engine is" class="mt-1">
      {e.desc}
    </More>
    {e.lastResort && (
      <Hint class="mt-1.5 text-warn">
        No engine in the list can run on this host, so this one answers every call. Enable it to
        keep it.
      </Hint>
    )}
    {!e.canToggle && (
      <Hint class="mt-1.5">The only engine in the list; enable another to replace it.</Hint>
    )}
    {e.keyEnvVar && <EngineKeyRow engine={e} />}
    {(e.enabled || e.lastResort) && (
      <form
        method="post"
        action="/settings/ai/models"
        data-model-form
        class="mt-4 border-t border-line pt-4"
      >
        <input type="hidden" name="provider" value={e.id} />
        <div class="grid gap-3 sm:grid-cols-3">
        <Field label="Classifier model" hint="Scores every fetched job; keep it cheap.">
          <ModelPicker
            name="classifier"
            value={e.classifierModel}
            fallback={e.classifierDefault}
            options={e.options}
            freeText={e.freeTextModels}
          />
        </Field>
        <Field label="Resume model" hint="Resume scan, match and verification.">
          <ModelPicker
            name="resume"
            value={e.resumeModel}
            fallback={e.resumeDefault}
            options={e.options}
            freeText={e.freeTextModels}
          />
        </Field>
        <Field label="Cover letter model" hint="Writing quality, not analysis.">
          <ModelPicker
            name="cover"
            value={e.coverModel}
            fallback={e.coverDefault}
            options={e.options}
            freeText={e.freeTextModels}
          />
        </Field>
        {e.id === 'claude_code' && /haiku/.test(e.resumeModel || e.resumeDefault) && (
          <Hint class="sm:col-span-3">
            Measured 2026-09-05 on this lane: Haiku 4.5 answers a quick check in 21–26 s but returned
            JSON that could not be parsed in 2 of 3 calls, and each costs a retry. Sonnet 5 answered
            in 19 s with none — it is the default when this slot is empty.
          </Hint>
        )}
        </div>
        <div class="mt-3 flex items-center gap-3">
          {/* The no-JS path: settings-models.mjs hides this and saves on change. */}
          <Button size="sm" variant="secondary" data-save-button>
            Save models
          </Button>
          <span
            class="text-xs text-ink-faint"
            data-save-status
            role="status"
            aria-live="polite"
          ></span>
        </div>
      </form>
    )}
  </Card>
);

/** Closed families get a select (no wrong-family ids possible); base-URL
 *  engines (openai_api) get free text — any model id may be legal there. */
const ModelPicker: FC<{
  name: string;
  value: string;
  fallback: string;
  options: string[];
  freeText: boolean;
}> = ({ name, value, fallback, options, freeText }) =>
  freeText ? (
    <Input type="text" name={name} value={value} placeholder={fallback || 'model id'} mono />
  ) : (
    <Select name={name}>
      <option value="" selected={value === ''}>
        Default — {fallback}
      </option>
      {options.map((m) => (
        <option value={m} selected={value === m}>
          {m}
        </option>
      ))}
    </Select>
  );

/** One line under each relocation choice — editor copy, not vocabulary. */
const RELOCATION_HINT: Record<string, string> = {
  no: 'Only roles I can take from where I am.',
  yes: 'I can move, and I may work there already.',
  sponsorship: 'A visa or work permit has to come with the job.',
};

const ProfileEditor: FC<{
  profile: Profile;
  availableTargets: AvailableTarget[];
  resumes: ResumeListItem[];
  draft?: ProfileDraftNotice | null;
}> = ({ profile, availableTargets, resumes, draft }) => {
  const rulesCount = parsePriorityRules(profile.priorityRules).length;
  // Open the advanced block only when free-form content lives in it. Salary
  // and the Telegram target deliberately don't count — init.ts seeds a salary
  // from .env, which used to keep the block permanently open for everyone.
  const advancedOpen =
    Boolean(profile.notes && profile.notes.trim().length > 0) ||
    profile.onsiteCities.length > 0 ||
    rulesCount > 0;
  return (
  <form
    method="post"
    action={`/settings/profiles/${profile.id}/save`}
    class="space-y-5"
    data-dirty-watch
  >
    {draft && (
      <div
        role="status"
        class="rounded-md border border-violet/25 bg-violet/5 px-3.5 py-2.5 text-[13px] leading-5 text-violet"
      >
        <span class="font-medium">
          AI prefilled this profile from resume "{draft.resumeName}"
        </span>{' '}
        — replaced: {draft.changed.join(', ')}.
        {draft.warnings.length > 0 && <> Note: {draft.warnings.join('; ')}.</>}{' '}
        Nothing is saved yet — review the fields and press "Save profile" or "Save &amp;
        re-classify".
      </div>
    )}
    <div class="grid gap-4 sm:grid-cols-2">
      <Field label="Name" hint="Yours alone; nothing reads it.">
        <Input type="text" name="name" required value={profile.name} />
      </Field>
      <Field
        label="Resume for this search"
        hint="Preselected on the job pages this search finds."
      >
        <Select name="resumeId">
          <option value="" selected={profile.resumeId === null}>
            (pick by skill overlap)
          </option>
          {resumes.map((r) => (
            <option value={r.id} selected={profile.resumeId === r.id}>
              {r.name}
              {r.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </Select>
      </Field>
    </div>

    <fieldset class="space-y-4">
      <legend class="text-label text-ink">What are we hunting for?</legend>
      <Hint class="!mt-0.5">
        Technologies go in the required stack, title words ("backend") in role types. A title
        match alone is never a tech match.
      </Hint>
      <TagListInput
        label="Tech stack — required"
        name="stackRequired"
        values={profile.stackRequired}
        placeholder="php, laravel, mysql…"
      />
      <TagListInput
        label="Role types"
        hint="Title shapes you accept; they admit jobs to the classifier."
        name="roleTypes"
        values={profile.roleTypes}
        placeholder="backend, full-stack…"
      />
      <TagListInput
        label="Stack — nice to have"
        hint="Raise the fit score when the description names them."
        name="stackNiceToHave"
        values={profile.stackNiceToHave}
        placeholder="docker, aws…"
      />
    </fieldset>

    <fieldset>
      <legend class="text-label text-ink">Seniority</legend>
      <div class="mt-2 flex flex-wrap gap-1.5">
        {SENIORITY_LEVELS.map((s) => (
          <PillCheckbox name="seniority" value={s} checked={profile.seniority.includes(s)}>
            {s}
          </PillCheckbox>
        ))}
      </div>
    </fieldset>

    <fieldset class="space-y-3">
      <legend class="text-label text-ink">Location</legend>
      <Hint class="!mt-0.5">Countries and regions add up; both empty = anywhere.</Hint>
      <div>
        <div class="text-label text-ink">Arrangements you accept</div>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          {PROFILE_WORKPLACES.map((w) => (
            <PillCheckbox name="workplace" value={w} checked={profile.workplace.includes(w)}>
              {WORKPLACE_LABEL[w]}
            </PillCheckbox>
          ))}
        </div>
      </div>
      <TagListInput
        label="Countries"
        hint="Type a country in any spelling, or a city."
        more='"Poland", "Polska", "Польща" and "PL" all find it. For hybrid and on-site roles this is where the office may be.'
        name="countries"
        values={profile.countries.map((c) => `${flagOf(c)} ${placeLabel(c)}`)}
        placeholder="Poland, Germany, Netherlands…"
        rows={2}
        picker="countries"
      />
      <div>
        <div class="text-label text-ink">Regions</div>
        <Hint class="mt-0.5">A group counts as a group, not as its members.</Hint>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          {REGIONS.map((r) => (
            <PillCheckbox name="regions" value={r.code} checked={profile.regions.includes(r.code)}>
              {r.flag ? `${r.flag} ${r.label}` : r.label}
            </PillCheckbox>
          ))}
        </div>
      </div>
      <Field
        label="I live in"
        hint="Not a place this search hunts: it decides whether a role's work-permit and relocation wording is a problem for you."
      >
        <Select name="residence">
          <option value="" selected={!profile.residence}>
            Not set
          </option>
          {COUNTRIES.map((c) => (
            <option value={c.code} selected={profile.residence === c.code}>
              {c.flag} {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <div class="text-label text-ink">If the role is somewhere you do not live</div>
        <div class="mt-1.5 grid gap-2 sm:grid-cols-3">
          {RELOCATION_CODES.map((r) => (
            <Radio
              name="relocation"
              value={r}
              checked={(profile.relocation ?? 'no') === r}
              title={RELOCATION_LABEL[r]}
            >
              {RELOCATION_HINT[r]}
            </Radio>
          ))}
        </div>
      </div>
    </fieldset>

    <details class="rounded-md border border-line" open={advancedOpen}>
      <summary class="cursor-pointer select-none rounded-md px-4 py-3 text-[13px] font-medium text-ink transition-colors duration-150 hover:text-accent-strong">
        Advanced — excludes, notes, priority rules, thresholds
        <span class="ml-2 font-normal text-ink-faint">
          Excludes, notes, priority rules, thresholds.
        </span>
      </summary>
      <div class="space-y-5 border-t border-line px-4 py-4">
        <TagListInput
          label="Stack — exclude (auto-reject in title)"
          hint="If the title contains any of these, the job is dropped before the classifier runs."
          name="stackExclude"
          values={profile.stackExclude}
        />

        <Field
          label="Notes for the classifier"
          hint='Free-form context: "AI-adjacent roles preferred", "open to first-time-manager positions", "EU-friendly time zones".'
        >
          <Textarea name="notes" rows={3}>
            {profile.notes ?? ''}
          </Textarea>
        </Field>

        <TagListInput
          label="On-site cities (OK to commute)"
          hint='One per line: "Austin, TX", "Berlin".'
          name="onsiteCities"
          values={profile.onsiteCities}
          rows={2}
        />

        <PriorityRulesEditor profile={profile} />

        <div class="grid gap-4 sm:grid-cols-3">
          <Field label="Min salary (USD/year)" hint="0 = no salary filter.">
            <Input
              type="number"
              name="minSalaryUsd"
              min="0"
              step="1000"
              value={profile.minSalaryUsd}
            />
          </Field>
          <Field label="Min fit score (0-100)" hint="Jobs below it are stored, not alerted.">
            <Input type="number" name="minFitScore" min="0" max="100" value={profile.minFitScore} />
          </Field>
          <Field label="Alert target">
            <Select name="notificationTargetId">
              <option value="" selected={profile.notificationTargetId === null}>
                (broadcast to all active)
              </option>
              {availableTargets.map((t) => (
                <option value={t.id} selected={profile.notificationTargetId === t.id}>
                  {t.name} · {KIND_LABEL[t.kind]}
                  {t.active ? '' : ' (inactive)'}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </details>

    <div class="flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <Button size="lg">Save profile</Button>
      <Button
        size="lg"
        variant="violet"
        name="action"
        value="save-and-reclassify"
        onclick="return confirm('Save the profile and re-classify all jobs (except APPLIED)? Takes 2-5 minutes and spends AI credit.')"
      >
        Save &amp; re-classify
      </Button>
      <span data-dirty-indicator hidden={!draft} class="text-[13px] font-medium text-warn">
        Unsaved changes
      </span>
    </div>
  </form>
  );
};

const PriorityRulesEditor: FC<{ profile: Profile }> = ({ profile }) => {
  const rules = parsePriorityRules(profile.priorityRules);
  const text = formatPriorityRulesText(rules);
  return (
    <details class="rounded-md border border-line" open={rules.length > 0}>
      <summary class="cursor-pointer select-none rounded-md px-4 py-3 text-[13px] font-medium text-ink transition-colors duration-150 hover:text-accent-strong">
        Priority rules (post-classifier overrides)
        <span class="ml-2 font-normal text-ink-faint">
          {rules.length > 0
            ? `${rules.length} rule${rules.length === 1 ? '' : 's'} set`
            : 'None set.'}
        </span>
      </summary>
      <div class="border-t border-line px-4 py-4">
        <Hint>
          One rule per line: <Code>LABEL | techs,csv | regions,csv | MIN_FIT</Code>. If the
          title or description contains any tech and the location matches any region phrase,
          fit is clamped up to MIN_FIT and the location check passes. Empty regions match
          anywhere. <Code>#</Code> starts a comment. A bad line stops the save.
        </Hint>
        {rules.length > 0 && (
          <Hint class="mt-1 text-warn">
            Region entries are phrases — every word must appear in the location.{' '}
            <Code>Remote US</Code> matches "Dallas (Remote US)" but not "Remote · Germany".
            Avoid a bare <Code>Remote</Code>; prefer{' '}
            <Code>Remote US,United States,USA,Worldwide</Code>.
          </Hint>
        )}
        <Textarea
          name="priorityRules"
          aria-label="Priority rules"
          rows={Math.max(3, rules.length + 1)}
          placeholder="Python remote-US | python | Remote US,United States,USA,Worldwide | 90"
          class="mt-1.5"
          mono
        >
          {text}
        </Textarea>
        {rules.length > 0 && (
          <div class="mt-2 flex flex-wrap gap-1.5">
            {rules.map((r) => (
              <Tag tone="violet">
                {r.label} → ≥{r.minFitFloor}
              </Tag>
            ))}
          </div>
        )}
      </div>
    </details>
  );
};

/**
 * Progressive enhancement only: chip editors write back into their hidden
 * textarea (newline-joined), so the POST body the routes parse is unchanged.
 */
const MODELS_BOOT = `
import { init } from '/static/settings-models.mjs';
init();
import { mountChipEditors } from '/static/chips.mjs';
mountChipEditors();
import { mountCountryPickers } from '/static/countries.mjs';
mountCountryPickers();
`;

const SETTINGS_JS = `
  (function () {

    document.querySelectorAll('[data-dirty-watch]').forEach(function (form) {
      var indicator = form.querySelector('[data-dirty-indicator]');
      if (!indicator) return;
      function markDirty() { indicator.hidden = false; }
      form.addEventListener('input', markDirty);
      form.addEventListener('change', markDirty);
    });
  })();
`;
