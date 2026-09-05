/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';
import type { JobStatus } from '@prisma/client';
import { Layout } from '../layout';
import {
  ActionForm,
  Button,
  type ButtonVariant,
  Card,
  Field,
  FitBadge,
  Flash,
  Input,
  SectionTitle,
  Select,
  StatusBadge,
  Tag,
  Textarea,
  Hint,
} from '../ui';
import { intervalLabel } from '../../watchlist/interval';
import { formatDate, formatSalary } from '../format';
import { AdzunaLabel, FranceTravailLine, JsonTree } from './attribution';
import { formatUsdPerYear } from '../../currency';
import { flagOf, placeLabel } from '../../countries';
import { WORKPLACE_LABEL, type WorkplaceCode } from '../../location';
import { appliedWithLabel } from '../../jobs/applied-with';
import { needsAppliedResume } from '../applied-resume';
import type { FlashMessage } from '../flash';
import { CoverLetterCard, type CoverLetterCardProps } from './cover-letter-card';
import { ResumeMatchCard, type ResumeMatchCardProps } from './resume-match-card';
import { VerificationCard, type VerificationCardProps } from './verification-card';

interface JobDetail {
  id: number;
  title: string;
  url: string;
  location: string;
  /** ADR 0031: the structured reading of `location`, shown as chips under it. */
  workplace: WorkplaceCode;
  countries: string[];
  regions: string[];
  description: string;
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
  resumeMatch: ResumeMatchCardProps;
  coverLetters: CoverLetterCardProps;
  flash?: FlashMessage | null;
}

/** The id the out-of-form select and the in-row button both post through. */
const MARK_APPLIED_FORM = 'mark-applied';

// "Mark applied" is not in this list: it posts through MARK_APPLIED_FORM so the
// resume select can sit above the row while the button stays inside it.
const STATUS_ACTIONS: { status: JobStatus; label: string; variant: ButtonVariant }[] = [
  { status: 'SAVED', label: 'Save', variant: 'violet' },
  { status: 'DISMISSED', label: 'Dismiss', variant: 'secondary' },
  { status: 'NEW', label: 'Reopen', variant: 'secondary' },
];

export const JobDetailPage: FC<JobDetailProps> = ({
  job,
  appliedResumePicker,
  profileScores,
  applicationTrackingEnabled,
  pipelineStages,
  verification,
  verificationCount,
  resumeMatch,
  coverLetters,
  flash,
}) => (
  <Layout title={job.title} active="jobs">
    <PageHeaderBlock job={job} />
    <Flash flash={flash}>
      {flash?.rerun && resumeMatch.selected && (
        <form method="post" action={`/jobs/${job.id}/match`}>
          <input type="hidden" name="resumeId" value={resumeMatch.selected.resumeId} />
          <input type="hidden" name="force" value="1" />
          {/* Repeat the comparison the user asked for, not the default one. */}
          <input type="hidden" name="mode" value={flash.mode ?? 'fast'} />
          <Button variant="secondary" size="sm">
            Re-run anyway
          </Button>
        </form>
      )}
    </Flash>
    <CrossListingNotice job={job} />

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* Right rail first in DOM so facts and actions lead on small screens. */}
      <div class="min-w-0 space-y-4 xl:order-2">
        <Card>
          <SectionTitle>Actions</SectionTitle>
          <MarkAppliedPicker job={job} picker={appliedResumePicker} />
          <div class="flex flex-wrap items-center gap-2">
            {job.status !== 'APPLIED' && (
              <Button variant="primary" size="sm" form={MARK_APPLIED_FORM}>
                Mark applied
              </Button>
            )}
            {STATUS_ACTIONS.filter((a) => a.status !== job.status).map((a) => (
              <ActionForm action={`/jobs/${job.id}/status`} hidden={{ status: a.status }}>
                <Button variant={a.variant} size="sm">
                  {a.label}
                </Button>
              </ActionForm>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>Details</SectionTitle>
          <dl class="space-y-2.5 text-sm">
            <FactRow label="Salary">
              <span class="tabular-nums">
                {formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod)}
              </span>
              {formatUsdPerYear(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod) && (
                <span class="ml-2 text-xs text-ink-faint">
                  {formatUsdPerYear(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod)}
                </span>
              )}
            </FactRow>
            <FactRow label="Posted">{formatDate(job.postedAt)}</FactRow>
            <FactRow label="Fetched">{formatDate(job.fetchedAt)}</FactRow>
            {job.alertedAt && <FactRow label="Alerted">{formatDate(job.alertedAt)}</FactRow>}
            <AppliedWithRow job={job} />
            <FactRow label="Source">{job.company.atsType.replace('_', ' ')}</FactRow>
            <FactRow label="External id">
              <span class="block truncate font-mono text-xs" title={job.externalId}>
                {job.externalId}
              </span>
            </FactRow>
          </dl>
        </Card>

        {applicationTrackingEnabled && (
          <Card>
            <SectionTitle>Application tracking</SectionTitle>
            <form method="post" action={`/jobs/${job.id}/application`} class="space-y-3">
              <Field label="Pipeline stage">
                <Select name="pipelineStage">
                  <option value="" selected={!job.pipelineStage}>
                    — not in funnel —
                  </option>
                  {pipelineStages.map((s) => (
                    <option value={s.key} selected={job.pipelineStage === s.key}>
                      {s.label}
                    </option>
                  ))}
                  {job.pipelineStage &&
                    !pipelineStages.some((s) => s.key === job.pipelineStage) && (
                      <option value={job.pipelineStage} selected>
                        {job.pipelineStage} (removed column)
                      </option>
                    )}
                </Select>
              </Field>
              <Field label="Applied on">
                <Input
                  type="date"
                  name="appliedAt"
                  value={job.appliedAt ? job.appliedAt.toISOString().slice(0, 10) : ''}
                />
              </Field>
              <AppliedWithField job={job} picker={appliedResumePicker} />
              <Field label="Recruiter contact">
                <Input
                  type="text"
                  name="recruiterContact"
                  value={job.recruiterContact ?? ''}
                  placeholder="jane@acme.com or Jane Doe (LinkedIn)"
                />
              </Field>
              <Field label="Notes">
                <Textarea name="applicationNotes" rows={3}>
                  {job.applicationNotes ?? ''}
                </Textarea>
              </Field>
              <Button>Save application</Button>
            </form>
            <AppliedTextDisclosure job={job} />
          </Card>
        )}
      </div>

      <div class="min-w-0 space-y-4 xl:order-1">
        <ClassifierCard job={job} scores={profileScores} />

        <VerificationCard
          jobId={job.id}
          liveness={
            job.liveness && job.livenessCode && job.livenessCheckedAt
              ? { liveness: job.liveness, code: job.livenessCode, checkedAt: job.livenessCheckedAt }
              : null
          }
          verification={verification}
          verificationCount={verificationCount}
        />

        <ResumeMatchCard {...resumeMatch} />

        <CoverLetterCard {...coverLetters} />
        {job.company.atsType === 'FRANCETRAVAIL' && job.sourcePayload !== null && job.sourcePayload !== undefined && (
          <Card>
            <SectionTitle>Full offer as published by France Travail</SectionTitle>
            <Hint class="mb-3">
              Every field the board sent, unchanged — its licence asks for the whole offer to be shown.
            </Hint>
            <details>
              <summary class="cursor-pointer select-none text-[13px] font-medium text-ink">Show all fields</summary>
              <div class="mt-3 overflow-x-auto">
                <JsonTree value={job.sourcePayload} />
              </div>
            </details>
          </Card>
        )}


        <Card>
          <SectionTitle>Description</SectionTitle>
          <div class="whitespace-pre-line break-words text-sm leading-6 text-ink-muted">
            {job.description || '(empty)'}
          </div>
        </Card>
      </div>
    </div>
    {/* Copy on the suggestion cards and the change sheet; the card itself is
        server-rendered, so this is all the JavaScript this page needs. */}
    <script type="module" dangerouslySetInnerHTML={{ __html: COPY_BOOT }} />
  </Layout>
);

const COPY_BOOT = `
import { wireCopy } from '/static/copy.mjs';
wireCopy(document);
`;

/**
 * What each running search made of this posting. Hidden while only one search
 * has scored it — a single row is the Job's own score restated, and the card
 * already shows that. The top row is the search the page speaks for: it names
 * the winner and picks the resume the Compare card preselects.
 */
/**
 * The verdict and the button that replaces it, on one card (#100). Rendered
 * for an unscored posting too — that is when Re-classify matters most.
 */
const ClassifierCard: FC<{ job: JobDetail; scores: ProfileScore[] }> = ({ job, scores }) => {
  const scored =
    job.techMatch.length > 0 ||
    job.redFlags.length > 0 ||
    Boolean(job.summary) ||
    job.priorityRulesApplied.length > 0;
  return (
    <Card>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>Classifier</SectionTitle>
        <ActionForm action={`/jobs/${job.id}/reclassify`}>
          <Button variant="ghost" size="sm">
            Re-classify
          </Button>
        </ActionForm>
      </div>
      {scored ? (
        <>
          {job.summary && <p class="mb-3 text-sm leading-6 text-ink">{job.summary}</p>}
          <dl class="space-y-2">
            <TagRow label="Tech" items={job.techMatch} tone="ok" />
            <TagRow label="Flags" items={job.redFlags} tone="danger" />
            <TagRow label="Priority rules" items={job.priorityRulesApplied} tone="violet" />
          </dl>
          <ProfileScoreRow scores={scores} />
        </>
      ) : (
        <p class="text-sm text-ink-muted">Not scored yet — Re-classify runs the AI on this posting.</p>
      )}
    </Card>
  );
};

const ProfileScoreRow: FC<{ scores: ProfileScore[] }> = ({ scores }) => {
  if (scores.length < 2) return null;
  return (
    <div class="mt-3 border-t border-line pt-3">
      <div class="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
        By search
      </div>
      <ul class="space-y-1.5">
        {scores.map((s, i) => (
          <li class="flex items-start gap-2 text-[13px]">
            <FitBadge score={s.fitScore} />
            <div class="min-w-0 flex-1">
              <a
                href={`/jobs?profile=${s.profileId}`}
                class="font-medium text-ink transition-colors duration-150 hover:text-accent-strong"
              >
                {s.name}
              </a>
              {i === 0 && (
                <span class="ml-1.5 text-xs text-ink-faint">· best match</span>
              )}
              {!s.active && (
                <span class="ml-1.5 text-xs text-ink-faint">· paused</span>
              )}
              {!s.locationMatch && (
                <span class="ml-1.5 text-xs text-warn">
                  · location mismatch{s.locationReason ? ` — ${s.locationReason}` : ''}
                </span>
              )}
              {s.summary && (
                <div class="truncate text-xs text-ink-muted" title={s.summary}>
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
        Also listed elsewhere — apply through one channel only
      </p>
      <ul class="mt-1.5 space-y-1 text-[13px] text-ink-muted">
        {others.map((o) => (
          <li>
            <a
              href={`/jobs/${o.id}`}
              class="font-medium text-accent-strong transition-colors duration-150 hover:text-accent-deep"
            >
              {o.title}
            </a>{' '}
            at {o.company.name}
          </li>
        ))}
      </ul>
    </div>
  );
};

const PageHeaderBlock: FC<{ job: JobDetail }> = ({ job }) => (
  <header class="mb-5 shrink-0">
    <a
      href="/jobs"
      class="mb-1.5 inline-flex items-center gap-1 text-[13px] text-ink-faint transition-colors duration-150 hover:text-ink"
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
      All jobs
    </a>
    <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div class="min-w-0 flex-1 basis-72">
        <h1 class="text-xl font-semibold leading-snug tracking-tight">{job.title}</h1>
        <div class="mt-1 text-sm text-ink-muted">
          {job.company.watched && <span aria-label="Watched company">★ </span>}
          {job.company.name} · {job.location || 'Remote'}
        </div>
        {job.company.watched && (
          <div class="mt-1 text-xs text-ink-faint">
            Watched company · {intervalLabel(job.company.checkEvery).toLowerCase()}, with your search&rsquo;s schedule ·{' '}
            {job.company.alertPolicy === 'all' ? 'alerts on every posting' : 'alerts on matches only'} ·{' '}
            <a href="/companies" class="underline">
              change
            </a>
          </div>
        )}
        {job.company.atsType === 'ADZUNA' && <AdzunaLabel market={job.company.atsToken} class="mt-1" />}
        {job.company.atsType === 'FRANCETRAVAIL' && <FranceTravailLine updatedAt={job.sourceUpdatedAt} class="mt-1" />}
        <PlaceChips job={job} />
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-3">
        <FitBadge score={job.fitScore} />
        <StatusBadge status={job.status} />
        {job.url && (
          <Button href={job.url} target="_blank" rel="noopener" size="sm">
            Open posting ↗
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
    <ul class="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Where this job is" title={job.location}>
      {job.workplace !== 'UNKNOWN' && (
        <li>
          <Tag tone="info">{WORKPLACE_LABEL[job.workplace]}</Tag>
        </li>
      )}
      {places.map((code) => (
        <li>
          <a href={`/jobs?country=${encodeURIComponent(code)}`} class="hover:underline">
            <Tag>
              {flagOf(code) && <span aria-hidden="true">{flagOf(code)} </span>}
              {placeLabel(code)}
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
}> = ({ job, picker }) =>
  job.status === 'APPLIED' ? null : (
    <>
      <form id={MARK_APPLIED_FORM} method="post" action={`/jobs/${job.id}/status`}>
        <input type="hidden" name="status" value="APPLIED" />
      </form>
      {picker.resumes.length > 0 && (
        <Field
          label="Applied with"
          hint="Recorded with the version you sent, for the follow-up nudge."
          class="mb-3"
        >
          <Select name="appliedResumeId" form={MARK_APPLIED_FORM}>
            <option value="">— don't record a resume —</option>
            {picker.resumes.map((r) => (
              <option value={r.id} selected={r.id === picker.suggestedId}>
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
      label="Applied with"
      hint={
        asking
          ? `Not recorded — pick the one you sent.${suggestion ? ` Most likely "${suggestion.name}".` : ''}`
          : 'Kept as it was on the day, so a later edit cannot rewrite history.'
      }
    >
      <Select name="appliedResumeId">
        <option value="" selected={job.appliedResumeId === null}>
          — not recorded —
        </option>
        {picker.resumes.map((r) => (
          <option value={r.id} selected={r.id === job.appliedResumeId}>
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
      <summary class="cursor-pointer select-none text-[13px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink">
        The text that went out ({job.appliedResumeText.length.toLocaleString()} chars)
      </summary>
      <pre class="mt-3 whitespace-pre-wrap break-words font-sans text-[13px] leading-6 text-ink-muted">
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
  return label === null ? null : <FactRow label="Applied with">{label}</FactRow>;
};

const FactRow: FC<PropsWithChildren<{ label: string }>> = ({ label, children }) => (
  <div class="flex items-baseline justify-between gap-4">
    <dt class="shrink-0 text-[13px] text-ink-faint">{label}</dt>
    <dd class="min-w-0 text-right text-ink">{children}</dd>
  </div>
);

const TagRow: FC<{ label: string; items: string[]; tone: 'ok' | 'danger' | 'violet' }> = ({
  label,
  items,
  tone,
}) =>
  items.length === 0 ? null : (
    <div class="flex flex-wrap items-center gap-1.5">
      <dt class="mr-1 text-[13px] font-medium text-ink-muted">{label}</dt>
      {items.map((t) => (
        <dd>
          <Tag tone={tone}>{t}</Tag>
        </dd>
      ))}
    </div>
  );
