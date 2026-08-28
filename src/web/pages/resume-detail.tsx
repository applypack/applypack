/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  FitBadge,
  Flash,
  Hint,
  Input,
  SectionTitle,
  Table,
  Tag,
  Td,
  Tr,
} from '../ui';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import type { FlashMessage } from '../flash';
import { formatDate, formatRelative } from '../format';
import type { MatchWithJob, ResumeSummary } from '../../resume/store';
import { readIssues } from '../../resume/prompts';

export interface ResumeDetailProps {
  resume: ResumeSummary;
  matches: MatchWithJob[];
  flash?: FlashMessage | null;
}

export const ResumeDetailPage: FC<ResumeDetailProps> = ({ resume, matches, flash }) => {
  const issues = readIssues(resume.issues);
  return (
    <Layout title={resume.name} active="resumes">
      <a href="/resumes" class="mb-4 inline-block text-xs text-ink-faint hover:text-ink">
        ← All resumes
      </a>
      <Flash flash={flash} />

      <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0 sm:flex-1">
          <h1 class="text-2xl font-semibold tracking-tight">{resume.name}</h1>
          <div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span class="font-mono text-xs">{resume.sourceFilename}</span>
            <Badge tone="info">v{resume.version}</Badge>
            {resume.isDefault && <Badge tone="ok">default</Badge>}
            {resume.seniority && <Badge tone="info">{resume.seniority}</Badge>}
            {resume.yearsExperience !== null && (
              <Badge tone="neutral">{resume.yearsExperience} yrs</Badge>
            )}
          </div>
        </div>
        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="secondary" href={`/resumes/${resume.id}/download`}>
            Download original
          </Button>
          <ActionForm action={`/resumes/${resume.id}/rescan`}>
            <Button variant="violet">{resume.scannedAt ? 'Re-scan' : 'Scan'}</Button>
          </ActionForm>
          {!resume.isDefault && (
            <ActionForm action={`/resumes/${resume.id}/default`}>
              <Button variant="secondary">Set default</Button>
            </ActionForm>
          )}
          <ActionForm
            action={`/resumes/${resume.id}/delete`}
            confirm="Delete this resume and its comparisons?"
          >
            <Button variant="danger">Delete</Button>
          </ActionForm>
        </div>
      </div>

      <Card class="mb-6">
        <SectionTitle>Scan</SectionTitle>
        {resume.scannedAt ? (
          <div class="space-y-3">
            <div class="text-sm">
              <span class="text-ink-faint">Headline: </span>
              <span class="font-medium text-ink">{resume.title ?? '—'}</span>
              <span class="ml-3 text-xs text-ink-faint">
                scanned {formatRelative(resume.scannedAt)}
              </span>
            </div>
            {resume.summary && <p class="max-w-prose text-sm leading-6 text-ink">{resume.summary}</p>}
            <TagRow label="Roles" items={resume.roleTypes} tone="info" />
            <TagRow label="Skills" items={resume.skills} tone="ok" />
          </div>
        ) : (
          <Empty>Not scanned yet — click "Scan" to extract headline, skills and issues.</Empty>
        )}
      </Card>

      <Card class="mb-6">
        <SectionTitle>Issues to fix (any job)</SectionTitle>
        {issues.length === 0 ? (
          <Hint>{resume.scannedAt ? 'Nothing flagged — the parser-facing basics look fine.' : 'Appears after the first scan.'}</Hint>
        ) : (
          <ul class="divide-y divide-line">
            {issues.map((i) => (
              <li class="flex flex-col gap-1 py-2.5 sm:flex-row sm:gap-4">
                <div class="shrink-0 sm:w-44">
                  <Badge tone="warn">{i.section}</Badge>
                </div>
                <div class="min-w-0 text-sm">
                  <div class="text-ink">{i.issue}</div>
                  <div class="mt-0.5 text-xs leading-5 text-ink-muted">→ {i.fix}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card class="mb-6">
        <SectionTitle>Upload a new version</SectionTitle>
        <form
          method="post"
          action={`/resumes/${resume.id}/replace`}
          enctype="multipart/form-data"
          class="grid gap-3 sm:grid-cols-12"
        >
          <Field label="File" hint={`${ACCEPTED_EXTENSIONS.join(', ')} · up to 2 MB`} class="sm:col-span-9">
            <Input type="file" name="file" required accept={ACCEPTED_EXTENSIONS.join(',')} class="file:mr-3 file:rounded file:border-0 file:bg-surface-overlay file:px-2 file:py-1 file:text-xs file:text-ink" />
          </Field>
          <div class="flex items-end sm:col-span-3">
            <Button class="w-full">Upload v{resume.version + 1} &amp; scan</Button>
          </div>
          <Hint class="sm:col-span-12">
            Edited the resume from the comparison notes? Upload it here, then hit Compare on the job
            again — the history below shows how the score moves between versions.
          </Hint>
        </form>
      </Card>

      <Card class="mb-6" flush>
        <div class="px-5 pt-5">
          <SectionTitle>Comparisons</SectionTitle>
        </div>
        {matches.length === 0 ? (
          <div class="px-5 pb-5">
            <Hint>None yet. Open a job and use "Resume match" to compare this resume against it.</Hint>
          </div>
        ) : (
          <Table columns={['Job', 'Company', 'Version', 'Match', 'When']}>
            {matches.map((m) => (
              <Tr>
                <Td>
                  <a
                    href={`/jobs/${m.job.id}?match=${m.id}#resume-match`}
                    class="font-medium text-ink hover:text-accent"
                  >
                    {m.job.title}
                  </a>
                </Td>
                <Td class="text-ink-muted">{m.job.company.name}</Td>
                <Td class="font-mono text-xs text-ink-faint">v{m.resumeVersion}</Td>
                <Td>
                  <FitBadge score={m.matchScore} label="match" />
                </Td>
                <Td class="whitespace-nowrap text-xs text-ink-faint">{formatDate(m.createdAt)}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <details>
          <summary class="cursor-pointer text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Extracted text ({resume.text.length.toLocaleString()} chars) — what the AI and an ATS see
          </summary>
          <pre class="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-ink-muted">
            {resume.text}
          </pre>
        </details>
      </Card>
    </Layout>
  );
};

const TagRow: FC<{ label: string; items: string[]; tone: 'ok' | 'info' }> = ({ label, items, tone }) =>
  items.length === 0 ? null : (
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="mr-1 text-xs uppercase tracking-wider text-ink-faint">{label}</span>
      {items.map((t) => (
        <Tag tone={tone}>{t}</Tag>
      ))}
    </div>
  );
