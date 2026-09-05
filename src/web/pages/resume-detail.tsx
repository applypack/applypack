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
import { deleteConfirm, type DeleteImpact } from '../delete-confirm';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MAX_UPLOAD_MB } from '../upload';
import type { FlashMessage } from '../flash';
import { formatDate, formatRelative } from '../format';
import type { ResumeReview } from '@prisma/client';
import type { MatchWithJob, ResumeSummary } from '../../resume/store';
import { ResumeReviewCard } from './resume-review-card';
import type { ReviewAnswer } from '../../resume/answers';
import type { ReviewDelta } from '../../resume/review-delta';
import { groupMatchesByJob, historyLabel, progression } from '../match-history';
import { reviewIsStale } from '../../resume/review-score';
import { readIssues } from '../../resume/prompts';
import type { ParseWarning } from '../../resume/parse-warnings';
import { describeStructure, type DocxStructure } from '../../resume/docx-structure';
import type { DocxProps } from '../../resume/docx-props';
import type { ProfileDraft } from '../../resume/profile-draft';

export interface ResumeDetailProps {
  resume: ResumeSummary;
  /** The template check (ADR 0038); null for anything but a .docx. */
  structure: DocxStructure | null;
  /** Its document properties; null for anything but a .docx. */
  props: DocxProps | null;
  matches: MatchWithJob[];
  /** The latest strength review, or null when the user has never asked for one. */
  review: ResumeReview | null;
  /** The candidate's answers to the review's questions (ADR 0030 phase 3). */
  answers: ReviewAnswer[];
  /** What moved since the previous run of this resume, when there was one. */
  reviewDelta: ReviewDelta | null;
  /** What Delete would take, and what it would merely unlink — both named in the confirm. */
  deleteImpact: DeleteImpact;
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
  structure,
  props,
  matches,
  review,
  answers,
  reviewDelta,
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
          {/* The name is what every picker, flash and "applied with" line
              says, and it starts as whatever the uploaded file was called. */}
          <form method="post" action={`/resumes/${resume.id}/rename`} class="flex items-center gap-1.5">
            <Input
              name="name"
              value={resume.name}
              maxlength="120"
              required
              aria-label="Resume name"
              class="!w-56 !px-2 !py-1 !text-xs"
            />
            <Button size="sm" variant="ghost">
              Rename
            </Button>
          </form>
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

      <ResumeReviewCard resume={resume} review={review} answers={answers} delta={reviewDelta} />

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
            {groupMatchesByJob(matches).map((h) => {
              const line = historyLabel(h);
              const runs = progression(h);
              return (
                <Tr>
                  <Td class="max-w-[24rem]">
                    <a
                      href={`/jobs/${h.job.id}/target?match=${h.latest.id}`}
                      class="block truncate font-medium text-ink transition-colors duration-150 hover:text-accent-strong"
                      title={h.job.title}
                    >
                      {h.job.title}
                    </a>
                    {/* Every earlier run stays one click away — grouping must
                        not hide history, only stop repeating the job title. */}
                    {line && (
                      <div class="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-ink-faint">
                        <span class="mr-0.5">{line} ·</span>
                        {runs.map((r, i) => (
                          <>
                            {i > 0 && <span aria-hidden="true">→</span>}
                            <a
                              href={`/jobs/${h.job.id}/target?match=${r.id}`}
                              class="font-mono transition-colors duration-150 hover:text-accent-strong"
                              title={`${formatDate(r.createdAt)} · v${r.resumeVersion}`}
                            >
                              {r.matchScore}
                            </a>
                          </>
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td class="max-w-[14rem] text-ink-muted">
                    <div class="truncate">{h.job.company.name}</div>
                  </Td>
                  <Td class="whitespace-nowrap font-mono text-xs text-ink-faint">
                    v{h.latest.resumeVersion}
                    {h.latest.draft ? ' draft' : ''}
                  </Td>
                  <Td>
                    <div class="flex items-center gap-1.5">
                      <FitBadge score={h.latest.matchScore} label="match" />
                      {h.delta !== null && h.delta !== 0 && (
                        <Badge tone={h.delta > 0 ? 'ok' : 'danger'}>
                          {h.delta > 0 ? `+${h.delta}` : h.delta}
                        </Badge>
                      )}
                    </div>
                  </Td>
                  <Td class="whitespace-nowrap text-right text-[13px] text-ink-faint">
                    {formatDate(h.latest.createdAt)}
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </Card>

      {structure && <TemplateCheck resumeId={resume.id} candidate={resume.text.split('\n')[0]?.trim() || resume.name} structure={structure} props={props} />}

      <CleanVersion resumeId={resume.id} kind={structure?.kind ?? null} filename={resume.sourceFilename} />

      <Card class="mt-4" id="ats">
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

const KIND_VIEW: Record<DocxStructure['kind'], { label: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  flow: { label: 'Editable in place', tone: 'ok' },
  structural: { label: 'Partly editable', tone: 'warn' },
  unsupported: { label: 'Text only', tone: 'neutral' },
};


/**
 * "Clean version in your typeface" (ADR 0039). Offered on every resume, but
 * the sentence changes: for a PDF or a layout the patcher refuses it is the
 * way to get a file the editor can write into; for a flow .docx it is simply
 * a plainer alternative, and the card says so rather than inventing a need.
 */
const CleanVersion: FC<{ resumeId: number; kind: DocxStructure['kind'] | null; filename: string }> = ({
  resumeId,
  kind,
  filename,
}) => {
  const patchable = kind === 'flow';
  const isPdf = /\.pdf$/i.test(filename);
  return (
    <Card class="mt-4">
      <SectionTitle>Clean version in your typeface</SectionTitle>
      <p class="text-sm text-ink">
        {patchable
          ? 'This file can already be edited in place, so this is optional: a plainer single-column .docx and .pdf of the same words, set in the typography this file uses.'
          : isPdf
            ? 'A PDF has no paragraphs to edit — only glyphs at coordinates. This rebuilds the same words as a single-column .docx and .pdf in the typography your PDF uses, and the .docx is one the editor can write into.'
            : 'Some of this file’s text sits where a save cannot rewrite it line by line. This rebuilds the same words as a plain single-column .docx and .pdf, in the typography this file uses.'}
      </p>
      <Hint class="mt-2">
        It is not your original design back — the layout is rebuilt plainly. Nothing here changes this resume.
      </Hint>
      <Button href={`/resumes/${resumeId}/render`} variant={patchable ? 'secondary' : 'primary'} size="sm" class="mt-3">
        Clean version in your typeface
      </Button>
    </Card>
  );
};

/**
 * What a Save can do with this .docx (ADR 0038): the kind as a badge, the
 * lines it can rewrite, and the parts it cannot — each a plain sentence. The
 * properties fix is offered only when the file names someone else.
 */
const TemplateCheck: FC<{ resumeId: number; candidate: string; structure: DocxStructure; props: DocxProps | null }> = ({
  resumeId,
  candidate,
  structure,
  props,
}) => {
  const view = KIND_VIEW[structure.kind];
  const foreign = props
    ? [props.creator, props.lastModifiedBy].some((v) => v && !v.toLowerCase().includes(candidate.toLowerCase())) ||
      Boolean(props.title && !props.title.toLowerCase().includes(candidate.toLowerCase()))
    : false;
  return (
    <Card class="mt-4">
      <SectionTitle>Template check</SectionTitle>
      <div class="flex flex-wrap items-center gap-2">
        <Badge tone={view.tone}>{view.label}</Badge>
        <span class="text-sm text-ink-muted">{describeStructure(structure, { withNote: false })}</span>
      </div>
      {structure.notes.length > 0 && (
        <ul class="mt-3 space-y-1 text-sm text-ink-muted">
          {structure.notes.map((n) => (
            <li>{n}</li>
          ))}
        </ul>
      )}
      <Hint class="mt-3">
        Save on the targeted view writes your edits back into this file when the line is a paragraph;
        anything it cannot place honestly makes that save a text version, with the reason.
      </Hint>
      {props && foreign && (
        <form method="post" action={`/resumes/${resumeId}/props`} class="mt-4 border-t border-line pt-3" onsubmit={SUBMIT_ONCE}>
          <div class="text-sm text-ink">
            The file says it was written by <span class="font-medium">{props.creator ?? '—'}</span>
            {props.lastModifiedBy ? <> and last edited by <span class="font-medium">{props.lastModifiedBy}</span></> : null}
            {props.title ? <>, titled “{props.title}”</> : null}
            {props.application ? <> ({props.application})</> : null}.
          </div>
          <Hint class="mt-1">
            A downloaded template keeps its author's name. Nothing rejects a resume for it, but a human who opens
            File → Properties sees it. This writes <span class="font-medium">{candidate}</span> as the author and title,
            and changes nothing else.
          </Hint>
          <Button variant="secondary" size="sm" class="mt-2">
            Fix document properties
          </Button>
        </form>
      )}
    </Card>
  );
};
