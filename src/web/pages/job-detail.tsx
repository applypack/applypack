/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
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
} from '../ui';
import { formatDate, formatSalary } from '../format';

interface JobDetail {
  id: number;
  title: string;
  url: string;
  location: string;
  description: string;
  fitScore: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  techMatch: string[];
  redFlags: string[];
  summary: string | null;
  status: JobStatus;
  fetchedAt: Date;
  postedAt: Date;
  alertedAt: Date | null;
  externalId: string;
  company: { id: number; name: string; atsType: string };
  appliedAt: Date | null;
  pipelineStage: string | null;
  recruiterContact: string | null;
  applicationNotes: string | null;
  priorityRulesApplied: string[];
}

export interface JobDetailProps {
  job: JobDetail;
  applicationTrackingEnabled: boolean;
  flash?: { kind: 'ok' | 'err'; text: string } | null;
}

const PIPELINE_STAGES = ['applied', 'screen', 'tech', 'onsite', 'offer', 'rejected', 'ghosted'];

const STATUS_ACTIONS: { status: JobStatus; label: string; variant: ButtonVariant }[] = [
  { status: 'APPLIED', label: 'Mark applied', variant: 'primary' },
  { status: 'SAVED', label: 'Save', variant: 'violet' },
  { status: 'DISMISSED', label: 'Dismiss', variant: 'secondary' },
  { status: 'NEW', label: 'Reopen', variant: 'secondary' },
];

export const JobDetailPage: FC<JobDetailProps> = ({
  job,
  applicationTrackingEnabled,
  flash,
}) => (
  <Layout title={job.title} active="jobs">
    <a href="/jobs" class="mb-4 inline-block text-xs text-ink-faint hover:text-ink">
      ← All jobs
    </a>
    <Flash flash={flash} />

    <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0 sm:flex-1">
        <h1 class="text-2xl font-semibold tracking-tight">{job.title}</h1>
        <div class="mt-1 text-sm text-ink-muted">
          {job.company.name} · {job.location || 'Remote'}
        </div>
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-3">
        <FitBadge score={job.fitScore} />
        <StatusBadge status={job.status} />
        <Button href={job.url} target="_blank" rel="noopener">
          Open posting ↗
        </Button>
      </div>
    </div>

    <div class="mb-6 grid gap-4 sm:grid-cols-3">
      <Card>
        <SectionTitle>Salary</SectionTitle>
        <div class="font-mono text-lg tabular-nums">
          {formatSalary(job.salaryMin, job.salaryMax)}
        </div>
      </Card>
      <Card>
        <SectionTitle>Posted</SectionTitle>
        <div class="text-sm text-ink">{formatDate(job.postedAt)}</div>
        <div class="mt-1 text-xs text-ink-faint">Fetched {formatDate(job.fetchedAt)}</div>
      </Card>
      <Card>
        <SectionTitle>Source</SectionTitle>
        <div class="text-sm text-ink">{job.company.atsType.replace('_', ' ')}</div>
        <div class="mt-1 truncate font-mono text-xs text-ink-faint" title={job.externalId}>
          {job.externalId}
        </div>
      </Card>
    </div>

    {(job.techMatch.length > 0 ||
      job.redFlags.length > 0 ||
      job.summary ||
      job.priorityRulesApplied.length > 0) && (
      <Card class="mb-6">
        <SectionTitle>Classifier</SectionTitle>
        {job.summary && <p class="mb-3 max-w-prose text-sm leading-6 text-ink">{job.summary}</p>}
        <dl class="space-y-2">
          <TagRow label="Tech" items={job.techMatch} tone="ok" />
          <TagRow label="Flags" items={job.redFlags} tone="danger" />
          <TagRow label="Priority rules" items={job.priorityRulesApplied} tone="violet" />
        </dl>
      </Card>
    )}

    <Card class="mb-6">
      <SectionTitle>Actions</SectionTitle>
      <div class="flex flex-wrap items-center gap-2">
        {STATUS_ACTIONS.filter((a) => a.status !== job.status).map((a) => (
          <ActionForm action={`/jobs/${job.id}/status`} hidden={{ status: a.status }}>
            <Button variant={a.variant}>{a.label}</Button>
          </ActionForm>
        ))}
        <ActionForm action={`/jobs/${job.id}/reclassify`}>
          <Button variant="ghost">Re-classify</Button>
        </ActionForm>
      </div>
    </Card>

    {applicationTrackingEnabled && (
      <Card class="mb-6">
        <SectionTitle>Application tracking</SectionTitle>
        <form
          method="post"
          action={`/jobs/${job.id}/application`}
          class="grid gap-3 sm:grid-cols-2"
        >
          <Field label="Pipeline stage">
            <Select name="pipelineStage">
              <option value="" selected={!job.pipelineStage}>
                — not in funnel —
              </option>
              {PIPELINE_STAGES.map((s) => (
                <option value={s} selected={job.pipelineStage === s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Applied on">
            <Input
              type="date"
              name="appliedAt"
              value={job.appliedAt ? job.appliedAt.toISOString().slice(0, 10) : ''}
            />
          </Field>
          <Field label="Recruiter contact" class="sm:col-span-2">
            <Input
              type="text"
              name="recruiterContact"
              value={job.recruiterContact ?? ''}
              placeholder="jane@acme.com or Jane Doe (LinkedIn)"
            />
          </Field>
          <Field label="Notes" class="sm:col-span-2">
            <Textarea name="applicationNotes" rows={3}>
              {job.applicationNotes ?? ''}
            </Textarea>
          </Field>
          <div class="sm:col-span-2">
            <Button>Save application</Button>
          </div>
        </form>
      </Card>
    )}

    <Card>
      <SectionTitle>Description</SectionTitle>
      <pre class="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-ink-muted">
        {job.description || '(empty)'}
      </pre>
    </Card>
  </Layout>
);

const TagRow: FC<{ label: string; items: string[]; tone: 'ok' | 'danger' | 'violet' }> = ({
  label,
  items,
  tone,
}) =>
  items.length === 0 ? null : (
    <div class="flex flex-wrap items-center gap-1.5">
      <dt class="mr-1 text-xs uppercase tracking-wider text-ink-faint">{label}</dt>
      {items.map((t) => (
        <dd>
          <Tag tone={tone}>{t}</Tag>
        </dd>
      ))}
    </div>
  );
