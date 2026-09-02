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
  SUBMIT_ONCE,
  Table,
  Tag,
  Td,
  Tr,
} from '../ui';
import { deleteConfirm } from '../delete-confirm';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MAX_UPLOAD_MB } from '../upload';
import type { FlashMessage } from '../flash';
import { formatDate, formatRelative } from '../format';
import type { ResumeReview } from '@prisma/client';
import type { MatchWithJob, ResumeSummary } from '../../resume/store';
import { ResumeReviewCard } from './resume-review-card';
import { reviewIsStale } from '../../resume/review-score';
import { readIssues } from '../../resume/prompts';
import type { ParseWarning } from '../../resume/parse-warnings';
import type { ProfileDraft } from '../../resume/profile-draft';

export interface ResumeDetailProps {
  resume: ResumeSummary;
  matches: MatchWithJob[];
  /** The latest strength review, or null when the user has never asked for one. */
  review: ResumeReview | null;
  /** What Delete would cascade — named in the confirm: comparisons, letters and reviews. */
  deleteImpact: { matches: number; letters: number; reviews: number };
  /** Deterministic ATS-parseability checks over the extracted text. */
  warnings: ParseWarning[];
  /** Searches already linked to this resume, and the one a click would create. */
  search: {
    linkedProfiles: { id: number; name: string }[];
    draft: ProfileDraft | null;
  };
  flash?: FlashMessage | null;
}

export const ResumeDetailPage: FC<ResumeDetailProps> = ({
  resume,
  matches,
  review,
  deleteImpact,
  warnings,
  search,
  flash,
}) => {
  const issues = readIssues(resume.issues);
  // One advice surface, never two (resumes-plan §B.2): once a review has read
  // the CURRENT version, its list supersedes the scan's notes, which stay
  // available behind a disclosure rather than competing for attention.
  const reviewed = review !== null && !reviewIsStale(review.resumeVersion, resume.version);
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
            <ActionForm action={`/resumes/${resume.id}/rescan`} once>
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
              confirm={deleteConfirm(resume.name, deleteImpact)}
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

      <ResumeReviewCard resume={resume} review={review} />

      <div class="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
                <p class="text-sm leading-6 text-ink">{resume.summary}</p>
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
          ) : reviewed ? (
            <>
              <Hint>
                The strength review above judged this version — follow its list. These are the
                first scan's notes, kept for reference.
              </Hint>
              <details class="mt-2">
                <summary class="cursor-pointer text-[13px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink">
                  What the scan flagged — {issues.length} note{issues.length === 1 ? '' : 's'}
                </summary>
                <IssueList issues={issues} />
              </details>
            </>
          ) : (
            <IssueList issues={issues} />
          )}
        </Card>
      </div>

      <SearchCard resumeId={resume.id} {...search} />

      <Card class="mt-4">
        <SectionTitle>Upload a new version</SectionTitle>
        <form
          method="post"
          action={`/resumes/${resume.id}/replace`}
          enctype="multipart/form-data"
          onsubmit={SUBMIT_ONCE}
          class="grid gap-3 sm:grid-cols-[1.6fr_auto]"
        >
          <Field label="File" hint={`${ACCEPTED_EXTENSIONS.join(', ')} · up to ${MAX_UPLOAD_MB} MB`}>
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
        <SectionTitle>What the ATS sees</SectionTitle>
        {warnings.length === 0 ? (
          <Hint>
            Extraction looks clean — selectable text, contact details found, normal length. Parsers
            should read this file the way you do.
          </Hint>
        ) : (
          <ul class="mb-3 space-y-1.5">
            {warnings.map((w) => (
              <li class="flex items-start gap-2 text-sm">
                <Badge tone="warn">{w.code.replace(/_/g, ' ')}</Badge>
                <span class="min-w-0 text-ink-muted">{w.message}</span>
              </li>
            ))}
          </ul>
        )}
        <details class="mt-2">
          <summary class="cursor-pointer select-none text-sm font-semibold text-ink">
            Extracted text ({resume.text.length.toLocaleString()} chars) — exactly what the AI and
            an ATS parser get
          </summary>
          <pre class="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-ink-muted">
            {resume.text}
          </pre>
        </details>
      </Card>
    </Layout>
  );
};

/**
 * Stage A of the multi-resume search: one press turns a scanned resume into a
 * search that hunts the jobs you'd apply to with it. The draft is shown in
 * full first — the button saves exactly what the line above it says (ADR 0015).
 */
const SearchCard: FC<ResumeDetailProps['search'] & { resumeId: number }> = ({
  resumeId,
  linkedProfiles,
  draft,
}) => {
  return (
    <Card class="mt-4">
      <SectionTitle>Search profile</SectionTitle>
      {linkedProfiles.length > 0 && (
        <p class="text-sm text-ink">
          This resume is what{' '}
          {linkedProfiles.map((p, i) => (
            <>
              {i > 0 && ', '}
              <a
                href={`/settings?tab=profile&profile=${p.id}`}
                class="font-medium text-accent-strong hover:underline"
              >
                {p.name}
              </a>
            </>
          ))}{' '}
          {linkedProfiles.length === 1 ? 'hunts with' : 'hunt with'} — job pages preselect it for
          those searches.
        </p>
      )}
      {draft === null ? (
        <Hint class={linkedProfiles.length > 0 ? 'mt-3' : ''}>
          Scan the resume first — a search is built from the headline, tools and roles the scan
          finds.
        </Hint>
      ) : (
        <>
          <p class={`text-sm text-ink-muted ${linkedProfiles.length > 0 ? 'mt-3' : ''}`}>
            {linkedProfiles.length > 0 ? 'Add another search' : 'Create a search'} that hunts the
            jobs you'd apply to with this resume:
          </p>
          <div class="mt-2.5 flex flex-wrap items-center gap-1.5 text-sm">
            <span class="font-medium text-ink">"{draft.changes.name}"</span>
            {(draft.changes.stackRequired ?? []).map((t) => (
              <Tag tone="ok">{t}</Tag>
            ))}
            {(draft.changes.roleTypes ?? []).map((t) => (
              <Tag tone="info">{t}</Tag>
            ))}
            {(draft.changes.seniority ?? []).map((t) => (
              <Tag tone="info">{t}</Tag>
            ))}
          </div>
          {draft.warnings.length > 0 && (
            <p class="mt-2 text-[13px] leading-5 text-warn">Note: {draft.warnings.join('; ')}.</p>
          )}
          <div class="mt-3.5">
            <ActionForm action={`/resumes/${resumeId}/profile`}>
              <Button variant="violet" size="sm">
                Create a search from this resume
              </Button>
            </ActionForm>
          </div>
          <Hint class="mt-3">
            It starts switched off — your current search keeps running until you press Activate on
            Settings → Profile. Location, salary and alert routing are yours to set; a resume
            cannot know them.
          </Hint>
        </>
      )}
    </Card>
  );
};

const IssueList: FC<{ issues: ReturnType<typeof readIssues> }> = ({ issues }) => (
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
);

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
