/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { JobStatus } from '@prisma/client';
import { Layout } from '../layout';
import { Card, FitBadge, SectionTitle, StatusBadge, Tag } from '../ui';
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
}

export interface JobDetailProps {
  job: JobDetail;
  applicationTrackingEnabled: boolean;
  flash?: { kind: 'ok' | 'err'; text: string } | null;
}

const PIPELINE_STAGES = [
  'applied',
  'screen',
  'tech',
  'onsite',
  'offer',
  'rejected',
  'ghosted',
] as const;

const STATUS_ACTIONS: { status: JobStatus; label: string; tone: string }[] = [
  { status: 'APPLIED', label: 'Mark applied', tone: 'bg-emerald-600 hover:bg-emerald-500' },
  { status: 'SAVED', label: 'Save', tone: 'bg-violet-600 hover:bg-violet-500' },
  { status: 'DISMISSED', label: 'Dismiss', tone: 'bg-zinc-700 hover:bg-zinc-600' },
  { status: 'NEW', label: 'Reopen', tone: 'bg-sky-600 hover:bg-sky-500' },
];

export const JobDetailPage: FC<JobDetailProps> = ({
  job,
  applicationTrackingEnabled,
  flash,
}) => (
  <Layout title={job.title} active="jobs">
    <div class="mb-4">
      <a href="/jobs" class="text-xs text-zinc-500 hover:text-zinc-300">
        ← All jobs
      </a>
    </div>

    {flash && (
      <div
        class={`mb-4 rounded-md px-4 py-2 text-sm ring-1 ring-inset ${
          flash.kind === 'ok'
            ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
            : 'bg-rose-500/10 text-rose-300 ring-rose-500/30'
        }`}
      >
        {flash.text}
      </div>
    )}

    <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-semibold tracking-tight">{job.title}</h1>
        <div class="mt-1 text-sm text-zinc-400">
          {job.company.name} · {job.location || 'Remote'}
        </div>
      </div>
      <div class="flex items-center gap-3">
        <FitBadge score={job.fitScore} />
        <StatusBadge status={job.status} />
        <a
          href={job.url}
          target="_blank"
          rel="noopener"
          class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Apply →
        </a>
      </div>
    </div>

    <div class="mb-6 grid gap-4 lg:grid-cols-3">
      <Card>
        <SectionTitle>Salary</SectionTitle>
        <div class="text-lg tabular-nums">
          {formatSalary(job.salaryMin, job.salaryMax)}
        </div>
      </Card>
      <Card>
        <SectionTitle>Posted</SectionTitle>
        <div class="text-sm text-zinc-300">{formatDate(job.postedAt)}</div>
        <div class="mt-1 text-xs text-zinc-500">
          Fetched {formatDate(job.fetchedAt)}
        </div>
      </Card>
      <Card>
        <SectionTitle>Source</SectionTitle>
        <div class="text-sm text-zinc-300">
          {job.company.atsType.replace('_', ' ')}
        </div>
        <div class="mt-1 text-xs text-zinc-500">External id: {job.externalId}</div>
      </Card>
    </div>

    {(job.techMatch.length > 0 ||
      job.redFlags.length > 0 ||
      job.summary) && (
      <Card class="mb-6">
        <SectionTitle>Classifier</SectionTitle>
        {job.summary && (
          <p class="mb-3 text-sm italic text-zinc-300">{job.summary}</p>
        )}
        {job.techMatch.length > 0 && (
          <div class="mb-2 flex flex-wrap items-center gap-1.5">
            <span class="text-xs uppercase tracking-wider text-zinc-500">
              Tech:
            </span>
            {job.techMatch.map((t) => (
              <Tag tone="green">{t}</Tag>
            ))}
          </div>
        )}
        {job.redFlags.length > 0 && (
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-xs uppercase tracking-wider text-zinc-500">
              Flags:
            </span>
            {job.redFlags.map((t) => (
              <Tag tone="red">{t}</Tag>
            ))}
          </div>
        )}
      </Card>
    )}

    <Card class="mb-6">
      <SectionTitle>Actions</SectionTitle>
      <div class="flex flex-wrap items-center gap-2">
        {STATUS_ACTIONS.filter((a) => a.status !== job.status).map((a) => (
          <form method="post" action={`/jobs/${job.id}/status`}>
            <input type="hidden" name="status" value={a.status} />
            <button
              type="submit"
              class={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${a.tone}`}
            >
              {a.label}
            </button>
          </form>
        ))}
        <form method="post" action={`/jobs/${job.id}/reclassify`}>
          <button
            type="submit"
            class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Re-classify
          </button>
        </form>
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
          <div>
            <label class="block text-xs uppercase tracking-wider text-zinc-500">
              Pipeline stage
            </label>
            <select
              name="pipelineStage"
              class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
            >
              <option value="" selected={!job.pipelineStage}>
                — not in funnel —
              </option>
              {PIPELINE_STAGES.map((s) => (
                <option value={s} selected={job.pipelineStage === s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label class="block text-xs uppercase tracking-wider text-zinc-500">
              Applied at (date)
            </label>
            <input
              type="date"
              name="appliedAt"
              value={job.appliedAt ? toIsoDate(job.appliedAt) : ''}
              class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="block text-xs uppercase tracking-wider text-zinc-500">
              Recruiter contact
            </label>
            <input
              type="text"
              name="recruiterContact"
              value={job.recruiterContact ?? ''}
              placeholder="e.g. jane@acme.com or Jane Doe (LinkedIn)"
              class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="block text-xs uppercase tracking-wider text-zinc-500">
              Notes
            </label>
            <textarea
              name="applicationNotes"
              rows={3}
              class="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
            >{job.applicationNotes ?? ''}</textarea>
          </div>
          <div class="sm:col-span-2">
            <button
              type="submit"
              class="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Save application
            </button>
          </div>
        </form>
      </Card>
    )}

    <Card>
      <SectionTitle>Description</SectionTitle>
      <pre class="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-zinc-300">
        {job.description || '(empty)'}
      </pre>
    </Card>
  </Layout>
);

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
