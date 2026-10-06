/** @jsxImportSource hono/jsx */
import type { Child, FC } from 'hono/jsx';
import { parsedView } from '../parsed-view';
import { ParsedViewBlock } from './parsed-view-block';
import { Layout } from '../layout';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  ConfirmAction,
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
  When,
} from '../ui';
import { deleteConfirm, type DeleteImpact } from '../delete-confirm';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MAX_UPLOAD_MB } from '../upload';
import type { FlashMessage } from '../flash';
import { formatDate } from '../format';
import type { ResumeReview } from '@prisma/client';
import type { MatchRunSummary, ResumeSummary } from '../../resume/store';
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
import type { Coverage, CoverageKind } from '../../resume/coverage';
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

export interface ResumeDetailProps {
  resume: ResumeSummary;
  /** The template check (ADR 0038); null for anything but a .docx. */
  structure: DocxStructure | null;
  /** Its document properties; null for anything but a .docx. */
  props: DocxProps | null;
  matches: MatchRunSummary[];
  /** What the compared postings keep asking for and the text lacks; null under `coverage.ts:MIN_POSTINGS`. */
  coverage: Coverage | null;
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
  coverage,
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
    <Layout title={resume.name} titleIsData active="resumes">
      <PageHeader
        title={resume.name}
        titleIsData
        back={{ href: '/resumes', label: t('resume.allResumes') }}
        actions={
          <div class="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" href={`/resumes/${resume.id}/download`}>
              {t('resume.downloadOriginal')}
            </Button>
            <ActionForm action={`/resumes/${resume.id}/rescan`} once>
              <Button variant="violet" size="sm">
                {resume.scannedAt ? t('resume.reScan') : t('resume.scanButton')}
              </Button>
            </ActionForm>
            {!resume.isDefault && (
              <ActionForm action={`/resumes/${resume.id}/default`}>
                <Button variant="secondary" size="sm">
                  {t('resume.setDefault')}
                </Button>
              </ActionForm>
            )}
            <ConfirmAction action={`/resumes/${resume.id}/delete`} label={t('common.delete')} confirm={deleteConfirm(resume.name, deleteImpact)} />
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
              aria-label={t('resume.resumeName')}
              class="!w-56 !px-2 !py-1 !text-meta"
            />
            <Button variant="ghost">
              {t('resume.rename')}
            </Button>
          </form>
          <span class="break-all font-mono text-meta" translate="no">
            {resume.sourceFilename}
          </span>
          <Badge tone="info">v{resume.version}</Badge>
          {resume.isDefault && <Badge tone="ok">{t('resume.default')}</Badge>}
          {/* The scan's own word for the level. */}
          {resume.seniority && (
            <Badge tone="info">
              <span lang="en">{resume.seniority}</span>
            </Badge>
          )}
          {resume.yearsExperience !== null && (
            <Badge tone="neutral">{t('resume.years', { n: resume.yearsExperience })}</Badge>
          )}
        </span>
      </PageHeader>
      <Flash flash={flash} />

      <ResumeReviewCard resume={resume} review={review} answers={answers} delta={reviewDelta} />

      <div class="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <SectionTitle>{t('resume.scanTitle')}</SectionTitle>
          {resume.scannedAt ? (
            <div class="space-y-3">
              <div class="text-sm">
                <span class="text-ink-faint">{t('resume.headline')} </span>
                {/* The headline and the summary are the scan's: a model wrote them. */}
                <span class="font-medium text-ink" lang="en">
                  {resume.title ?? '—'}
                </span>
                <span class="ml-3 text-meta text-ink-faint">
                  {tRich('resume.scannedWhen', {}, { when: () => <When at={resume.scannedAt} /> })}
                </span>
              </div>
              {resume.summary && (
                <p class="text-sm leading-6 text-ink" lang="en">
                  {resume.summary}
                </p>
              )}
              <TagRow label={t('resume.domains')} items={resume.industries} tone="info" />
              <TagRow label={t('resume.roles')} items={resume.roleTypes} tone="info" />
              <TagRow label={t('resume.skills')} items={resume.skills} tone="ok" />
            </div>
          ) : (
            <Empty bare title={t('resume.notScannedYet')}>
              {t('resume.aScanReadsTheHeadline')}
            </Empty>
          )}
        </Card>

        <Card>
          <SectionTitle>{t('resume.issuesToFixAnyJob')}</SectionTitle>
          {issues.length === 0 ? (
            <Hint>
              {resume.scannedAt
                ? t('resume.nothingFlaggedTheParserFacing')
                : t('resume.appearsAfterTheFirstScan')}
            </Hint>
          ) : reviewed ? (
            <>
              <Hint>
                {t('resume.theStrengthReviewAboveJudged')}
              </Hint>
              <details class="mt-2">
                <summary class="cursor-pointer text-note font-medium text-ink-muted transition-colors duration-150 hover:text-ink">
                  {t('resume.scanFlagged', { n: issues.length })}
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
        <SectionTitle>{t('resume.uploadANewVersion')}</SectionTitle>
        <form
          method="post"
          action={`/resumes/${resume.id}/replace`}
          enctype="multipart/form-data"
          onsubmit={SUBMIT_ONCE}
          class="grid gap-3 sm:grid-cols-[1.6fr_auto]"
        >
          <Field label={t('resume.file')} hint={t('upload.fileHint', { types: ACCEPTED_EXTENSIONS.join(', '), mb: MAX_UPLOAD_MB })}>
            <Input
              type="file"
              name="file"
              required
              accept={ACCEPTED_EXTENSIONS.join(',')}
              class="file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-overlay file:px-2.5 file:py-1 file:text-meta file:font-medium file:text-ink"
            />
          </Field>
          <div class="flex items-end">
            <Button class="w-full">{t('resume.uploadVersionScan', { version: resume.version + 1 })}</Button>
          </div>
          <Hint class="sm:col-span-2">
            {t('resume.editedTheResumeFromThe')}
          </Hint>
        </form>
      </Card>

      <Card class="mt-4" flush>
        <div class="border-b border-line px-5 py-3 text-entity text-ink">
          {t('resume.comparisons')}
        </div>
        {matches.length === 0 ? (
          <Empty
            bare
            title={t('resume.noComparisonsYet')}
            action={
              <Button href="/jobs" variant="secondary" size="sm">
                {t('resume.openYourJobs')}
              </Button>
            }
          >
            {t('resume.openAJobAndPress')}
          </Empty>
        ) : (
          <Table
            columns={[
              t('resume.col.job'),
              t('common.company'),
              t('resume.col.version'),
              t('resume.col.match'),
              <span class="block text-right">{t('resume.col.when')}</span>,
            ]}
          >
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
                      translate="no"
                    >
                      {h.job.title}
                    </a>
                    {/* Every earlier run stays one click away — grouping must
                        not hide history, only stop repeating the job title. */}
                    {line && (
                      <div class="mt-0.5 flex flex-wrap items-center gap-x-1 text-meta text-ink-faint">
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
                    <div class="truncate" translate="no">
                      {h.job.employer ?? h.job.company.name}
                    </div>
                  </Td>
                  <Td class="whitespace-nowrap font-mono text-meta text-ink-faint">
                    {h.latest.draft ? t('resume.versionDraft', { version: h.latest.resumeVersion }) : `v${h.latest.resumeVersion}`}
                  </Td>
                  <Td>
                    <div class="flex items-center gap-1.5">
                      <FitBadge score={h.latest.matchScore} label={t('resume.matchLabel')} />
                      {h.delta !== null && h.delta !== 0 && (
                        <Badge tone={h.delta > 0 ? 'ok' : 'danger'}>
                          {h.delta > 0 ? `+${h.delta}` : h.delta}
                        </Badge>
                      )}
                    </div>
                  </Td>
                  <Td class="whitespace-nowrap text-right text-note text-ink-faint">
                    {formatDate(h.latest.createdAt)}
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </Card>

      {coverage && <CoverageCard coverage={coverage} />}

      {structure && <TemplateCheck resumeId={resume.id} candidate={resume.text.split('\n')[0]?.trim() || resume.name} structure={structure} props={props} />}

      <CleanVersion resumeId={resume.id} kind={structure?.kind ?? null} filename={resume.sourceFilename} />

      <Card class="mt-4" id="ats">
        <SectionTitle>{t('resume.whatTheAtsSees')}</SectionTitle>
        <ParsedViewBlock view={parsedView(resume.text)} />
        <Hint class="mb-4">{t('resume.readByAPlainParser')}</Hint>
        {warnings.length === 0 ? (
          <Hint>
            {t('resume.extractionLooksCleanSelectableText')}
          </Hint>
        ) : (
          <ul class="mb-3 space-y-1.5">
            {warnings.map((w) => (
              <li class="flex items-start gap-2 text-sm">
                <Badge tone="warn">{w.label}</Badge>
                <span class="min-w-0 text-ink-muted">{w.shown}</span>
              </li>
            ))}
          </ul>
        )}
        <form
          method="post"
          action={`/resumes/${resume.id}/compare-format`}
          enctype="multipart/form-data"
          onsubmit={SUBMIT_ONCE}
          class="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1.6fr_auto]"
        >
          <Field label={t('resume.theSameResumeInAnother')} hint={t('upload.fileHint', { types: ACCEPTED_EXTENSIONS.join(', '), mb: MAX_UPLOAD_MB })}>
            <Input
              type="file"
              name="file"
              required
              accept={ACCEPTED_EXTENSIONS.join(',')}
              class="file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-overlay file:px-2.5 file:py-1 file:text-meta file:font-medium file:text-ink"
            />
          </Field>
          <div class="flex items-end">
            <Button variant="secondary" class="w-full">{t('resume.compareTheTwoFiles')}</Button>
          </div>
          <Hint class="sm:col-span-2">
            {t('resume.haveItAsADocx')}
          </Hint>
        </form>
        <details class="mt-2">
          <summary class="cursor-pointer select-none text-label text-ink">
            {t('resume.extractedText', { n: resume.text.length })}
          </summary>
          <pre class="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-ink-muted" translate="no">
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
      <SectionTitle>{t('resume.searchProfile')}</SectionTitle>
      {linkedProfiles.length > 0 && (
        <p class="text-sm text-ink">
          {tRich('resume.search.linked', { n: linkedProfiles.length }, {
            names: () =>
              linkedProfiles.map((p, i) => (
                <>
                  {i > 0 && ', '}
                  <a
                    href={`/settings?tab=profile&profile=${p.id}`}
                    class="font-medium text-accent-strong hover:underline"
                    translate="no"
                  >
                    {p.name}
                  </a>
                </>
              )),
          })}
        </p>
      )}
      {draft === null ? (
        <Hint class={linkedProfiles.length > 0 ? 'mt-3' : ''}>
          {t('resume.scanTheResumeFirstA')}
        </Hint>
      ) : (
        <>
          <p class={`text-sm text-ink-muted ${linkedProfiles.length > 0 ? 'mt-3' : ''}`}>
            {linkedProfiles.length > 0 ? t('resume.search.addLead') : t('resume.search.createLead')}
          </p>
          {/* The draft is the scan's own words: a name, technologies, roles. */}
          <div class="mt-2.5 flex flex-wrap items-center gap-1.5 text-sm" translate="no">
            <span class="font-medium text-ink">"{draft.changes.name}"</span>
            {(draft.changes.stackRequired ?? []).map((tag) => (
              <Tag tone="ok">{tag}</Tag>
            ))}
            {(draft.changes.roleTypes ?? []).map((tag) => (
              <Tag tone="info">{tag}</Tag>
            ))}
            {(draft.changes.seniority ?? []).map((tag) => (
              <Tag tone="info">{tag}</Tag>
            ))}
          </div>
          {draft.warnings.length > 0 && (
            <p class="mt-2 text-note leading-5 text-warn">{t('resume.search.note', { warnings: draft.warnings.join('; ') })}</p>
          )}
          <div class="mt-3.5 flex flex-wrap items-center gap-3">
            {/* The card's one act, and it spends no AI: the draft above is the stored scan's. */}
            <ActionForm action={`/resumes/${resumeId}/profile`}>
              <Button size="sm">{t('resume.createASearchFromThis')}</Button>
            </ActionForm>
            <a href={`/settings?tab=profile&fill=${resumeId}#fill`} class="text-note font-medium text-accent-strong hover:text-accent-deep">
              {t('resume.orFillYourCurrentSearch')}
            </a>
          </div>
          <Hint class="mt-3">
            {t('resume.itStartsSwitchedOffYour')}
          </Hint>
        </>
      )}
    </Card>
  );
};

/** The scan's notes, in the model's own words. */
const IssueList: FC<{ issues: ReturnType<typeof readIssues> }> = ({ issues }) => (
  <ul class="divide-y divide-line">
    {issues.map((i) => (
      <li class="py-3 first:pt-0 last:pb-0">
        <Badge tone="warn">
          <span lang="en">{i.section}</span>
        </Badge>
        <div class="mt-1.5 min-w-0 text-sm" lang="en">
          <div class="text-ink">{i.issue}</div>
          <div class="mt-0.5 text-note leading-5 text-ink-muted">→ {i.fix}</div>
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
      <span class="mr-1 text-note font-medium text-ink-muted">{label}</span>
      {items.map((item) => (
        <span class="inline-flex" translate="no">
          <Tag tone={tone}>{item}</Tag>
        </span>
      ))}
    </div>
  );

const KIND_VIEW = {
  flow: { label: 'resume.template.flow', tone: 'ok' },
  structural: { label: 'resume.template.structural', tone: 'warn' },
  unsupported: { label: 'resume.template.unsupported', tone: 'neutral' },
} as const satisfies Record<DocxStructure['kind'], { label: MessageKey; tone: 'ok' | 'warn' | 'neutral' }>;

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
      <SectionTitle>{t('resume.cleanVersionInYourTypeface')}</SectionTitle>
      <p class="text-sm text-ink">
        {patchable
          ? t('resume.thisFileCanAlreadyBe')
          : isPdf
            ? t('resume.aPdfHasNoParagraphs')
            : t('resume.someOfThisFilesText')}
      </p>
      <Hint class="mt-2">
        {t('resume.itIsNotYourOriginal')}
      </Hint>
      <Button href={`/resumes/${resumeId}/render`} variant={patchable ? 'secondary' : 'primary'} size="sm" class="mt-3">
        {t('resume.cleanVersionInYourTypeface')}
      </Button>
    </Card>
  );
};

/** A name as the file or the resume writes it, inside a sentence of ours. */
const bold = (words: Child[]) => (
  <span class="font-medium" translate="no">
    {words}
  </span>
);

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
      <SectionTitle>{t('resume.templateCheck')}</SectionTitle>
      <div class="flex flex-wrap items-center gap-2">
        <Badge tone={view.tone}>{t(view.label)}</Badge>
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
        {t('resume.saveInTheResumeEditor')}
      </Hint>
      {props && foreign && (
        <form method="post" action={`/resumes/${resumeId}/props`} class="mt-4 border-t border-line pt-3" onsubmit={SUBMIT_ONCE}>
          <div class="text-sm text-ink">
            {tRich(
              'resume.props.says',
              {
                creator: props.creator ?? '—',
                edited: props.lastModifiedBy ? 'yes' : 'no',
                editor: props.lastModifiedBy ?? '',
                titled: props.title ? 'yes' : 'no',
                title: props.title ?? '',
                app: props.application ? 'yes' : 'no',
                application: props.application ?? '',
              },
              { b: bold },
            )}
          </div>
          <Hint class="mt-1">{tRich('resume.props.fixHint', { candidate }, { b: bold })}</Hint>
          <Button variant="secondary" size="sm" class="mt-2">
            {t('resume.fixDocumentProperties')}
          </Button>
        </form>
      )}
    </Card>
  );
};

/** What each reading asks of the user — the one move that closes it. */
const CoverageMove: FC<{ kind: CoverageKind }> = ({ kind }) =>
  kind === 'unwritten' ? (
    <>{t('resume.aComparisonFoundItIn')}</>
  ) : kind === 'unconfirmed' ? (
    <>
      {tRich('resume.coverage.unconfirmed', {}, {
        link: (words) => (
          <a href="/resumes#facts" class="font-medium text-accent-strong transition-colors duration-150 hover:text-accent-deep">
            {words}
          </a>
        ),
      })}
    </>
  ) : (
    <>{t('resume.notOnYourResumeA')}</>
  );

/**
 * "Missing across postings" (N10): the terms the latest comparison of each
 * posting asked for and this resume does not say, as the text reads now.
 */
const CoverageCard: FC<{ coverage: Coverage }> = ({ coverage }) => (
  <Card class="mt-4" flush>
    <div class="border-b border-line px-5 py-3">
      <div class="text-entity text-ink">{t('resume.missingAcrossPostings')}</div>
      <Hint class="mt-0.5">
        {t('resume.coverage.hint', { n: coverage.postings })}
      </Hint>
    </div>
    {coverage.terms.length === 0 ? (
      <div class="px-5 py-4">
        <Hint>{t('resume.noKeywordIsMissingFrom')}</Hint>
      </div>
    ) : (
      <Table
        caption={t('resume.keywordsMissingAcrossComparedPostings')}
        columns={[t('resume.coverage.col.keyword'), t('resume.coverage.col.missingIn'), t('resume.coverage.col.closes')]}
        widths={['w-[28%]', 'w-[24%]', 'w-[47%]']}
      >
        {coverage.terms.map((row) => (
          <Tr>
            <Td class="font-medium text-ink">
              <span translate="no">{row.term}</span>
            </Td>
            <Td class="tabular-nums">
              <div class="whitespace-nowrap">{t('resume.coverage.missingOf', { missing: row.missing, postings: coverage.postings })}</div>
              {row.must > 0 && <div class="text-meta text-ink-faint">{t('resume.coverage.asMust', { n: row.must })}</div>}
            </Td>
            <Td class="text-ink-muted">
              <CoverageMove kind={row.kind} />
            </Td>
          </Tr>
        ))}
      </Table>
    )}
  </Card>
);
