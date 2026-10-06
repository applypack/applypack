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
  Field,
  FitBadge,
  Flash,
  Hint,
  Input,
  SectionTitle,
  Select,
  StatusBadge,
  Tabs,
  Tag,
  Textarea,
  type ButtonVariant,
} from '../ui';
import { toCheckInterval } from '../../watchlist/interval';
import { formatDate, formatRelative, formatSalary, safeHref } from '../format';
import { techLabel } from '../tech-label';
import { AdzunaLabel, FranceTravailLine, JsonTree } from './attribution';
import { formatUsdPerYear } from '../../currency';
import { flagOf } from '../../countries';
import type { WorkplaceCode } from '../../location';
import { appliedWithLabel } from '../../jobs/applied-with';
import { needsAppliedResume } from '../applied-resume';
import type { FlashMessage } from '../flash';
import type { JobTab } from '../job-tabs';
import { jobHref } from '../job-tabs';
import { CoverLetterCard, type CoverLetterCardProps } from './cover-letter-card';
import { notEnglishNotice } from '../../text-language';
import { ResumeMatchCard, type ResumeMatchCardProps } from './resume-match-card';
import { VerificationCard, type VerificationCardProps } from './verification-card';
import { livenessCodeLabel } from '../../verification/liveness';
import type { MessageKey } from '../../i18n/catalog';
import { placeName, workplaceName } from '../../i18n/places';
import { t } from '../../i18n/t';
import { tRich } from '../rich';
import { ApplicationPackCard, type ApplicationPackProps } from './application-pack-card';

interface JobDetail {
  id: number;
  /** ADR 0062: the file of a folder source the job came from. */
  sourceFile: string | null;
  title: string;
  url: string;
  location: string;
  /** ADR 0031: the structured reading of `location`, shown as chips under it. */
  workplace: WorkplaceCode;
  countries: string[];
  regions: string[];
  description: string;
  /** ADR 0043: set when the description was replaced with the company's own listing (the original kept) or restored. */
  descriptionOriginal: string | null;
  descriptionRefreshedAt: Date | null;
  fitScore: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  /** ADR 0034: the offer as the source sent it, and the source's own last update. */
  sourcePayload: unknown;
  sourceUpdatedAt: Date | null;
  techMatch: string[];
  redFlags: string[];
  summary: string | null;
  status: JobStatus;
  fetchedAt: Date;
  postedAt: Date;
  alertedAt: Date | null;
  externalId: string;
  /** ADR 0056: who hires, when an aggregator named them. */
  employer: string | null;
  company: {
    id: number;
    name: string;
    atsType: string;
    atsToken: string;
    /** §17: on the user's watchlist, and how it is checked (ADR 0036). */
    watched: boolean;
    checkEvery: string;
    alertPolicy: string;
  };
  appliedAt: Date | null;
  appliedResumeId: number | null;
  appliedResumeVersion: number | null;
  /** The resume's words as they were on the day — a version is edited in place (#74). */
  appliedResumeText: string | null;
  /** null once the resume row is deleted — the snapshot outlives it. */
  appliedResume: { name: string } | null;
  pipelineStage: string | null;
  recruiterContact: string | null;
  applicationNotes: string | null;
  priorityRulesApplied: string[];
  liveness: string | null;
  livenessCode: string | null;
  livenessCheckedAt: Date | null;
  // F3 (ADR 0018): the same posting seen at another company's source.
  crossListedOf: CrossListedJob | null;
  crossListings: CrossListedJob[];
}

export interface MuteState {
  name: string;
  key: string;
  muted: { reason: string | null; since: Date } | null;
}

export interface CrossListedJob {
  id: number;
  title: string;
  company: { name: string };
}

/** One running search's verdict on this posting (ADR 0028). */
export interface ProfileScore {
  profileId: number;
  name: string;
  active: boolean;
  fitScore: number;
  locationMatch: boolean;
  /** Why the columns say it is a mismatch; null when only the summary can tell. */
  locationReason: string | null;
  summary: string | null;
}

export interface JobDetailProps {
  job: JobDetail;
  /** Resumes offered by "Mark applied", and the one it starts on. */
  appliedResumePicker: { resumes: { id: number; name: string }[]; suggestedId: number | null };
  /** Every search that has scored this posting, best first. */
  profileScores: ProfileScore[];
  applicationTrackingEnabled: boolean;
  /** Configured funnel stages in order (ADR 0025). */
  pipelineStages: { key: string; label: string }[];
  verification: VerificationCardProps['verification'];
  verificationCount: number;
  /** A verify run in flight for this job — the card points at its progress page instead of a second button (#161). */
  verificationRun: VerificationCardProps['run'];
  /** What the AI research usually costs here; null until there are three. */
  verifyCostHint: string | null;
  /** What the AI spent on this posting so far (ai-spend.ts:jobSpendText); null when nothing was recorded. */
  aiSpent: string | null;
  /** Who this posting's company is to the mute list (ADR 0056); null when nobody said who hires. */
  mute: MuteState | null;
  resumeMatch: ResumeMatchCardProps;
  coverLetters: CoverLetterCardProps;
  applicationPack: ApplicationPackProps;
  /** The tab this request means (job-tabs.ts), and the four labels with what exists behind each. */
  tab: JobTab;
  tabs: { tab: JobTab; label: string }[];
  flash?: FlashMessage | null;
}

/** How often the pack tab reloads while a pack is being prepared; a step takes from a second to a few minutes. */
const PACK_REFRESH_SECONDS = 8;

/** The id the out-of-form select and the in-row button both post through. */
const MARK_APPLIED_FORM = 'mark-applied';

// "Mark applied" is not in this list: it posts through MARK_APPLIED_FORM so the
// resume select can sit above the row while the button stays inside it.
// Each label is the catalog key of the button's word, read when the page renders.
const STATUS_ACTIONS: { status: JobStatus; label: MessageKey; variant: ButtonVariant }[] = [
  { status: 'SAVED', label: 'job.action.save', variant: 'violet' },
  { status: 'DISMISSED', label: 'job.action.dismiss', variant: 'secondary' },
  { status: 'NEW', label: 'job.action.reopen', variant: 'secondary' },
];

export const JobDetailPage: FC<JobDetailProps> = ({
  job,
  appliedResumePicker,
  profileScores,
  applicationTrackingEnabled,
  pipelineStages,
  verification,
  verificationCount,
  verificationRun,
  verifyCostHint,
  aiSpent,
  mute,
  resumeMatch,
  coverLetters,
  applicationPack,
  tab,
  tabs,
  flash,
}) => (
  // A pack in the queue or in flight is the one thing on this page that changes by itself.
  <Layout
    title={job.title}
    active="jobs"
    refresh={tab === 'pack' && (applicationPack.pack?.status === 'queued' || applicationPack.pack?.status === 'running') ? PACK_REFRESH_SECONDS : undefined}
  >
    {/* One solid button a tab: the comparison and the letter bring their own
        ("Tailor resume", "Copy letter"), so the header's steps back on those. */}
    <PageHeaderBlock job={job} primary={tab === 'posting' || tab === 'verify'} />
    <Flash flash={flash}>
      {flash?.tailor && (
        <Button href={flash.tailor} size="sm">
          {t('job.tailorResume')}
        </Button>
      )}
      {flash?.rerun && resumeMatch.selected && (
        <form method="post" action={`/jobs/${job.id}/match`}>
          <input type="hidden" name="resumeId" value={resumeMatch.selected.resumeId} />
          <input type="hidden" name="force" value="1" />
          {/* Repeat the comparison the user asked for, not the default one. */}
          <input type="hidden" name="mode" value={flash.mode ?? 'fast'} />
          <Button variant="secondary" size="sm">
            {t('job.reRunAnyway')}
          </Button>
        </form>
      )}
    </Flash>
    <CrossListingNotice job={job} />

    <Tabs
      label={t('job.jobSections')}
      class="mb-4"
      tabs={tabs.map((entry) => ({ href: jobHref(job.id, entry.tab), label: entry.label, current: entry.tab === tab }))}
    />

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* Right rail first in DOM so facts and actions lead on small screens. It rides on
          every tab, and its three forms carry the tab so a status change returns to it. */}
      <Card flush class="min-w-0 divide-y divide-line xl:order-2">
        <div class="p-5">
          <MarkAppliedPicker job={job} picker={appliedResumePicker} tab={tab} />
          <div class="flex flex-wrap items-center gap-2">
            {job.status !== 'APPLIED' && (
              <Button variant="secondary" size="sm" form={MARK_APPLIED_FORM}>
                {t('job.markApplied')}
              </Button>
            )}
            {STATUS_ACTIONS.filter((a) => a.status !== job.status).map((a) => (
              <ActionForm action={`/jobs/${job.id}/status`} hidden={{ status: a.status, tab }}>
                <Button variant={a.variant} size="sm">
                  {t(a.label)}
                </Button>
              </ActionForm>
            ))}
          </div>
        </div>

        <Card variant="flat" class="p-5">
          <SectionTitle>{t('job.details')}</SectionTitle>
          <dl class="space-y-2.5 text-sm">
            <FactRow label={t('job.salary')}>
              <span class="tabular-nums">
                {formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod)}
              </span>
              {formatUsdPerYear(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod) && (
                <span class="ml-2 text-meta text-ink-faint">
                  {formatUsdPerYear(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod)}
                </span>
              )}
            </FactRow>
            <FactRow label={t('job.posted')}>{formatDate(job.postedAt)}</FactRow>
            <FactRow label={t('job.fetched')}>{formatDate(job.fetchedAt)}</FactRow>
            {job.alertedAt && <FactRow label={t('job.alerted')}>{formatDate(job.alertedAt)}</FactRow>}
            <AppliedWithRow job={job} />
            <FactRow label={t('job.source')}>
              <span translate="no">{job.company.atsType.replace('_', ' ')}</span>
            </FactRow>
            {job.sourceFile && (
              <FactRow label={t('job.from')}>
                <a href={`/companies/${job.company.id}/files`} class="text-accent hover:underline" translate="no">
                  {job.company.name}
                </a>
                {' / '}
                <span class="break-all font-mono text-meta" translate="no">
                  {job.sourceFile}
                </span>
              </FactRow>
            )}
            {aiSpent && <FactRow label={t('job.aiSpent')}>{aiSpent}</FactRow>}
            <FactRow label={t('job.externalId')}>
              <span class="block truncate font-mono text-meta" title={job.externalId} translate="no">
                {job.externalId}
              </span>
            </FactRow>
          </dl>
        </Card>

        {mute && <MuteCard jobId={job.id} tab={tab} mute={mute} />}

        {applicationTrackingEnabled && (
          <Card variant="flat" class="p-5">
            <SectionTitle>{t('job.applicationTracking')}</SectionTitle>
            <form method="post" action={`/jobs/${job.id}/application`} class="space-y-3">
              <input type="hidden" name="tab" value={tab} />
              <Field label={t('job.pipelineStage')}>
                <Select name="pipelineStage">
                  <option value="" selected={!job.pipelineStage}>
                    {t('job.notInFunnel')}
                  </option>
                  {/* A column's name: the user's own, or a default the stage list already worded. */}
                  {pipelineStages.map((s) => (
                    <option value={s.key} selected={job.pipelineStage === s.key} translate="no">
                      {s.label}
                    </option>
                  ))}
                  {job.pipelineStage &&
                    !pipelineStages.some((s) => s.key === job.pipelineStage) && (
                      <option value={job.pipelineStage} selected>
                        {t('job.removedColumn', { stage: job.pipelineStage })}
                      </option>
                    )}
                </Select>
              </Field>
              <Field label={t('job.appliedOn')}>
                <Input
                  type="date"
                  name="appliedAt"
                  value={job.appliedAt ? job.appliedAt.toISOString().slice(0, 10) : ''}
                />
              </Field>
              <AppliedWithField job={job} picker={appliedResumePicker} />
              <Field label={t('job.recruiterContact')}>
                <Input
                  type="text"
                  name="recruiterContact"
                  value={job.recruiterContact ?? ''}
                  placeholder={t('job.janeAcmeComOrJane')}
                />
              </Field>
              <Field label={t('job.notes')}>
                <Textarea name="applicationNotes" rows={3}>
                  {job.applicationNotes ?? ''}
                </Textarea>
              </Field>
              <Button variant="secondary">{t('job.saveApplication')}</Button>
            </form>
            <AppliedTextDisclosure job={job} />
          </Card>
        )}
      </Card>

      <div class="min-w-0 space-y-4 xl:order-1">

        {tab === 'verify' && (
        <VerificationCard
          jobId={job.id}
          liveness={
            job.liveness && job.livenessCode && job.livenessCheckedAt
              ? { liveness: job.liveness, code: job.livenessCode, checkedAt: job.livenessCheckedAt }
              : null
          }
          verification={verification}
          verificationCount={verificationCount}
          run={verificationRun}
          url={job.url}
          costHint={verifyCostHint}
        />
        )}

        {/* S20: the comparison and the letter are written for English; a posting that is not says so first. */}
        {(tab === 'match' || tab === 'letter') && notEnglishNotice(job.description) && (
          <Hint class="mb-3">{notEnglishNotice(job.description)}</Hint>
        )}
        {tab === 'match' && <ResumeMatchCard {...resumeMatch} />}

        {tab === 'letter' && <CoverLetterCard {...coverLetters} />}

        {tab === 'pack' && <ApplicationPackCard {...applicationPack} />}

        {tab === 'posting' && (
        <Card flush class="divide-y divide-line">
        <ClassifierCard job={job} scores={profileScores} tab={tab} />
        {job.company.atsType === 'FRANCETRAVAIL' && job.sourcePayload !== null && job.sourcePayload !== undefined && (
          <Card variant="flat" class="p-5">
            <SectionTitle>{t('job.fullOfferAsPublishedBy')}</SectionTitle>
            <Hint class="mb-3">
              {t('job.everyFieldTheBoardSent')}
            </Hint>
            <details>
              <summary class="cursor-pointer select-none text-label text-ink">{t('job.showAllFields')}</summary>
              {/* The offer as France Travail wrote it. */}
              <div class="mt-3 overflow-x-auto" translate="no" lang="fr">
                <JsonTree value={job.sourcePayload} />
              </div>
            </details>
          </Card>
        )}

        <Card variant="flat" class="p-5">
          <SectionTitle>{t('job.description')}</SectionTitle>
          {job.descriptionRefreshedAt && (
            <div class="mb-3 flex flex-wrap items-center gap-2 text-note text-ink-muted">
              <span>
                {job.descriptionOriginal !== null
                  ? t('job.descriptionReplaced', { when: formatRelative(job.descriptionRefreshedAt), chars: job.descriptionOriginal.length })
                  : t('job.descriptionRestored', { when: formatRelative(job.descriptionRefreshedAt) })}
              </span>
              {job.descriptionOriginal !== null && (
                <ActionForm action={`/jobs/${job.id}/description/restore`}>
                  <Button variant="secondary" size="sm">
                    {t('job.restoreTheOriginal')}
                  </Button>
                </ActionForm>
              )}
            </div>
          )}
          {/* The posting's own words: data, whatever language the page is in. */}
          <div class="whitespace-pre-line break-words text-sm leading-6 text-ink-muted" translate="no">
            {job.description || t('job.empty')}
          </div>
        </Card>
        </Card>
        )}
      </div>
    </div>
    {/* Copy on the suggestion cards and the change sheet; the card itself is
        server-rendered, so this is all the JavaScript this page needs. */}
    <script type="module" dangerouslySetInnerHTML={{ __html: COPY_BOOT }} />
  </Layout>
);

const COPY_BOOT = `
import { wireCopy } from '/static/copy.mjs';
import { wireSelectCommits } from '/static/select-commit.mjs';
wireCopy(document);
wireSelectCommits(document);
`;

/**
 * The verdict and the button that replaces it, on one card (#100). Rendered
 * for an unscored posting too — that is when Re-classify matters most.
 */
const ClassifierCard: FC<{ job: JobDetail; scores: ProfileScore[]; tab: JobTab }> = ({ job, scores, tab }) => {
  const scored =
    job.techMatch.length > 0 ||
    job.redFlags.length > 0 ||
    Boolean(job.summary) ||
    job.priorityRulesApplied.length > 0;
  return (
    <Card variant="flat" class="p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>{t('job.classifier')}</SectionTitle>
        <ActionForm action={`/jobs/${job.id}/reclassify`} hidden={{ tab }}>
          <Button variant="violet" size="sm">
            {t('job.reClassify')}
          </Button>
        </ActionForm>
      </div>
      {scored ? (
        <>
          {/* What the classifier wrote stays as it wrote it; the technologies and the user's own rules are data. */}
          {job.summary && (
            <p class="mb-3 text-sm leading-6 text-ink" lang="en">
              {job.summary}
            </p>
          )}
          <dl class="space-y-2">
            <TagRow label={t('job.tech')} items={job.techMatch.map(techLabel)} tone="ok" />
            <TagRow label={t('job.flags')} items={job.redFlags} tone="danger" modelText />
            <TagRow label={t('job.priorityRules')} items={job.priorityRulesApplied} tone="neutral" />
          </dl>
          <ProfileScoreRow scores={scores} />
        </>
      ) : (
        <p class="text-sm text-ink-muted">{t('job.notScoredYetReClassify')}</p>
      )}
    </Card>
  );
};

/**
 * What each running search made of this posting. Hidden while only one search
 * has scored it — a single row is the Job's own score restated, and the card
 * already shows that. The top row is the search the page speaks for: it names
 * the winner and picks the resume the Compare card preselects.
 */
const ProfileScoreRow: FC<{ scores: ProfileScore[] }> = ({ scores }) => {
  if (scores.length < 2) return null;
  return (
    <div class="mt-3 border-t border-line pt-3">
      <div class="mb-2 text-meta font-medium text-ink-muted">{t('job.bySearch')}</div>
      <ul class="space-y-1.5">
        {scores.map((s, i) => (
          <li class="flex items-start gap-2 text-note">
            <FitBadge score={s.fitScore} />
            <div class="min-w-0 flex-1">
              <a
                href={`/jobs?profile=${s.profileId}`}
                class="font-medium text-ink transition-colors duration-150 hover:text-accent-strong"
                translate="no"
              >
                {s.name}
              </a>
              {i === 0 && (
                <span class="ml-1.5 text-meta text-ink-faint">· {t('job.score.best')}</span>
              )}
              {!s.active && (
                <span class="ml-1.5 text-meta text-ink-faint">· {t('job.score.paused')}</span>
              )}
              {!s.locationMatch && (
                <span class="ml-1.5 text-meta text-warn">
                  · {s.locationReason ? t('job.score.locationWhy', { reason: s.locationReason }) : t('job.score.location')}
                </span>
              )}
              {s.summary && (
                <div class="truncate text-meta text-ink-muted" title={s.summary} lang="en">
                  {s.summary}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * "The same posting is also over there." Both directions are shown: the job
 * this one duplicates, and later arrivals that duplicate it. Nothing is
 * merged or hidden — the point is to stop you applying twice (ADR 0018).
 */
const CrossListingNotice: FC<{ job: JobDetail }> = ({ job }) => {
  const others = [
    ...(job.crossListedOf ? [job.crossListedOf] : []),
    ...job.crossListings,
  ];
  if (others.length === 0) return null;
  return (
    <div class="mb-4 rounded-lg border border-warn/25 bg-warn/5 px-4 py-3 text-sm text-ink">
      <p class="font-medium">
        {t('job.alsoListedElsewhereApplyThrough')}
      </p>
      <ul class="mt-1.5 space-y-1 text-note text-ink-muted">
        {others.map((o) => (
          <li>
            {tRich('job.crossListed', {}, {
              job: () => (
                <a
                  href={`/jobs/${o.id}`}
                  class="font-medium text-accent-strong transition-colors duration-150 hover:text-accent-deep"
                  translate="no"
                >
                  {o.title}
                </a>
              ),
              company: () => <span translate="no">{o.company.name}</span>,
            })}
          </li>
        ))}
      </ul>
    </div>
  );
};

const PageHeaderBlock: FC<{ job: JobDetail; primary: boolean }> = ({ job, primary }) => (
  <header class="mb-5 shrink-0">
    <a
      href="/jobs"
      class="mb-1.5 inline-flex items-center gap-1 text-note text-ink-faint transition-colors duration-150 hover:text-ink"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
      {t('job.allJobs')}
    </a>
    <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div class="min-w-0 flex-1 basis-72">
        {/* The title, the company and the place as the posting gives them: data, whatever language the page is in. */}
        <h1 class="text-title text-ink" translate="no">
          {job.title}
        </h1>
        <div class="mt-1 text-sm text-ink-muted">
          {job.company.watched && <span aria-label={t('job.watchedCompany')}>★ </span>}
          <span translate="no">{job.employer ?? job.company.name}</span>
          {job.employer && job.company.atsType !== 'ADZUNA' && job.company.atsType !== 'FRANCETRAVAIL' && (
            <span class="text-ink-faint"> · {tRich('job.via', {}, { source: () => <span translate="no">{job.company.name}</span> })}</span>
          )}{' '}
          · {job.location ? <span translate="no">{job.location}</span> : workplaceName('REMOTE')}
        </div>
        {job.company.watched && (
          <div data-ui="hint" class="mt-1 text-meta text-ink-faint">
            {tRich(
              'job.watchedLine',
              { every: toCheckInterval(job.company.checkEvery), policy: job.company.alertPolicy === 'all' ? 'all' : 'matches' },
              {
                link: (words) => (
                  <a href="/companies" class="underline">
                    {words}
                  </a>
                ),
              },
            )}
          </div>
        )}
        {job.company.atsType === 'ADZUNA' && <AdzunaLabel market={job.company.atsToken} class="mt-1" />}
        {job.company.atsType === 'FRANCETRAVAIL' && <FranceTravailLine updatedAt={job.sourceUpdatedAt} class="mt-1" />}
        <PlaceChips job={job} />
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-3">
        <FitBadge score={job.fitScore} worded />
        <StatusBadge status={job.status} />
        {/* A whole board listing no longer carries it, or a check found it gone (TASKS S13, ADR 0016). */}
        {job.liveness === 'expired' && (
          <span title={closedTitle(job)}>
            <Badge tone="warn">{t('job.closed')}</Badge>
          </span>
        )}
        {safeHref(job.url) && (
          <Button href={safeHref(job.url)!} target="_blank" rel="noopener" size="sm" variant={primary ? 'primary' : 'secondary'}>
            {t('job.openPosting')}
          </Button>
        )}
      </div>
    </div>
  </header>
);

/**
 * The parsed location as chips: the arrangement, then one chip per country
 * or region, each a link into the /jobs facet. Nothing when the parser found
 * nothing — the raw string above is all there is.
 */
const PlaceChips: FC<{ job: Pick<JobDetail, 'workplace' | 'countries' | 'regions' | 'location'> }> = ({ job }) => {
  const places = [...job.countries, ...job.regions];
  if (job.workplace === 'UNKNOWN' && places.length === 0) return null;
  return (
    // Everything inside is already in the reader's language (the catalog, the country names); the tooltip is the posting's own string.
    <ul class="mt-2 flex flex-wrap items-center gap-1.5" aria-label={t('job.whereThisJobIs')} title={job.location} translate="no">
      {job.workplace !== 'UNKNOWN' && (
        <li>
          <Tag tone="info">{workplaceName(job.workplace)}</Tag>
        </li>
      )}
      {places.map((code) => (
        <li>
          <a href={`/jobs?country=${encodeURIComponent(code)}`} class="hover:underline">
            <Tag>
              {flagOf(code) && <span aria-hidden="true">{flagOf(code)} </span>}
              {placeName(code)}
            </Tag>
          </a>
        </li>
      ))}
    </ul>
  );
};

/**
 * "Mark applied" plus the resume it went out with. The select is the whole
 * point of the button here: the answer is only knowable at the moment of
 * applying, and a resume is edited in place afterwards, so the route stores a
 * text snapshot alongside the id (Stage C).
 */
/**
 * The full-width "Applied with" select, plus the empty form its select and its
 * button both post through.
 *
 * They are bound by the HTML `form` attribute rather than nesting, because the
 * two want opposite layouts: the select is a full-width labelled field, while
 * "Mark applied" belongs on the same row as Save / Dismiss / Re-classify.
 * Wrapping both in one form put the primary action on a line of its own above
 * the others, which read as two unrelated groups of buttons.
 */
const MarkAppliedPicker: FC<{
  job: JobDetail;
  picker: JobDetailProps['appliedResumePicker'];
  tab: JobTab;
}> = ({ job, picker, tab }) =>
  job.status === 'APPLIED' ? null : (
    <>
      <form id={MARK_APPLIED_FORM} method="post" action={`/jobs/${job.id}/status`}>
        <input type="hidden" name="status" value="APPLIED" />
        <input type="hidden" name="tab" value={tab} />
      </form>
      {picker.resumes.length > 0 && (
        <Field
          label={t('job.appliedWith')}
          hint={t('job.keptForTheFollowUp')}
          class="mb-3"
        >
          <Select name="appliedResumeId" form={MARK_APPLIED_FORM}>
            <option value="">{t('job.dontRecordAResume')}</option>
            {picker.resumes.map((r) => (
              <option value={r.id} selected={r.id === picker.suggestedId} translate="no">
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </>
  );

/**
 * "Which resume did I send?" on the card that records the application (#75).
 *
 * Shown once the job is applied — before that the Actions card asks the same
 * question with "Mark applied", and asking twice with two different answers
 * preselected was the bug (#101). Never preselected when nothing is stored: a
 * card dragged into Applied on the board carries no picker, and filling this
 * in on the user's behalf would turn a guess into a recorded fact. The hint
 * says which one the page would have suggested; choosing it stays the user's
 * move.
 */
const AppliedWithField: FC<{ job: JobDetail; picker: JobDetailProps['appliedResumePicker'] }> = ({
  job,
  picker,
}) => {
  if (picker.resumes.length === 0 || job.status !== 'APPLIED') return null;
  const asking = needsAppliedResume(job);
  const suggestion = picker.resumes.find((r) => r.id === picker.suggestedId);
  return (
    <Field
      label={t('job.appliedWith')}
      hint={
        asking
          ? suggestion
            ? t('job.applied.pickLikely', { name: suggestion.name })
            : t('job.applied.pick')
          : t('job.keptAsItWasOn')
      }
    >
      <Select name="appliedResumeId">
        <option value="" selected={job.appliedResumeId === null}>
          {t('job.notRecorded')}
        </option>
        {picker.resumes.map((r) => (
          <option value={r.id} selected={r.id === job.appliedResumeId} translate="no">
            {r.name}
          </option>
        ))}
      </Select>
    </Field>
  );
};

/** The words that actually went out (#74) — written since v1.11.0, read by nothing until now. */
const AppliedTextDisclosure: FC<{ job: JobDetail }> = ({ job }) =>
  job.appliedResumeText ? (
    <details class="mt-3 rounded-md border border-line px-3 py-2">
      <summary class="cursor-pointer select-none text-note font-medium text-ink-muted transition-colors duration-150 hover:text-ink">
        {t('job.applied.textSent', { n: job.appliedResumeText.length })}
      </summary>
      <pre class="mt-3 whitespace-pre-wrap break-words font-sans text-note leading-6 text-ink-muted">
        {job.appliedResumeText}
      </pre>
    </details>
  ) : null;

/** Silent until an application recorded its resume — most rows never will. */
const AppliedWithRow: FC<{ job: JobDetail }> = ({ job }) => {
  const label = appliedWithLabel({
    name: job.appliedResume?.name ?? null,
    version: job.appliedResumeVersion,
  });
  if (label === null) return null;
  // A resume's own name is data; the words for one that was deleted since are applied-with.ts's.
  return <FactRow label={t('job.appliedWith')}>{job.appliedResume?.name?.trim() ? <span translate="no">{label}</span> : label}</FactRow>;
};

const FactRow: FC<PropsWithChildren<{ label: string }>> = ({ label, children }) => (
  <div class="flex items-baseline justify-between gap-4">
    <dt class="shrink-0 text-note text-ink-faint">{label}</dt>
    <dd class="min-w-0 text-right text-ink">{children}</dd>
  </div>
);

/** `modelText`: the items are a model's own words (`lang="en"`); otherwise they are names, kept as they are. */
const TagRow: FC<{ label: string; items: string[]; tone: 'ok' | 'danger' | 'neutral'; modelText?: boolean }> = ({
  label,
  items,
  tone,
  modelText = false,
}) =>
  items.length === 0 ? null : (
    <div class="flex flex-wrap items-center gap-1.5">
      <dt class="mr-1 text-note font-medium text-ink-muted">{label}</dt>
      {items.map((item) => (
        <dd lang={modelText ? 'en' : undefined} translate={modelText ? undefined : 'no'}>
          <Tag tone={tone}>{item}</Tag>
        </dd>
      ))}
    </div>
  );

/**
 * ADR 0056: stop seeing a company from the posting that made you want to. A
 * mute turns its new postings away before any AI and hides the stored ones;
 * it never changes a status, and Unmute undoes both.
 */
const MuteCard: FC<{ jobId: number; tab: JobTab; mute: MuteState }> = ({ jobId, tab, mute }) => {
  const back = jobHref(jobId, tab);
  if (mute.muted) {
    return (
      <Card variant="flat" class="p-5">
        <SectionTitle>{t('job.mute.isMuted', { name: mute.name })}</SectionTitle>
        <Hint>
          {mute.muted.reason
            ? t('job.mute.sinceWhy', { when: formatDate(mute.muted.since), reason: mute.muted.reason })
            : t('job.mute.since', { when: formatDate(mute.muted.since) })}
        </Hint>
        <ActionForm action="/companies/mutes/delete" hidden={{ key: mute.key, back }} class="mt-3">
          <Button size="sm" variant="secondary">
            {t('job.unmute')}
          </Button>
        </ActionForm>
      </Card>
    );
  }
  return (
    <Card variant="flat" class="px-5 py-4">
      <Disclosure summary={t('job.mute.mute', { name: mute.name })}>
        <form method="post" action="/companies/mutes" class="mt-3 space-y-3">
          <input type="hidden" name="name" value={mute.name} />
          <input type="hidden" name="back" value={back} />
          <Field label={t('job.whyOptional')} hint={t('job.shownBesideTheMuteSo')}>
            <Input name="reason" maxlength="300" placeholder={t('job.rejectedInSeptember')} />
          </Field>
          <Hint>
            {t('job.itsNewPostingsAreTurned')}
          </Hint>
          <Button variant="secondary">
            {t('job.mute.mute', { name: mute.name })}
          </Button>
        </form>
      </Disclosure>
    </Card>
  );
};

/** Why a posting reads as closed, and since when — the badge's tooltip. */
function closedTitle(job: { livenessCode: string | null; livenessCheckedAt: Date | null }): string {
  const why = (job.livenessCode && livenessCodeLabel(job.livenessCode)) || t('job.closedFoundGone');
  return job.livenessCheckedAt ? t('job.closedWhySeen', { why, when: formatDate(job.livenessCheckedAt) }) : t('job.closedWhy', { why });
}
