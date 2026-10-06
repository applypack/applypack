/** @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import type { Profile } from '@prisma/client';
import { Layout } from '../layout';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  CardLink,
  Code,
  ConfirmAction,
  Empty,
  Field,
  FILE_INPUT_CLASS,
  Flash,
  Hint,
  Input,
  More,
  Notice,
  PageHeader,
  PillCheckbox,
  Radio,
  SectionTitle,
  Select,
  Table,
  Tag,
  TagListInput,
  Td,
  Textarea,
  ToggleRow,
  Tr,
  When,
} from '../ui';
import { formatDate } from '../format';
import { isNewer } from '../../versions';
import { REAPPLY_CHOICES } from '../../employer';
import type { FlashMessage } from '../flash';
import type { LoginItemState } from '../login-item-io';
import { describeCount, type SourceGroup } from '../source-groups';
import { dotClassFor, MAX_WORK_STAGES } from '../stage-config';
import { formatPriorityRulesText, parsePriorityRules } from '../../priority-rules';
import { COUNTRIES, REGIONS, flagOf } from '../../countries';
import { RELOCATION_CODES, RELOCATION_LABEL } from '../../eligibility';
import { PROFILE_WORKPLACES } from '../../location';
import { isBlankProfile, MAX_ACTIVE_PROFILES } from '../../profile-guards';
import { SENIORITY_LEVELS } from '../../resume/profile-draft';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MAX_UPLOAD_MB } from '../upload';
import { ALERT_MODES, ALL_DAYS, FETCH_EVERY, MAX_DIGEST_HOURS, describeCadence, describeSchedule, type Schedule } from '../../user-schedule';
import { KIND_LABEL } from '../../notify/targets';
import { SCHEDULE_HREF, type HeldLine } from '../held-line';
import { AiPlan, BILLING_TONE } from './ai-plan';
import type { AiPlanRow } from '../ai-plan';
import { billingWords, formatUsd } from '../../ai-spend';
import type { AiBilling } from '../../ai-usage';
import type { MessageKey } from '../../i18n/catalog';
import { weekdayName } from '../../i18n/format';
import { placeName, workplaceName } from '../../i18n/places';
import { t } from '../../i18n/t';
import { LanguageSettings } from '../language-menu';
import { tRich } from '../rich';

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
  /** The tasks the page shows and whether this engine takes each (ADR 0060); one it cannot do at all — the web check, with no web search — is not offered. */
  tasks: { id: string; label: string; taken: boolean; offered: boolean }[];
  classifierModel: string;
  resumeModel: string;
  coverModel: string;
  classifierDefault: string;
  resumeDefault: string;
  coverDefault: string;
  /** Family model ids for the selects; on a free-text engine, the suggestions its server listed. */
  options: string[];
  freeTextModels: boolean;
  /** A base-URL engine's server (TASKS S1, ADR 0057): where calls go, whether it was set here, whether it is on this machine. */
  server: EngineServer | null;
  /** Whose money a call on this engine spends (ai-usage.ts:billingOf, ADR 0055). */
  billing: AiBilling;
  /** The .env variable this engine's key mirrors; null = login-only engine. */
  keyEnvVar: string | null;
  /** Where the credential comes from right now (ADR 0027). */
  keySource: 'db' | 'env' | 'none';
  /** Last four characters of the stored key — never the key itself. */
  maskedKey: string;
}

export interface EngineServer {
  /** The route the row posts to, and the .env variable a cleared address falls back to. */
  action: string;
  envVar: string;
  label: string;
  hint: string;
  /** The rest of the explanation, folded under the hint. */
  more?: string;
  value: string;
  stored: boolean;
  local: boolean;
  /** The local engine's context window: the stored choice and the ones offered. */
  context?: { value: number; choices: readonly number[] };
}

/** Everything the Schedule section renders, resolved by the route (TASKS §16). */
export interface ScheduleView {
  schedule: Schedule;
  /** IANA zones the runtime knows, for the picker. */
  zones: string[];
  /** "today at 14:05" — already formatted in the schedule's own zone. */
  nextFetch: string;
  /** Matches waiting to be sent — for the window, for Alerts, for a chat — or null. */
  held: HeldLine | null;
  /** No schedule saved yet: the zone is the install's default, and the browser's is the better guess (TASKS S28). */
  unsaved: boolean;
}

export interface AiStatusSummary {
  /** Who does what: each task with the engines a call for it tries, in order (web/ai-plan.ts). */
  plan: AiPlanRow[];
  skipped: string[];
  /** A pay-per-token engine answering a task ahead of one a plan covers (ai-spend.ts:billingNotes). */
  billingNotes: string[];
}

/**
 * Link-based sub-navigation (?tab=…): one route, server picks the sections.
 * POST routes redirect back to the tab their setting lives on. A tab's label
 * is the catalog's `settings.tab.<id>`.
 */
const SETTINGS_TABS = ['general', 'profile', 'ai', 'notifications', 'sources', 'screening'] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function isSettingsTab(value: unknown): value is SettingsTab {
  return (SETTINGS_TABS as readonly unknown[]).includes(value);
}


/** What "Fill from resume" replaced — rendered as an unsaved-draft notice. */
export interface ProfileDraftNotice {
  resumeName: string;
  changed: string[];
  warnings: string[];
}

export interface SettingsProps {
  /** `?fill=<resume id>` from a resume's page: the fill form starts on that resume (TASKS R20). */
  fillResumeId?: number;
  telegramEnabled: boolean;
  classifierMode: 'single' | 'two_stage';
  applicationTrackingEnabled: boolean;
  /** Full funnel order with job counts; fixed rows carry no edit controls. */
  pipelineStages: { key: string; label: string; count: number; fixed: boolean }[];
  staleApplicationsDigestEnabled: boolean;
  /** ADR 0056: turn postings away at a company applied to in the last N days; null = off. */
  reapplyDays: number | null;
  /** TASKS N9: the optional weekly look at GitHub's releases, and what it last saw. */
  updates: { enabled: boolean; current: string; latest: string | null; checkedAt: Date | null };
  /** TASKS S5: the system's login entry for `npm start`; unavailable in Docker and dev. */
  loginItem: LoginItemState;
  sourceHealthAlerts: boolean;
  disabledSources: string[];
  /** Off on /discovery stops the HN thread as surely as unticking its pill here. */
  hnParserEnabled: boolean;
  /** ADR 0034: the keyed sources' credential rows — origins and masks only, never a value. */
  sourceKeyRows: SourceKeyRow[];
  sourceGroups: SourceGroup[];
  fetchingEnabled: boolean;
  schedule: ScheduleView;
  aiEngines: AiEngineRow[];
  aiStatus: AiStatusSummary;
  /** The monthly ceiling on billed AI money in cents (null = none), and what this UTC month has billed, micro-dollars. */
  aiBudget: { cents: number | null; billedThisMonthMicro: number };
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

/** A resume in a picker: its name, and what the reader should know about it before choosing it. */
function resumeOption(r: ResumeListItem, scanned = true): string {
  return t('settings.resumeOption', { name: r.name, isDefault: r.isDefault ? 'yes' : 'no', scanned: scanned ? 'yes' : 'no' });
}

/** An `onclick` that asks first. The question goes in as a JSON string, so a quote or an apostrophe in a language's wording cannot end it. */
function confirmScript(question: string): string {
  return `return confirm(${JSON.stringify(question)})`;
}

/**
 * A settings section: its title and one sentence above its controls; what else
 * is worth knowing sits behind "How this works" (DESIGN.md, the Disclosure Rule).
 * It is a part of the tab's one raised surface, which draws the hairline
 * between sections (the One-Surface-Per-Region Rule) — so a section brings no
 * card of its own, and neither do its controls.
 */
const Section: FC<PropsWithChildren<{ title: string; desc?: string | Child; more?: Child; id?: string }>> = ({
  title,
  desc,
  more,
  id,
  children,
}) => (
  <Card variant="flat" id={id} class="scroll-mt-4 px-5 py-7">
    <h2 class="text-section text-ink">{title}</h2>
    {desc && <p data-ui="hint" class="mt-1 text-sm leading-5 text-ink-muted">{desc}</p>}
    {more && <More class="mt-1">{more}</More>}
    <div class="mt-4 min-w-0 space-y-4">{children}</div>
  </Card>
);


/** What the last update check saw, in one sentence. */
const UpdateLine: FC<{ current: string; latest: string | null; checkedAt: Date }> = ({ current, latest, checkedAt }) => (
  <Hint>
    {latest === null
      ? t('settings.updates.nothing', { at: formatDate(checkedAt) })
      : isNewer(current, latest)
        ? t('settings.updates.newer', { latest, at: formatDate(checkedAt) })
        : t('settings.updates.latest', { at: formatDate(checkedAt) })}
  </Hint>
);

/**
 * The Schedule form (TASKS §16.3). Whole hours only, one time zone for
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
    <legend class="sr-only">{t('settings.days')}</legend>
    <div class="flex flex-wrap gap-1.5">
      {ALL_DAYS.map((d) => (
        <PillCheckbox name={name} value={String(d)} checked={days.includes(d)}>
          {weekdayName(d)}
        </PillCheckbox>
      ))}
    </div>
  </fieldset>
);

const ScheduleForm: FC<{ view: ScheduleView }> = ({ view }) => {
  const { schedule: s, zones, nextFetch, held, unsaved } = view;
  return (
    <form method="post" action="/settings/schedule" class="space-y-5">
      <Field
        label={t('settings.timeZone')}
        hint={unsaved ? t('settings.timeZoneHintUnsaved') : t('settings.timeZoneHint')}
        class="max-w-sm"
      >
        {/* IANA zone ids: data, in every language. */}
        <Select name="timezone" translate="no" data-browser-zone={unsaved ? '' : undefined}>
          {zones.map((z) => (
            <option value={z} selected={z === s.timezone}>
              {z}
            </option>
          ))}
        </Select>
      </Field>
      {unsaved && (
        <script
          type="module"
          dangerouslySetInnerHTML={{
            __html:
              "const s = document.querySelector('select[data-browser-zone]'); const z = Intl.DateTimeFormat().resolvedOptions().timeZone; if (s && [...s.options].some((o) => o.value === z)) s.value = z;",
          }}
        />
      )}

      <div class="border-t border-line pt-4">
        <div class="text-label text-ink">{t('settings.checkForJobs')}</div>
        <Hint class="mt-0.5 mb-2">
          {nextFetch ? t('settings.scheduleWithNext', { schedule: describeSchedule(s), next: nextFetch }) : describeSchedule(s)}
        </Hint>
        <div class="flex flex-wrap items-end gap-3">
          <Field label={t('settings.howOften')} class="w-44">
            <Select name="fetchEvery">
              {FETCH_EVERY.map((e) => (
                <option value={e} selected={e === s.fetch.every}>
                  {describeCadence(e)}
                </option>
              ))}
            </Select>
          </Field>
          <HourSelect name="fetchFrom" value={s.fetch.from} label={t('settings.from')} />
          <HourSelect name="fetchTo" value={s.fetch.to} label={t('settings.toInclusive')} />
        </div>
        <DayPills name="fetchDays" days={s.fetch.days} />
        <Hint class="mt-2">{t('settings.fetchNowIgnoresTheSchedule')}</Hint>
      </div>

      <div class="border-t border-line pt-4" data-ui="alert-modes">
        <div class="text-label text-ink">{t('settings.sendAlerts')}</div>
        {held && (
          <Hint class="mt-0.5 text-warn">
            {/* The window is set in this section; any other reason is set elsewhere. */}
            {held.href === SCHEDULE_HREF
              ? t('settings.heldHere', { text: held.text })
              : tRich('settings.heldElsewhere', { text: held.text, action: held.action }, {
                  link: (words) => <a href={held.href} class="font-medium underline">{words}</a>,
                })}
          </Hint>
        )}
        <div class="mt-2 grid gap-2 sm:grid-cols-3">
          {ALERT_MODES.map((mode) => (
            <Radio
              name="alertMode"
              value={mode}
              checked={mode === s.alerts.mode}
              title={t(`settings.alertMode.${mode}`)}
            >
              {t(`settings.alertMode.${mode}.body`)}
            </Radio>
          ))}
        </div>
        {/* The window belongs to one mode, so it shows under that mode alone (one :has()
            rule in layout.tsx). Hidden, its fields are still submitted; where :has() is
            missing it simply stays in sight, as before 2.40. */}
        <div class="mt-3 rounded-md bg-surface-overlay p-4" data-ui="alert-window">
          <div class="text-label text-ink">{t('settings.alertWindow')}</div>
          <Hint class="mt-0.5">{t('settings.theHoursAndTheDays')}</Hint>
          <div class="mt-3 flex flex-wrap items-end gap-3">
            <HourSelect name="alertFrom" value={s.alerts.from} label={t('settings.from')} />
            <HourSelect name="alertTo" value={s.alerts.to} label={t('settings.untilInclusive')} />
          </div>
          <DayPills name="alertDays" days={s.alerts.days} />
        </div>
      </div>

      {/* Its own block: these hours run every day, whichever alert mode is picked. */}
      <div class="border-t border-line pt-4">
        <div class="text-label text-ink">{t('settings.scheduledMessages')}</div>
        <Hint class="mt-0.5">
          {t('settings.scheduledMessagesHint', { first: String(s.alerts.digestAt[0] ?? 9).padStart(2, '0') })}
        </Hint>
        <fieldset class="mt-2">
          <legend class="sr-only">{t('settings.hoursTheScheduledMessagesGo')}</legend>
          <div class="flex flex-wrap gap-1.5">
            {HOURS.map((h) => (
              <PillCheckbox name="digestAt" value={String(h)} checked={s.alerts.digestAt.includes(h)}>
                {String(h).padStart(2, '0')}
              </PillCheckbox>
            ))}
          </div>
        </fieldset>
        <Hint class="mt-2">{t('settings.digestHoursLimit', { n: MAX_DIGEST_HOURS })}</Hint>
      </div>

      <Button type="submit">{t('settings.saveSchedule')}</Button>
    </form>
  );
};

export const SettingsPage: FC<SettingsProps> = ({
  fillResumeId,
  telegramEnabled,
  classifierMode,
  applicationTrackingEnabled,
  pipelineStages,
  staleApplicationsDigestEnabled,
  reapplyDays,
  updates,
  loginItem,
  sourceHealthAlerts,
  disabledSources,
  hnParserEnabled,
  sourceKeyRows,
  sourceGroups,
  fetchingEnabled,
  schedule,
  aiEngines,
  aiStatus,
  aiBudget,
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
  <Layout title={t('nav.settings')} active="settings">
    <div class="w-full">
      <PageHeader title={t('nav.settings')}>
        {t('settings.savedChangesReachTheBackground')}
      </PageHeader>
      <Flash flash={flash} />

      <div class="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
      {/* One nav, two shapes: a segmented row below lg, a sticky column of links from lg —
          a rule down its side, the current tab marked on it. Same URLs, same order. */}
      <nav
        aria-label={t('settings.settingsSections')}
        class="mb-6 inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface-overlay p-0.5 lg:sticky lg:top-0 lg:mb-0 lg:flex lg:flex-col lg:gap-0 lg:self-start lg:rounded-none lg:border-0 lg:border-l lg:bg-transparent lg:p-0"
      >
        {SETTINGS_TABS.map((tab) => (
          <a
            href={`/settings?tab=${tab}`}
            aria-current={tab === activeTab ? 'page' : undefined}
            class={`rounded-[6px] px-3 py-1.5 text-note transition-colors duration-150 lg:-ml-px lg:rounded-none lg:border-l-2 lg:py-1.5 lg:pl-3 lg:text-sm ${
              tab === activeTab
                ? 'bg-surface-raised font-medium text-ink shadow-sm lg:border-accent-strong lg:bg-transparent lg:shadow-none'
                : 'text-ink-muted hover:text-ink lg:border-transparent lg:hover:border-line-strong'
            }`}
          >
            {t(`settings.tab.${tab}`)}
          </a>
        ))}
      </nav>

      <div class="min-w-0">
      {/* One raised surface a tab, its sections divided by hairlines (DESIGN.md, the
          One-Surface-Per-Region Rule). Sections are declared in one flow; activeTab
          picks which render. */}
      <Card flush class="divide-y divide-line">
      {activeTab === 'general' && (
      <Section title={t('settings.jobFetching')}>
        <ToggleRow
          label={t('settings.pipeline')}
          enabled={fetchingEnabled}
          action="/settings/fetching-toggle"
          onLabel={t('settings.running')}
          offLabel={t('settings.paused')}
          enableText={t('settings.resumePipeline')}
          disableText={t('settings.pause')}
          more={t('settings.thePipelineIsTheHourly')}
        >
          {t('settings.pausingStopsNewJobsAnd')}
        </ToggleRow>
      </Section>
      )}

      {activeTab === 'general' && (
      <Section title={t('settings.schedule')}>
        <ScheduleForm view={schedule} />
      </Section>
      )}

      {activeTab === 'profile' && (
      <Section
        title={t('settings.profile')}
        desc={t('settings.oneAiCallScoresEvery')}
      >
        {/* Order follows the user's journey: contextual warnings → fill from a
            resume → the editor → profile management last (docs/onboarding-plan.md §3). */}
        {profiles.some((p) => p.running && p.blank) && profiles.every((p) => !p.running || p.blank) && (
          <Notice tone="warn">
            {resumes.length > 0 ? t('settings.everySearchEmpty.fill') : t('settings.everySearchEmpty.upload')}
          </Notice>
        )}
        {activeProfile && !profiles.some((p) => p.id === activeProfile.id && p.running) && (
          <div class="rounded-md border border-line bg-surface-overlay px-3.5 py-2.5 text-note leading-5 text-ink-muted">
            {isBlankProfile(activeProfile) ? t('settings.editingPausedBlank') : t('settings.editingPaused')}
          </div>
        )}
        {/* A well inside the section: a tool that writes into the editor below, not a second card. */}
        {activeProfile && (
          <Card variant="subtle" id="fill">
            <div class="mb-1 text-entity text-ink">{t('settings.fillFromAResume')}</div>
            {resumes.length > 0 ? (
              <>
                <Hint>
                  {t('settings.aiDraftsTheFieldsBelow')}
                </Hint>
                <More class="mb-3 mt-1">
                  {t('settings.fillMoreRescanned')}
                </More>
                <form
                  method="post"
                  action={`/settings/profiles/${activeProfile.id}/fill-from-resume`}
                  class="flex flex-wrap items-center gap-2"
                >
                  <Select
                    name="resumeId"
                    class="!w-auto min-w-0 max-w-full"
                    aria-label={t('settings.resumeToFillTheProfile')}
                  >
                    {resumes.map((r) => (
                      <option value={r.id} selected={fillResumeId !== undefined ? r.id === fillResumeId : r.isDefault}>
                        {resumeOption(r, r.scannedAt !== null)}
                      </option>
                    ))}
                  </Select>
                  <Button variant="violet">{t('settings.fillFromResume')}</Button>
                </form>
              </>
            ) : (
              <>
                <Hint>
                  {t('settings.fillPickAFile', { types: ACCEPTED_EXTENSIONS.join(', '), mb: MAX_UPLOAD_MB })}
                </Hint>
                <More class="mb-3 mt-1">
                  {t('settings.fillMoreLandsInResumes')}
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
                    aria-label={t('settings.resumeFile')}
                    class={`!w-auto min-w-0 max-w-full ${FILE_INPUT_CLASS}`}
                  />
                  <Button variant="violet">{t('settings.uploadFill')}</Button>
                </form>
              </>
            )}
          </Card>
        )}
        {activeProfile ? (
          <ProfileEditor
            profile={activeProfile}
            availableTargets={availableTargets}
            resumes={resumes}
            draft={profileDraft}
          />
        ) : (
          <Empty bare title={t('settings.noSearchSelected')}>
            {t('settings.theEditorOpensOneSearch')}
          </Empty>
        )}
        <div class="space-y-2 border-t border-line pt-5">
          <div class="text-entity text-ink">{t('settings.searches')}</div>
          <Hint>
            {t('settings.searchesHint', { n: MAX_ACTIVE_PROFILES })}
          </Hint>
          <ul class="divide-y divide-line">
            {profiles.map((p) => (
              <li class="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0">
                <span
                  class={`h-1.5 w-1.5 shrink-0 rounded-full ${p.running ? 'bg-ok' : 'bg-line-strong'}`}
                  aria-hidden="true"
                />
                {/* On a narrow screen the name takes its own line — the row's
                    four actions otherwise squeeze it down to "S…". */}
                <span class="min-w-0 basis-[calc(100%-1.5rem)] truncate text-note text-ink sm:basis-0 sm:flex-1">
                  <span translate="no">{p.name}</span>
                  {p.primary && (
                    <span class="ml-1.5 text-meta text-ink-faint">{t('settings.searchPrimary')}</span>
                  )}
                  {p.blank && (
                    <span class="ml-1.5 text-meta text-warn">{t('settings.searchEmpty')}</span>
                  )}
                  {!p.running && !p.blank && (
                    <span class="ml-1.5 text-meta text-ink-faint">{t('settings.searchPaused')}</span>
                  )}
                </span>
                <a
                  href={`/settings?tab=profile&profile=${p.id}`}
                  class="text-note text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  {t('settings.edit')}
                </a>
                {!p.primary && (
                  <ActionForm
                    action="/settings/profiles/active"
                    hidden={{ id: p.id, active: p.running ? '' : '1' }}
                  >
                    <Button variant="secondary" size="sm" disabled={p.blank && !p.running}>
                      {p.running ? t('settings.pause') : t('settings.run')}
                    </Button>
                  </ActionForm>
                )}
                {!p.primary && (
                  <ActionForm action="/settings/profiles/activate" hidden={{ id: p.id }}>
                    <Button variant="secondary" size="sm" disabled={p.blank}>
                      {t('settings.makePrimary')}
                    </Button>
                  </ActionForm>
                )}
                {!p.primary && (
                  <ActionForm action="/settings/profiles/delete" hidden={{ id: p.id }}>
                    <Button
                      variant="danger"
                      size="sm"
                      onclick={confirmScript(t('settings.deleteSearchConfirm'))}
                    >
                      {t('common.delete')}
                    </Button>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <ActionForm action="/settings/profiles/new">
            <Button variant="secondary">{t('settings.newSearch')}</Button>
          </ActionForm>
        </div>
      </Section>
      )}

      {activeTab === 'ai' && (
      <>
      <Section
        title={t('settings.aiEngines')}
        desc={t('settings.inPriorityOrderTheFirst')}
        more={t('settings.anEngineIsAnAi')}
      >
        <div class="space-y-3">
          {/* settings-models.mjs redraws this block after a card saves: the table and the note read off it. */}
          <div data-ai-plan class="space-y-3">
            <AiPlan plan={aiStatus.plan} />
            {aiStatus.billingNotes.map((note) => (
              <Notice tone="warn">{note}</Notice>
            ))}
          </div>
          {aiStatus.skipped.length > 0 && (
            <Notice tone="warn">
              {t('settings.enginesSkipped', { engines: aiStatus.skipped.join(', ') })}
            </Notice>
          )}
        </div>
        {/* The engines are rows of the section, a hairline between each — the
            priority badge says where each stands, so none needs a box. */}
        <div class="divide-y divide-line border-t border-line">
          {aiEngines.map((e) => (
            <AiEngine engine={e} />
          ))}
        </div>
      </Section>

      <Section
        id="budget"
        title={t('settings.monthlyBudget')}
        desc={t('settings.aCeilingOnWhatThe')}
      >
        <form method="post" action="/settings/ai/budget" class="flex flex-wrap items-end gap-3">
          <Field
            label={t('settings.budgetForBilledCallsUsd')}
            hint={
              aiBudget.cents
                ? t('settings.budgetBilled', {
                    billed: formatUsd(aiBudget.billedThisMonthMicro),
                    budget: formatUsd(aiBudget.cents * 10_000),
                    percent: Math.round((aiBudget.billedThisMonthMicro / (aiBudget.cents * 10_000)) * 100),
                  })
                : t('settings.emptyNoBudgetAPlan')
            }
            class="w-72"
          >
            <Input type="number" name="budget" min="0" step="0.01" value={aiBudget.cents ? (aiBudget.cents / 100).toFixed(2) : ''} />
          </Field>
          <Button variant="secondary">{t('settings.saveBudget')}</Button>
        </form>
        <Hint>
          {t('settings.aWarningOnYourAlert')}
        </Hint>
        <CardLink href="/ai">{t('settings.whichModelDidWhatHow')}</CardLink>
      </Section>

      <Section
        title={t('settings.classifier')}
        desc={t('settings.whatEachFetchedJobCosts')}
      >
        <form method="post" action="/settings/classifier-mode" class="space-y-2">
          <Radio
            name="mode"
            value="single"
            checked={classifierMode === 'single'}
            title={t('settings.singleStage')}
          >
            {t('settings.everyJobGoesStraightTo')}
          </Radio>
          <Radio
            name="mode"
            value="two_stage"
            checked={classifierMode === 'two_stage'}
            title={t('settings.twoStageCheaper')}
          >
            {t('settings.aShortYesNoPrefilter')}
          </Radio>
          <div class="pt-2">
            <Button variant="secondary">{t('settings.saveMode')}</Button>
          </div>
        </form>
      </Section>
      </>
      )}

      {activeTab === 'general' && (
      <Section title={t('settings.applicationTracking')}>
        <div class="space-y-5">
          <ToggleRow
            label={t('settings.tracking')}
            enabled={applicationTrackingEnabled}
            action="/settings/application-tracking-toggle"
          >
            {t('settings.theTrackingCardOnEach')}
          </ToggleRow>
          <div class="border-t border-line pt-5">
            <ToggleRow
              label={t('settings.staleDigest')}
              enabled={staleApplicationsDigestEnabled}
              action="/settings/stale-digest-toggle"
            >
              {t('settings.aDailyNudgeForApplications')}
            </ToggleRow>
          </div>
          <div class="border-t border-line pt-5">
            <form method="post" action="/settings/reapply" class="flex flex-wrap items-end gap-3">
              <Field
                label={t('settings.reApplyWindow')}
                hint={t('settings.newPostingsAtACompany')}
                class="min-w-0 flex-1"
              >
                <Select name="days">
                  <option value="" selected={reapplyDays === null}>
                    {t('settings.off')}
                  </option>
                  {REAPPLY_CHOICES.map((d) => (
                    <option value={String(d)} selected={reapplyDays === d}>
                      {t('settings.reapplyDays', { n: d })}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button variant="secondary">
                {t('common.save')}
              </Button>
            </form>
            <More class="mt-1.5">
              {t('settings.readFromTheApplicationsYou')}
            </More>
          </div>
        </div>
      </Section>
      )}

      {activeTab === 'general' && (
      <Section
        id="stages"
        title={t('settings.boardColumns')}
        desc={t('settings.appliedAndTheTwoClosed')}
      >
        <div>
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
                      <span class="text-meta tabular-nums text-ink-faint">
                        {t('settings.stageJobs', { n: s.count })}
                      </span>
                      <Tag>{t('settings.fixed')}</Tag>
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
                          aria-label={t('settings.stage.rename', { label: s.label })}
                          class="max-w-[14rem]"
                        />
                        <Button variant="ghost" aria-label={t('settings.stage.saveName', { label: s.label })}>
                          {t('common.save')}
                        </Button>
                      </form>
                      <span class="text-meta tabular-nums text-ink-faint">
                        {t('settings.stageJobs', { n: s.count })}
                      </span>
                      <ActionForm action={`/settings/stages/${s.key}/move`} hidden={{ dir: 'up' }}>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={prevFixed || undefined}
                          aria-label={t('settings.stage.moveUp', { label: s.label })}
                        >
                          ↑
                        </Button>
                      </ActionForm>
                      <ActionForm action={`/settings/stages/${s.key}/move`} hidden={{ dir: 'down' }}>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={nextFixed || undefined}
                          aria-label={t('settings.stage.moveDown', { label: s.label })}
                        >
                          ↓
                        </Button>
                      </ActionForm>
                      {s.count === 0 && work.length > 1 ? (
                        <ConfirmAction
                          action={`/settings/stages/${s.key}/remove`}
                          label={t('common.delete')}
                          ariaLabel={t('settings.stage.delete', { label: s.label })}
                          confirm={t('settings.stage.deleteConfirm', { label: s.label })}
                        />
                      ) : (
                        <span class="text-meta text-ink-faint">
                          {s.count > 0 ? t('settings.moveJobsOutToDelete') : t('settings.lastColumn')}
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
                placeholder={t('settings.newColumnPlaceholder')}
                required
                maxlength={40}
                aria-label={t('settings.newColumnName')}
                class="max-w-[14rem]"
              />
              <Button>{t('settings.addColumn')}</Button>
            </form>
          ) : (
            <Hint class="mt-4 border-t border-line pt-4">
              {t('settings.columnLimit', { n: MAX_WORK_STAGES })}
            </Hint>
          )}
        </div>
      </Section>
      )}

      {activeTab === 'notifications' && (
      <Section
        title={t('settings.notifications')}
        desc={t('settings.telegramChatsAndDiscordWebhooks')}
      >
        {/* Same spacing and rule as the General tab's toggle pair: bare
            siblings here had the two rows touching, so the second row's
            button looked like it belonged to the first. */}
        <div class="space-y-5">
          <ToggleRow label={t('settings.alerts')} enabled={telegramEnabled} action="/settings/telegram-toggle">
            {t('settings.offSendsNothingToAny')}
          </ToggleRow>
          <div class="border-t border-line pt-5">
            <ToggleRow
              label={t('settings.sourceHealthAlerts')}
              enabled={sourceHealthAlerts}
              action="/settings/source-health-toggle"
              more={t('settings.aBoardUsuallyGoesQuiet')}
            >
              {t('settings.oneLineInTheDaily')}
            </ToggleRow>
          </div>
        </div>

        {targets.length === 0 ? (
          <Empty bare title={t('settings.noTargetsYet')}>
            {t('settings.anAlertHasNowhereTo')}
          </Empty>
        ) : (
          /* Edge to edge of the surface: the table's header and hairlines are
             its own dividers, and its first column lines up with the section's text. */
          <div class="-mx-5 border-y border-line">
            <Table
              columns={[
                t('settings.name'),
                t('settings.channel'),
                t('settings.destination'),
                t('settings.lastUsed'),
                t('settings.activeColumn'),
                <span class="block text-right">{t('common.actions')}</span>,
              ]}
            >
              {targets.map((target) => (
                <Tr>
                  {/* The user's own name for it, the vendor and the masked secret: data. */}
                  <Td class="font-medium text-ink">
                    <span translate="no">{target.name}</span>
                  </Td>
                  <Td>
                    <Badge tone="neutral">
                      <span translate="no">{KIND_LABEL[target.kind]}</span>
                    </Badge>
                  </Td>
                  <Td class="font-mono text-meta text-ink-muted">
                    <span translate="no">{target.destination}</span>
                  </Td>
                  <Td class="whitespace-nowrap text-note text-ink-faint">
                    <When at={target.lastUsed} />
                  </Td>
                  <Td>
                    <ActionForm action={`/settings/targets/${target.id}/toggle`}>
                      {/* The badge shows the state; the button's name says the action and its
                          object — "Toggle" told a screen reader neither (audit A11Y-4). */}
                      <button
                        type="submit"
                        class="cursor-pointer rounded-full"
                        aria-label={t(target.active ? 'settings.target.disable' : 'settings.target.enable', { name: target.name })}
                        title={t(target.active ? 'settings.target.disable' : 'settings.target.enable', { name: target.name })}
                      >
                        <Badge tone={target.active ? 'ok' : 'neutral'}>
                          {target.active ? t('settings.active') : t('ui.disabled')}
                        </Badge>
                      </button>
                    </ActionForm>
                  </Td>
                  <Td>
                    <div class="flex justify-end gap-2">
                      <ActionForm action={`/settings/targets/${target.id}/test`}>
                        <Button size="sm" variant="secondary">
                          {t('settings.test')}
                        </Button>
                      </ActionForm>
                      <ConfirmAction action={`/settings/targets/${target.id}/delete`} label={t('common.delete')} confirm={t('settings.deleteThisTarget')} />
                    </div>
                  </Td>
                </Tr>
              ))}
            </Table>
          </div>
        )}

        {/* Two parts of the section, a hairline between them — beside each other from lg, stacked below. */}
        <div class="grid gap-6 lg:grid-cols-2">
          <div>
            <div class="mb-3 text-entity text-ink">{t('settings.addATelegramTarget')}</div>
            <form method="post" action="/settings/targets" class="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="kind" value="telegram" />
              <Field label={t('settings.name')}>
                <Input type="text" name="name" required placeholder={t('settings.myPhone')} />
              </Field>
              <Field label={t('settings.chatId')}>
                <Input type="text" name="chatId" required placeholder="-100…" mono translate="no" />
              </Field>
              <Field label={t('settings.botToken')} class="sm:col-span-2">
                <Input
                  type="password"
                  name="botToken"
                  required
                  autocomplete="off"
                  placeholder="123456789:ABC…"
                  mono
                  translate="no"
                />
              </Field>
              <div class="sm:col-span-2">
                <Button>{t('settings.addTarget')}</Button>
              </div>
            </form>
            <Hint class="mt-3">{t('settings.applypackSendsATestMessage')}</Hint>
          </div>
          <div class="border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <div class="mb-3 text-entity text-ink">{t('settings.addADiscordWebhook')}</div>
            <form method="post" action="/settings/targets" class="grid gap-3">
              <input type="hidden" name="kind" value="discord" />
              <Field label={t('settings.name')}>
                <Input type="text" name="name" required placeholder="#job-alerts" translate="no" />
              </Field>
              <Field
                label={t('settings.webhookUrl')}
                more={t('settings.inDiscordServerSettingsIntegrations')}
              >
                <Input
                  type="password"
                  name="webhookUrl"
                  required
                  autocomplete="off"
                  placeholder="https://discord.com/api/webhooks/…"
                  mono
                  translate="no"
                />
              </Field>
              <div>
                <Button>{t('settings.addWebhook')}</Button>
              </div>
            </form>
            <Hint class="mt-3">
              {t('settings.applypackPostsATestMessage')}
            </Hint>
          </div>
        </div>
      </Section>
      )}

      {activeTab === 'sources' && (
      <>
      <Section
        title={t('settings.jobSources')}
        desc={t('settings.switchAWholeSourceFamily')}
      >
        <form method="post" action="/settings/sources" class="space-y-4">
          {sourceGroups.map((g) => (
            <div>
              <div class="text-label text-ink">{g.title}</div>
              <p data-ui="hint" class="mb-2 text-meta leading-5 text-ink-faint">{g.caption}</p>
              <div class="flex flex-wrap gap-1.5">
                {g.pills.map((p) => (
                  <PillCheckbox name="enabled" value={p.atsType} checked={!disabledSources.includes(p.atsType)}>
                    <span translate="no">{p.label}</span>
                    <span data-ui="hint" class="text-meta text-ink-faint">
                      {p.locked ? (
                        <a href="#source-keys" class="text-warn hover:underline">
                          {t('settings.needsAKey')}
                        </a>
                      ) : p.atsType === 'HN_HIRING' && !hnParserEnabled ? (
                        <a href="/discovery" class="text-warn hover:underline">
                          {t('settings.parserOffOnDiscovery')}
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
            {t('settings.keepTheAggregatorsOnThey')}
          </Hint>
          <Button variant="secondary">{t('settings.saveSources')}</Button>
        </form>
      </Section>
      <SourceKeysSection rows={sourceKeyRows} />
      </>
      )}

      {activeTab === 'general' && loginItem.available && (
      <Section
        id="login"
        title={t('settings.startWithThisComputer')}
        desc={t('settings.applypackSearchesOnlyWhileIt')}
      >
        <div class="flex flex-wrap items-center gap-3">
          <Badge tone={loginItem.on ? 'ok' : 'neutral'}>{loginItem.on ? t('settings.startsAtLogin') : t('settings.off')}</Badge>
          <ActionForm action="/settings/login-item" hidden={{ on: loginItem.on ? '0' : '1' }}>
            <Button size="sm" variant={loginItem.on ? 'secondary' : 'primary'}>
              {loginItem.on ? t('settings.stopStartingAtLogin') : t('settings.startApplypackWhenILog')}
            </Button>
          </ActionForm>
        </div>
        <Hint>
          {tRich(loginItem.on ? 'settings.login.on' : 'settings.login.off', { kind: loginItem.kind ?? '' }, {
            file: () => (
              <span class="break-all font-mono text-meta" translate="no">
                {loginItem.file}
              </span>
            ),
          })}
        </Hint>
      </Section>
      )}

      {activeTab === 'general' && (
      <Section id="language" title={t('settings.language.title')} desc={t('settings.language.desc')}>
        <LanguageSettings />
      </Section>
      )}

      {activeTab === 'general' && (
      <Section id="updates" title={t('settings.updates')} desc={t('settings.updatesDesc', { version: updates.current })}>
        <ToggleRow
          label={t('settings.newVersions')}
          enabled={updates.enabled}
          action="/settings/update-check-toggle"
          onLabel={t('settings.checkingWeekly')}
          offLabel={t('settings.off')}
          enableText={t('settings.checkWeekly')}
          disableText={t('settings.stopChecking')}
          more={t('settings.oneRequestAWeekTo')}
        >
          {t('settings.sayInTheSidebarWhen')}
        </ToggleRow>
        {updates.enabled && updates.checkedAt && <UpdateLine {...updates} checkedAt={updates.checkedAt} />}
      </Section>
      )}

      {activeTab === 'general' && (
      <Section
        title={t('settings.resumes')}
        desc={t('settings.theResumesYouSendOut')}
      >
        <div>
          {resumes.length > 0 ? (
            <ul class="divide-y divide-line">
              {resumes.map((r) => (
                <li class="flex flex-wrap items-center gap-2 py-2.5 text-sm first:pt-0 last:pb-0">
                  <a
                    href={`/resumes/${r.id}`}
                    class="font-medium text-ink transition-colors duration-150 hover:text-accent-strong"
                    translate="no"
                  >
                    {r.name}
                  </a>
                  {r.isDefault && <Badge tone="ok">{t('settings.resumeDefault')}</Badge>}
                  {!r.scannedAt && <Badge tone="warn">{t('settings.notScanned')}</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty bare title={t('settings.noResumesYet')}>
              {t('settings.aJobPageComparesAnd')}
            </Empty>
          )}
          <a href="/resumes" class="mt-3 inline-block text-note font-medium text-accent-strong hover:text-accent-deep">
            {t('settings.uploadManageResumes')}
          </a>
        </div>
      </Section>
      )}

      {activeTab === 'screening' && (
      <Section
        title={t('settings.employerMode')}
        desc={t('settings.theOtherSideOfThe')}
      >
        <ToggleRow
          label={t('settings.employerMode')}
          enabled={screening.enabled}
          action="/settings/employer-mode-toggle"
          onLabel={t('settings.on')}
          offLabel={t('settings.off')}
          enableText={t('settings.turnOn')}
          disableText={t('settings.turnOff')}
          more={t('settings.aScreeningIsOnePosition')}
        >
          {screening.enabled
            ? tRich('settings.employerHintOpen', {}, {
                link: (words) => (
                  <a href="/screen" class="font-medium text-accent-strong hover:text-accent-deep">
                    {words}
                  </a>
                ),
              })
            : screening.screenings > 0
              ? t('settings.employerHintHidden', { n: screening.screenings })
              : t('settings.employerHint')}
        </ToggleRow>
      </Section>
      )}

      {activeTab === 'screening' && (
      <Section title={t('settings.retention')} desc={t('settings.applicantsFilesAndEveryVerdict')}>
        <div>
          <form method="post" action="/settings/screening-retention" class="flex flex-wrap items-end gap-3">
            <Field label={t('settings.keepAScreeningFor')} hint={t('settings.retentionHint', { min: screening.retentionMin, max: screening.retentionMax })}>
              <div class="flex items-center gap-2">
                <Input type="number" name="days" min={screening.retentionMin} max={screening.retentionMax} value={screening.retentionDays} class="w-28" />
                <span class="text-sm text-ink-muted">{t('settings.retentionDaysUnit')}</span>
              </div>
            </Field>
            <Button variant="secondary">{t('common.save')}</Button>
          </form>
          <Hint class="mt-3">
            {t('settings.theWeeklyCleanupDeletesWhat')}
          </Hint>
        </div>
      </Section>
      )}

      {activeTab === 'screening' && (
      <Section title={t('settings.whichEngineReadsApplicants')} desc={t('settings.everyScreeningCallGoesTo')}>
        <div>
          <p class="text-sm text-ink">
            {tRich('settings.answersScreeningNow', { engine: screening.engineLabel }, {
              b: (words) => (
                <span class="font-medium" translate="no">
                  {words}
                </span>
              ),
            })}
            {screening.engineSubscription ? (
              <Badge tone="warn" class="ml-2">
                {t('settings.personalSubscription')}
              </Badge>
            ) : (
              <Badge tone="ok" class="ml-2">
                {t('settings.apiOrLocal')}
              </Badge>
            )}
          </p>
          <Hint class="mt-2">
            {screening.engineSubscription
              ? t('settings.aCliOnAPersonal')
              : t('settings.anApiOrALocal')}{' '}
            {t('settings.changeWhoTakesScreening')}
          </Hint>
        </div>
      </Section>
      )}

      {activeTab === 'screening' && (
      <Section title={t('settings.whatThisMeansLegally')} desc={t('settings.notLegalAdviceTheFacts')}>
        {/* The legal note and the notice are legal texts (screening/notice.ts): English in every language. */}
        <p class="text-sm leading-6 text-ink-muted" lang="en">
          {screening.legalNote}
        </p>
        <div class="border-t border-line pt-5">
          <div class="flex flex-wrap items-baseline justify-between gap-3">
            <SectionTitle>{t('settings.noticeForApplicants')}</SectionTitle>
            <Button variant="secondary" size="sm" type="button" data-copy={screening.notice}>
              {t('common.copy')}
            </Button>
          </div>
          <Hint>
            {t('settings.pasteItIntoThePosting')}
          </Hint>
          <pre class="mt-3 whitespace-pre-wrap rounded-md bg-surface-overlay p-3 font-sans text-note leading-5 text-ink" lang="en">{screening.notice}</pre>
        </div>
      </Section>
      )}
      </Card>
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

const SourceKeysSection: FC<{ rows: SourceKeyRow[] }> = ({ rows }) => (
  <Section
    id="source-keys"
    title={t('settings.extraSourcesAFreeAccount')}
    desc={t('settings.twoWiderSourcesEachBehind')}
  >
    {/* A divider between the vendors — not a bordered box inside the section. */}
    <div class="divide-y divide-line">
      {rows.map((r) => (
        <div class="py-4 first:pt-0 last:pb-0">
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span class="text-entity text-ink" translate="no">
              {r.label}
            </span>
            <Badge tone={r.ready ? 'ok' : 'neutral'}>{r.ready ? t('settings.ready') : t('settings.notSetUp')}</Badge>
          </div>
          <p data-ui="hint" class="mt-1 text-sm leading-5 text-ink-muted">{r.what}</p>
          <More summary={t('settings.whenItIsWorthIt')} class="mt-1">
            <p>
              <span class="font-medium text-ink-muted">{t('settings.worthItIf')}</span> {r.worthIt}
            </p>
            <p>
              <span class="font-medium text-ink-muted">{t('settings.inExchange')}</span> {r.cost}
            </p>
          </More>
          <p class="mt-1.5 text-note leading-5">
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
              <div class="flex min-w-[9rem] flex-col gap-1 text-meta text-ink-muted">
                {/* The vendor's own name for the field, as its sign-up page writes it. */}
                <span class="font-medium text-ink" translate="no">
                  {f.label}
                </span>
                {f.origin === 'db' && (
                  <span>
                    <Badge tone="ok">{t('settings.saved')}</Badge>{' '}
                    <span class="font-mono" translate="no">
                      {f.masked}
                    </span>
                  </span>
                )}
                {f.origin === 'env' && <Badge tone="neutral">{t('settings.fromEnv')}</Badge>}
                {f.origin === 'none' && (
                  <span class="text-ink-faint" translate="no">
                    {f.envVar}
                  </span>
                )}
              </div>
              <Input
                type="password"
                name="key"
                autocomplete="off"
                spellcheck="false"
                aria-label={t('settings.sourceKeyField', { source: r.label, field: f.label })}
                placeholder={f.origin === 'db' ? t('settings.pasteANewOneTo') : t('settings.pasteItHere')}
                mono
                class="min-w-[14rem] flex-1"
              />
              <Button variant="secondary">
                {t('common.save')}
              </Button>
              {f.origin === 'db' && (
                <Button size="sm" variant="danger" name="clear" value="1">
                  {t('common.remove')}
                </Button>
              )}
            </form>
          ))}
          <Hint class="mt-2">
            {r.ready
              ? t('settings.readyAddItOnCompanies')
              : t('settings.onceBothValuesAreSaved')}
          </Hint>
        </div>
      ))}
    </div>
  </Section>
);

/**
 * Paste-a-credential row (ADR 0027). The field is always empty: a stored key
 * is only ever described (last four characters, where it came from), so the
 * page can never hand the secret back or have a mask saved over the real one.
 * A well inside the engine's row: the credential is one group of controls.
 */
const EngineKeyRow: FC<{ engine: AiEngineRow }> = ({ engine: e }) => {
  // A login-token engine names its credential a token, every other one a key: each wording is a message of its own.
  const token = e.keyEnvVar?.endsWith('_TOKEN') ?? false;
  const envVar = e.keyEnvVar ?? '';
  return (
    <Card variant="subtle" class="mt-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-label text-ink">{token ? t('settings.accessToken') : t('settings.apiKey')}</span>
        {e.keySource === 'db' && (
          <>
            <Badge tone="ok">{t('settings.saved')}</Badge>
            <span class="font-mono text-meta text-ink-muted" translate="no">
              {e.maskedKey}
            </span>
          </>
        )}
        {e.keySource === 'env' && <Badge tone="neutral">{t('settings.fromEnv')}</Badge>}
        {e.keySource === 'db' && (
          <ConfirmAction
            action="/settings/ai/key"
            hidden={{ provider: e.id, clear: '1' }}
            label={t('common.remove')}
            confirm={t(token ? 'settings.removeSavedToken' : 'settings.removeSavedKey', { engine: e.label })}
            class="ml-auto"
          />
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
          aria-label={t(token ? 'settings.engineToken' : 'settings.engineKey', { engine: e.label })}
          placeholder={e.keySource === 'db' ? t('settings.pasteANewOneTo') : t('settings.pasteItHere')}
          mono
          class="min-w-[16rem] flex-1"
        />
        <Button variant="secondary">
          {t('common.save')}
        </Button>
      </form>
      <Hint class="mt-2">
        {e.keySource === 'db'
          ? t('settings.keySavedInDatabase', { envVar })
          : e.keySource === 'env'
            ? t('settings.keyReadFromEnv', { envVar })
            : e.server?.local
              ? t('settings.aServerOnThisMachine')
              : t('settings.keyStoredInDatabase', { envVar })}
      </Hint>
    </Card>
  );
};

/**
 * Where the OpenAI-compatible engine sends its calls (TASKS S1): OpenAI, or
 * any server that speaks /v1/chat/completions — Ollama, LM Studio, vLLM, a
 * proxy. Stored in the database like a key, so a local model needs no .env
 * edit; the address decides whether the key row matters at all.
 */
const EngineServerRow: FC<{ server: EngineServer }> = ({ server }) => (
  <Card variant="subtle" class="mt-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-label text-ink">{server.label}</span>
      <Badge tone="neutral">{server.stored ? t('settings.saved') : t('settings.fromEnv')}</Badge>
      {server.local && <Badge tone="ok">{t('settings.onThisMachineNoKey')}</Badge>}
      {server.stored && (
        <ActionForm action={server.action} hidden={{ clear: '1' }} class="ml-auto">
          <Button size="sm" variant="secondary" title={t('settings.forgetThisAddress', { envVar: server.envVar })}>
            {t('settings.useEnv')}
          </Button>
        </ActionForm>
      )}
    </div>
    <form method="post" action={server.action} class="mt-2.5 flex flex-wrap items-end gap-2">
      <Input
        type="text"
        inputmode="url"
        name="baseUrl"
        required
        autocomplete="off"
        spellcheck="false"
        aria-label={server.label}
        value={server.value}
        mono
        class="min-w-[16rem] flex-1"
      />
      <Button variant="secondary">
        {t('common.save')}
      </Button>
    </form>
    <Hint class="mt-2">{server.hint}</Hint>
    {server.more && <More class="mt-1">{server.more}</More>}
    {server.context && (
      <form method="post" action={server.action} class="mt-3 flex flex-wrap items-end gap-2">
        <Field
          label={t('settings.contextWindow')}
          hint={t('settings.roomForThePromptAnd')}
        >
          <Select name="contextTokens" class="w-auto">
            {server.context.choices.map((n) => (
              <option value={String(n)} selected={n === server.context!.value}>
                {t('settings.contextTokens', { k: n / 1024 })}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="secondary">
          {t('settings.saveWindow')}
        </Button>
      </form>
    )}
  </Card>
);

/**
 * One engine: a row of the AI engines section, not a card of its own. The
 * section draws the hairline between engines, so nothing inside one draws
 * another — a rule above the model pickers would read as the next engine.
 */
const AiEngine: FC<{ engine: AiEngineRow }> = ({ engine: e }) => (
  <Card variant="flat" class={`py-5 last:pb-0 ${e.enabled || e.lastResort ? '' : 'opacity-75'}`}>
    <div class="flex flex-wrap items-center gap-2">
      {e.enabled && <Badge tone="neutral">#{e.position + 1}</Badge>}
      <span class="text-entity text-ink" translate="no">
        {e.label}
      </span>
      <Badge tone={e.ok ? 'ok' : 'neutral'}>{e.ok ? t('settings.available') : t('settings.notDetected')}</Badge>
      {e.lastResort && <Badge tone="warn">{t('settings.lastResort')}</Badge>}
      <Badge tone={BILLING_TONE[e.billing]}>{billingWords(e.billing)}</Badge>
      <div class="ml-auto flex flex-wrap justify-end gap-2">
        {e.enabled && e.position > 0 && (
          <ActionForm action="/settings/ai/move" hidden={{ provider: e.id }}>
            <Button size="sm" variant="secondary" title={t('settings.moveOneStepUpThe')}>
              {t('settings.priority')}
            </Button>
          </ActionForm>
        )}
        <ActionForm action="/settings/ai/test" hidden={{ provider: e.id }}>
          <Button size="sm" variant="violet" title={t('settings.runATinyLiveCall')}>
            {t('settings.test')}
          </Button>
        </ActionForm>
        {e.canToggle && (
          <ActionForm action="/settings/ai/enable" hidden={{ provider: e.id }}>
            <Button size="sm" variant={e.enabled ? 'secondary' : 'primary'}>
              {e.enabled ? t('ui.disable') : t('ui.enable')}
            </Button>
          </ActionForm>
        )}
      </div>
    </div>
    {/* The live state stays in sight; what the engine is sits one press away. */}
    <Hint class="mt-1.5">{e.detail}</Hint>
    <More summary={t('settings.whatThisEngineIs')} class="mt-1">
      {e.desc}
    </More>
    {e.lastResort && (
      <Hint class="mt-1.5 text-warn">
        {t('settings.noEngineInTheList')}
      </Hint>
    )}
    {!e.canToggle && (
      <Hint class="mt-1.5">{t('settings.theOnlyEngineInThe')}</Hint>
    )}
    {e.server && <EngineServerRow server={e.server} />}
    {e.keyEnvVar && <EngineKeyRow engine={e} />}
    {(e.enabled || e.lastResort) && (
      <form
        method="post"
        action="/settings/ai/models"
        data-model-form
        class="mt-4"
      >
        <input type="hidden" name="provider" value={e.id} />
        {e.freeTextModels && e.options.length > 0 && (
          <datalist id={`models-${e.id}`}>
            {e.options.map((m) => (
              <option value={m} />
            ))}
          </datalist>
        )}
        <div class="grid grid-cols-[repeat(auto-fit,minmax(min(19.5rem,100%),1fr))] gap-3">
        <Field label={t('settings.classifierModel')} hint={t('settings.scoresEveryFetchedJobKeep')}>
          <ModelPicker
            name="classifier"
            value={e.classifierModel}
            fallback={e.classifierDefault}
            options={e.options}
            freeText={e.freeTextModels}
            list={e.freeTextModels && e.options.length > 0 ? `models-${e.id}` : undefined}
          />
        </Field>
        <Field label={t('settings.resumeModel')} hint={t('settings.resumeScanMatchAndVerification')}>
          <ModelPicker
            name="resume"
            value={e.resumeModel}
            fallback={e.resumeDefault}
            options={e.options}
            freeText={e.freeTextModels}
            list={e.freeTextModels && e.options.length > 0 ? `models-${e.id}` : undefined}
          />
        </Field>
        <Field label={t('settings.coverLetterModel')} hint={t('settings.writingQualityNotAnalysis')}>
          <ModelPicker
            name="cover"
            value={e.coverModel}
            fallback={e.coverDefault}
            options={e.options}
            freeText={e.freeTextModels}
            list={e.freeTextModels && e.options.length > 0 ? `models-${e.id}` : undefined}
          />
        </Field>
        {e.id === 'claude_code' && /haiku/.test(e.resumeModel || e.resumeDefault) && (
          <Hint class="col-span-full">
            {t('settings.measured20260905On')}
          </Hint>
        )}
        </div>
        <div class="mt-3 flex items-center gap-3">
          {/* The no-JS path: settings-models.mjs hides this and saves on change. */}
          <Button size="sm" variant="secondary" data-save-button>
            {t('settings.saveModels')}
          </Button>
          <span
            class="text-meta text-ink-faint"
            data-save-status
            role="status"
            aria-live="polite"
          ></span>
        </div>
      </form>
    )}
    {e.enabled && <EngineTasks engine={e} />}
  </Card>
);

/** The tasks an engine takes (ADR 0060): every box ticked until the user narrows it. */
const EngineTasks: FC<{ engine: AiEngineRow }> = ({ engine: e }) => (
  <form method="post" action="/settings/ai/tasks" data-model-form class="mt-4">
    <input type="hidden" name="provider" value={e.id} />
    <fieldset>
      <legend class="text-label text-ink">{t('settings.tasksItTakes')}</legend>
      <div class="mt-2 flex flex-wrap gap-2">
        {e.tasks.map((task) =>
          task.offered ? (
            <PillCheckbox name="tasks" value={task.id} checked={task.taken}>
              {task.label}
            </PillCheckbox>
          ) : (
            <PillCheckbox name="tasks" value={task.id} disabled>
              {task.label}
            </PillCheckbox>
          ),
        )}
      </div>
    </fieldset>
    <Hint class="mt-2">
      {t('settings.tasksHint')}
      {e.tasks.some((task) => !task.offered) && <> {t('settings.tasksNoWebCheck')}</>}
    </Hint>
    <div class="mt-3 flex items-center gap-3">
      <Button size="sm" variant="secondary" data-save-button>
        {t('settings.saveTasks')}
      </Button>
      <span class="text-meta text-ink-faint" data-save-status role="status" aria-live="polite"></span>
    </div>
  </form>
);

/** Closed families get a select (no wrong-family ids possible); base-URL
 *  engines (openai_api) get free text — any model id may be legal there —
 *  with the models the server listed as suggestions (`list`, TASKS S3). */
const ModelPicker: FC<{
  name: string;
  value: string;
  fallback: string;
  options: string[];
  freeText: boolean;
  list?: string;
}> = ({ name, value, fallback, options, freeText, list }) =>
  freeText ? (
    // A model id is typed and suggested here: data, whatever the page's language.
    <Input type="text" name={name} value={value} placeholder={fallback || t('settings.modelId')} list={list} autocomplete="off" mono translate="no" />
  ) : (
    <Select name={name}>
      <option value="" selected={value === ''}>
        {t('settings.modelDefault', { model: fallback })}
      </option>
      {options.map((m) => (
        <option value={m} selected={value === m} translate="no">
          {m}
        </option>
      ))}
    </Select>
  );

/** One line under each relocation choice, as catalog keys — editor copy, not vocabulary. */
const RELOCATION_HINT = {
  no: 'relocation.hint.no',
  yes: 'relocation.hint.yes',
  sponsorship: 'relocation.hint.sponsorship',
} as const satisfies Record<(typeof RELOCATION_CODES)[number], MessageKey>;

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
    {/* Warn, not violet: an unsaved draft, the state "Unsaved changes" names in warn too.
        Violet is for the button that spends the AI (DESIGN.md), not for what it wrote. */}
    {draft && (
      <Notice tone="warn" role="status">
        {tRich(
          draft.warnings.length > 0 ? 'settings.draftNoticeWarned' : 'settings.draftNotice',
          { resume: draft.resumeName, changed: draft.changed.join(', '), warnings: draft.warnings.join('; ') },
          { b: (words) => <span class="font-medium">{words}</span> },
        )}
      </Notice>
    )}
    <div class="grid gap-4 sm:grid-cols-2">
      <Field label={t('settings.name')} hint={t('settings.yoursAloneNothingReadsIt')}>
        <Input type="text" name="name" required value={profile.name} />
      </Field>
      <Field
        label={t('settings.resumeForThisSearch')}
        hint={t('settings.preselectedOnTheJobPages')}
      >
        <Select name="resumeId">
          <option value="" selected={profile.resumeId === null}>
            {t('settings.pickBySkillOverlap')}
          </option>
          {resumes.map((r) => (
            <option value={r.id} selected={profile.resumeId === r.id}>
              {resumeOption(r)}
            </option>
          ))}
        </Select>
      </Field>
    </div>

    <fieldset class="space-y-4">
      <legend class="text-label text-ink">{t('settings.whatAreWeHuntingFor')}</legend>
      <Hint class="!mt-0.5">
        {t('settings.technologiesGoInTheRequired')}
      </Hint>
      <TagListInput
        label={t('settings.techStackRequired')}
        name="stackRequired"
        values={profile.stackRequired}
        placeholder={t('settings.phpLaravelMysql')}
      />
      <TagListInput
        label={t('settings.roleTypes')}
        hint={t('settings.titleShapesYouAcceptThey')}
        name="roleTypes"
        values={profile.roleTypes}
        placeholder={t('settings.backendFullStack')}
      />
      <TagListInput
        label={t('settings.stackNiceToHave')}
        hint={t('settings.raiseTheFitScoreWhen')}
        name="stackNiceToHave"
        values={profile.stackNiceToHave}
        placeholder={t('settings.dockerAws')}
      />
    </fieldset>

    <fieldset>
      <legend class="text-label text-ink">{t('settings.seniority')}</legend>
      <div class="mt-2 flex flex-wrap gap-1.5">
        {SENIORITY_LEVELS.map((s) => (
          <PillCheckbox name="seniority" value={s} checked={profile.seniority.includes(s)}>
            {t(`settings.seniority.${s}`)}
          </PillCheckbox>
        ))}
      </div>
    </fieldset>

    <fieldset class="space-y-3">
      <legend class="text-label text-ink">{t('settings.locationLegend')}</legend>
      <Hint class="!mt-0.5">{t('settings.countriesAndRegionsAddUp')}</Hint>
      <div>
        <div class="text-label text-ink">{t('settings.arrangementsYouAccept')}</div>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          {PROFILE_WORKPLACES.map((w) => (
            <PillCheckbox name="workplace" value={w} checked={profile.workplace.includes(w)}>
              {workplaceName(w)}
            </PillCheckbox>
          ))}
        </div>
      </div>
      <TagListInput
        label={t('settings.countries')}
        hint={t('settings.typeACountryInAny')}
        more={t('settings.polandPolskaAndPlAll')}
        name="countries"
        // Each line goes back through the form: the flag is what the save reads, so the name may be in any language.
        values={profile.countries.map((c) => `${flagOf(c)} ${placeName(c)}`)}
        placeholder={t('settings.polandGermanyNetherlands')}
        rows={2}
        picker="countries"
      />
      <div>
        <div class="text-label text-ink">{t('settings.regions')}</div>
        <Hint class="mt-0.5">{t('settings.aGroupCountsAsA')}</Hint>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          {REGIONS.map((r) => (
            <PillCheckbox name="regions" value={r.code} checked={profile.regions.includes(r.code)}>
              {r.flag ? `${r.flag} ${placeName(r.code)}` : placeName(r.code)}
            </PillCheckbox>
          ))}
        </div>
      </div>
      <Field
        label={t('settings.iLiveIn')}
        hint={t('settings.notAPlaceThisSearch')}
      >
        <Select name="residence">
          <option value="" selected={!profile.residence}>
            {t('settings.notSet')}
          </option>
          {COUNTRIES.map((c) => (
            <option value={c.code} selected={profile.residence === c.code}>
              {c.flag} {placeName(c.code)}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <div class="text-label text-ink">{t('settings.ifTheRoleIsSomewhere')}</div>
        <div class="mt-1.5 grid gap-2 sm:grid-cols-3">
          {RELOCATION_CODES.map((r) => (
            <Radio
              name="relocation"
              value={r}
              checked={(profile.relocation ?? 'no') === r}
              title={t(RELOCATION_LABEL[r])}
            >
              {t(RELOCATION_HINT[r])}
            </Radio>
          ))}
        </div>
      </div>
    </fieldset>

    <details class="rounded-md border border-line" open={advancedOpen}>
      <summary class="cursor-pointer select-none rounded-md px-4 py-3 text-note font-medium text-ink transition-colors duration-150 hover:text-accent-strong">
        {t('settings.advancedSummary')}
        <span class="ml-2 font-normal text-ink-faint">
          {t('settings.advancedSummaryNote')}
        </span>
      </summary>
      <div class="space-y-5 border-t border-line px-4 py-4">
        <TagListInput
          label={t('settings.stackExcludeAutoRejectIn')}
          hint={t('settings.ifTheTitleContainsAny')}
          name="stackExclude"
          values={profile.stackExclude}
        />

        <Field
          label={t('settings.notesForTheClassifier')}
          hint={t('settings.freeFormContextAiAdjacent')}
        >
          <Textarea name="notes" rows={3}>
            {profile.notes ?? ''}
          </Textarea>
        </Field>

        <TagListInput
          label={t('settings.onSiteCitiesOkTo')}
          hint={t('settings.onePerLineAustinTx')}
          name="onsiteCities"
          values={profile.onsiteCities}
          rows={2}
        />

        <PriorityRulesEditor profile={profile} />

        <div class="grid gap-4 sm:grid-cols-3">
          <Field label={t('settings.minSalaryUsdYear')} hint={t('settings.n0NoSalaryFilter')}>
            <Input
              type="number"
              name="minSalaryUsd"
              min="0"
              step="1000"
              value={profile.minSalaryUsd}
            />
          </Field>
          <Field label={t('settings.minFitScore0100')} hint={t('settings.jobsBelowItAreStored')}>
            <Input type="number" name="minFitScore" min="0" max="100" value={profile.minFitScore} />
          </Field>
          <Field label={t('settings.alertTarget')}>
            <Select name="notificationTargetId">
              <option value="" selected={profile.notificationTargetId === null}>
                {t('settings.broadcastToAllActive')}
              </option>
              {availableTargets.map((target) => (
                <option value={target.id} selected={profile.notificationTargetId === target.id}>
                  {t('settings.targetOption', { name: target.name, kind: KIND_LABEL[target.kind], active: target.active ? 'yes' : 'no' })}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </details>

    <div class="flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <Button size="lg">{t('settings.saveProfile')}</Button>
      <Button
        size="lg"
        variant="violet"
        name="action"
        value="save-and-reclassify"
        onclick={confirmScript(t('settings.reclassifyConfirm'))}
      >
        {t('settings.saveReClassify')}
      </Button>
      <span data-dirty-indicator hidden={!draft} class="text-note font-medium text-warn">
        {t('settings.unsavedChanges')}
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
      <summary class="cursor-pointer select-none rounded-md px-4 py-3 text-note font-medium text-ink transition-colors duration-150 hover:text-accent-strong">
        {t('settings.priorityRulesSummary')}
        <span class="ml-2 font-normal text-ink-faint">
          {rules.length > 0 ? t('settings.rulesSet', { n: rules.length }) : t('settings.noneSet')}
        </span>
      </summary>
      <div class="border-t border-line px-4 py-4">
        {/* The rule grammar and its sample values are written in code: the sentence places them, a translator never retypes them. */}
        <Hint>
          {tRich('settings.priorityRulesHint', {}, {
            format: () => <Code>LABEL | techs,csv | regions,csv | MIN_FIT</Code>,
            hash: () => <Code>#</Code>,
          })}
        </Hint>
        {rules.length > 0 && (
          <Hint class="mt-1 text-warn">
            {tRich('settings.priorityRulesRegions', {}, {
              phrase: () => <Code>Remote US</Code>,
              bare: () => <Code>Remote</Code>,
              list: () => <Code>Remote US,United States,USA,Worldwide</Code>,
            })}
          </Hint>
        )}
        <Textarea
          name="priorityRules"
          aria-label={t('settings.priorityRules')}
          rows={Math.max(3, rules.length + 1)}
          placeholder="Python remote-US | python | Remote US,United States,USA,Worldwide | 90"
          class="mt-1.5"
          mono
          translate="no"
        >
          {text}
        </Textarea>
        {rules.length > 0 && (
          <div class="mt-2 flex flex-wrap gap-1.5" translate="no">
            {rules.map((r) => (
              <Tag>
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
