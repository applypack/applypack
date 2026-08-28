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
  PageHeader,
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
      <PageHeader
        title={resume.name}
        back={{ href: '/resumes', label: 'All resumes' }}
        actions={
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" href={`/resumes/${resume.id}/download`}>
              Download original
            </Button>
            <ActionForm action={`/resumes/${resume.id}/rescan`}>
              <Button variant="violet" size="sm">
                {resume.scannedAt ? 'Re-scan' : 'Scan'}
              </Button>
            </ActionForm>
            {!resume.isDefault && (
              <ActionForm action={`/resumes/${resume.id}/default`}>
                <Button variant="secondary" size="sm">
                  Set default
                </Button>
              </ActionForm>
            )}
            <ActionForm
              action={`/resumes/${resume.id}/delete`}
              confirm="Delete this resume and its comparisons?"
            >
              <Button variant="danger" size="sm">
                Delete
              </Button>
            </ActionForm>
          </div>
        }
      >
        <span class="flex flex-wrap items-center gap-2">
          <span class="break-all font-mono text-xs">{resume.sourceFilename}</span>
          <Badge tone="info">v{resume.version}</Badge>
          {resume.isDefault && <Badge tone="ok">default</Badge>}
          {resume.seniority && <Badge tone="info">{resume.seniority}</Badge>}
          {resume.yearsExperience !== null && (
            <Badge tone="neutral">{resume.yearsExperience} yrs</Badge>
          )}
        </span>
      </PageHeader>
      <Flash flash={flash} />

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
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
              {resume.summary && (
                <p class="max-w-prose text-sm leading-6 text-ink">{resume.summary}</p>
              )}
              <TagRow label="Roles" items={resume.roleTypes} tone="info" />
              <TagRow label="Skills" items={resume.skills} tone="ok" />
            </div>
          ) : (
            <Empty>Not scanned yet — click "Scan" to extract headline, skills and issues.</Empty>
          )}
        </Card>

        <Card>
          <SectionTitle>Issues to fix (any job)</SectionTitle>
          {issues.length === 0 ? (
            <Hint>
              {resume.scannedAt
                ? 'Nothing flagged — the parser-facing basics look fine.'
                : 'Appears after the first scan.'}
            </Hint>
          ) : (
            <ul class="divide-y divide-line">
              {issues.map((i) => (
                <li class="py-3 first:pt-0 last:pb-0">
                  <Badge tone="warn">{i.section}</Badge>
                  <div class="mt-1.5 min-w-0 text-sm">
                    <div class="text-ink">{i.issue}</div>
                    <div class="mt-0.5 text-[13px] leading-5 text-ink-muted">→ {i.fix}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card class="mt-4 max-w-3xl">
        <SectionTitle>Upload a new version</SectionTitle>
        <form
          method="post"
          action={`/resumes/${resume.id}/replace`}
          enctype="multipart/form-data"
          class="grid gap-3 sm:grid-cols-[1.6fr_auto]"
        >
          <Field label="File" hint={`${ACCEPTED_EXTENSIONS.join(', ')} · up to 2 MB`}>
            <Input
              type="file"
              name="file"
              required
              accept={ACCEPTED_EXTENSIONS.join(',')}
              class="file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-overlay file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-ink"
            />
          </Field>
          <div class="flex items-end">
            <Button class="w-full">Upload v{resume.version + 1} &amp; scan</Button>
          </div>
          <Hint class="sm:col-span-2">
            Edited the resume from the comparison notes? Upload it here, then hit Compare on the
            job again — the history below shows how the score moves between versions.
          </Hint>
        </form>
      </Card>

      <Card class="mt-4" flush>
        <div class="border-b border-line px-5 py-3 text-sm font-semibold text-ink">
          Comparisons
        </div>
        {matches.length === 0 ? (
          <div class="px-5 py-4">
            <Hint>
              None yet. Open a job and use "Resume match" to compare this resume against it.
            </Hint>
          </div>
        ) : (
          <Table columns={['Job', 'Company', 'Version', 'Match', <span class="block text-right">When</span>]}>
            {matches.map((m) => (
              <Tr>
                <Td class="max-w-[24rem]">
                  <a
                    href={`/jobs/${m.job.id}/target?match=${m.id}`}
                    class="block truncate font-medium text-ink transition-colors duration-150 hover:text-accent-strong"
                    title={m.job.title}
                  >
                    {m.job.title}
                  </a>
                </Td>
                <Td class="max-w-[14rem] text-ink-muted">
                  <div class="truncate">{m.job.company.name}</div>
                </Td>
                <Td class="whitespace-nowrap font-mono text-xs text-ink-faint">
                  v{m.resumeVersion}
                  {m.draft ? ' draft' : ''}
                </Td>
                <Td>
                  <FitBadge score={m.matchScore} label="match" />
                </Td>
                <Td class="whitespace-nowrap text-right text-[13px] text-ink-faint">
                  {formatDate(m.createdAt)}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Card class="mt-4">
        <details>
          <summary class="cursor-pointer select-none text-sm font-semibold text-ink">
            Extracted text ({resume.text.length.toLocaleString()} chars) — what the AI and an ATS
            see
          </summary>
          <pre class="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-ink-muted">
            {resume.text}
          </pre>
        </details>
      </Card>
    </Layout>
  );
};

const TagRow: FC<{ label: string; items: string[]; tone: 'ok' | 'info' }> = ({
  label,
  items,
  tone,
}) =>
  items.length === 0 ? null : (
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="mr-1 text-[13px] font-medium text-ink-muted">{label}</span>
      {items.map((t) => (
        <Tag tone={tone}>{t}</Tag>
      ))}
    </div>
  );
