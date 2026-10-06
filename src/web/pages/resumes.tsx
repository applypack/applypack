/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import {
  ActionForm,
  Badge,
  Button,
  Card,
  ConfirmAction,
  Disclosure,
  Empty,
  Field,
  FILE_INPUT_CLASS,
  FitBadge,
  Flash,
  Hint,
  Input,
  MarkIcon,
  PageHeader,
  SectionTitle,
  Select,
  SUBMIT_ONCE,
  Table,
  Tag,
  Td,
  Tr,
  When,
} from '../ui';
import type { FlashMessage } from '../flash';

import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MAX_UPLOAD_MB } from '../upload';
import { t } from '../../i18n/t';

export interface ResumeRow {
  id: number;
  name: string;
  sourceFilename: string;
  isDefault: boolean;
  scannedAt: Date | null;
  title: string | null;
  /** The 2-5 core technologies. Every resume's `skills` list looks the same. */
  primarySkills: string[];
  skills: string[];
  version: number;
  createdAt: Date;
  /** Absent until the resume has been compared with something. */
  matches: { count: number; best: number } | null;
  /** The latest strength review, absent until the user asks for one. */
  review: { reviewScore: number; resumeVersion: number } | null;
}

export interface FactRow {
  term: string;
  status: string; // confirmed | denied
  note: string | null;
}

/** Core stack fits on a phone row; the long tail collapses into "+N". */
const PRIMARY_PREVIEW = 3;

/*
 * Column visibility. The hub used to force `min-w-[52rem]`, which put Skills,
 * Scanned and BOTH action buttons behind a horizontal scroll at 375px — the
 * actions were effectively unreachable on a phone. Name, Matches and Set
 * default now survive at every width; the descriptive columns drop out.
 * The table declares it once (`hideBelow`), header and cells alike.
 */
/** Same idea for things that are not table cells. */
const HIDE_SM_INLINE = 'hidden sm:inline-flex';

export const ResumesPage: FC<{
  resumes: ResumeRow[];
  facts: FactRow[];
  flash?: FlashMessage | null;
}> = ({
  resumes,
  facts,
  flash,
}) => (
  <Layout title={t('nav.resumes')} active="resumes">
    <PageHeader title={t('nav.resumes')} meta={t('resumes.uploadedCount', { n: resumes.length })}>
      {t('resumes.theResumesYouSendEach')}
    </PageHeader>
    <Flash flash={flash} />

    {/* The list is what the page is about: with a resume in it the upload form folds
        behind its button; with none it is the first thing to do, so it stands open. */}
    <Disclosure variant="button" summary={t('resumes.uploadAResume')} open={resumes.length === 0} class="mb-4">
      <Card class="mt-3">
        <ResumeUploadForm />
      </Card>
    </Disclosure>

    {resumes.length === 0 ? (
      <Empty title={t('resumes.noResumesYet')}>
        {t('resumes.comparisonsAndCoverLettersStart')}
      </Empty>
    ) : (
      <Card flush class="mb-4">
        <Table caption={t('nav.resumes')}
          columns={[
            t('resumes.col.name'),
            t('resumes.col.headline'),
            t('resumes.col.coreStack'),
            t('resumes.col.matches'),
            t('resumes.col.strength'),
            t('resumes.col.scanned'),
            <span class="block text-right">{t('resumes.col.default')}</span>,
          ]}
          hideBelow={['', 'xl', 'lg', '', 'sm', 'sm', '']}
        >
          {resumes.map((r) => (
            <Tr>
              <Td class="max-w-[16rem]">
                <div class="flex items-center gap-2">
                  <a
                    href={`/resumes/${r.id}`}
                    class="truncate font-medium text-ink transition-colors duration-150 hover:text-accent-strong"
                    title={r.name}
                    translate="no"
                  >
                    {r.name}
                  </a>
                  {/* Both are repeated by columns of their own; at 375px the
                      row needs every pixel for the name and the action. */}
                  <Badge tone="info" class={HIDE_SM_INLINE}>
                    v{r.version}
                  </Badge>
                  {r.isDefault && <Badge tone="ok" class={HIDE_SM_INLINE}>{t('resumes.defaultBadge')}</Badge>}
                </div>
                <div class="mt-0.5 hidden truncate font-mono text-meta text-ink-faint sm:block" translate="no">
                  {r.sourceFilename}
                </div>
              </Td>
              <Td class="max-w-[16rem] text-ink-muted">
                {/* The scan's headline: the model's words about the resume. */}
                <div class="truncate" title={r.title ?? undefined} lang="en">
                  {r.title ?? '—'}
                </div>
              </Td>
              <Td class="max-w-[18rem]">
                <PrimaryStack resume={r} />
              </Td>
              <Td class="whitespace-nowrap">
                <MatchCell matches={r.matches} />
              </Td>
              <Td class="whitespace-nowrap">
                <StrengthCell resume={r} />
              </Td>
              <Td class="whitespace-nowrap text-note text-ink-faint">
                {r.scannedAt ? <When at={r.scannedAt} /> : <Badge tone="warn">{t('resumes.notScanned')}</Badge>}
              </Td>
              <Td>
                <div class="flex justify-end">
                  {r.isDefault ? (
                    <Badge tone="ok">{t('resumes.defaultBadge')}</Badge>
                  ) : (
                    <ActionForm action={`/resumes/${r.id}/default`}>
                      <Button size="sm" variant="secondary">
                        <span class="sm:hidden">{t('resumes.use')}</span>
                        <span class="hidden sm:inline">{t('resumes.setDefault')}</span>
                      </Button>
                    </ActionForm>
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>
    )}

    <Card class="mt-4" id="facts">
      <SectionTitle>{t('resumes.confirmedFacts')}</SectionTitle>
      <Hint class="mb-3">
        {t('resumes.yourAnswersToAComparisons')}
      </Hint>
      {facts.length > 0 && (
        <ul class="mb-3 divide-y divide-line">
          {/* What you know about yourself, read as knowledge: the term leads, the answer is a
              drawn mark plus words, the note sits under it; what you have comes first. */}
          {confirmedFirst(facts).map((f) => (
            <li class="flex flex-col gap-1.5 py-2.5 first:pt-0 sm:flex-row sm:items-center sm:gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-baseline gap-x-2.5">
                  <span class="truncate text-entity text-ink" translate="no">
                    {f.term}
                  </span>
                  <span
                    class={`inline-flex items-center gap-1 text-note ${
                      f.status === 'confirmed' ? 'font-medium text-ok' : 'text-ink-muted'
                    }`}
                  >
                    {f.status !== 'unknown' && <MarkIcon kind={f.status === 'confirmed' ? 'check' : 'x'} class="!h-3 !w-3" />}
                    {f.status === 'confirmed' ? t('resumes.iHaveThis') : f.status === 'unknown' ? t('resumes.notSure') : t('resumes.iDont')}
                  </span>
                </div>
                {f.note && (
                  <div class="mt-0.5 truncate text-meta text-ink-faint" translate="no">
                    {f.note}
                  </div>
                )}
              </div>
              <div class="flex items-center gap-1.5">
                {/* The same POST /facts the comparison uses, with the answer
                    turned around — no second endpoint for the same decision. */}
                <ActionForm
                  action="/facts"
                  hidden={{
                    term: f.term,
                    // Denied and not-sure both turn into a "yes": the answer someone finds later.
                    decision: f.status === 'confirmed' ? 'denied' : 'confirmed',
                    note: f.note ?? '',
                    back: '/resumes',
                  }}
                >
                  <Button size="sm" variant="ghost">
                    {f.status === 'confirmed' ? t('resumes.iDontActually') : t('resumes.iDoHaveIt')}
                  </Button>
                </ActionForm>
                <ConfirmAction
                  action="/facts/delete"
                  hidden={{ term: f.term, back: '/resumes' }}
                  label={t('resumes.forget')}
                  variant="ghost"
                  ariaLabel={t('resumes.forgetTerm', { term: f.term })}
                  confirm={t('resumes.forgetConfirm', { term: f.term })}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Disclosure variant="button" summary={t('resumes.addAFact')}>
        <div class="mt-3">
          <AddFactForm />
        </div>
      </Disclosure>
    </Card>
  </Layout>
);

/** What you have first, then what you do not — each group in the order it was stored. */
function confirmedFirst(facts: FactRow[]): FactRow[] {
  return [...facts.filter((f) => f.status === 'confirmed'), ...facts.filter((f) => f.status !== 'confirmed')];
}

/**
 * Adding a fact by hand (§12 quick win). `POST /facts` already accepted any
 * term — it was only ever reachable from a comparison that happened to ask
 * about one, so a skill no posting had asked about could not be recorded.
 */
const AddFactForm: FC = () => (
  <form method="post" action="/facts" class="flex flex-wrap items-end gap-2">
    <input type="hidden" name="back" value="/resumes" />
    <Field label={t('resumes.skillOrTool')} class="min-w-[10rem] flex-1">
      <Input name="term" maxlength="100" required placeholder="kubernetes" translate="no" />
    </Field>
    <Field label={t('resumes.doYouHaveIt')} class="w-40">
      <Select name="decision">
        <option value="confirmed">{t('resumes.iHaveIt')}</option>
        <option value="denied">{t('resumes.iDont')}</option>
      </Select>
    </Field>
    <Field label={t('resumes.whereWhen')} class="min-w-[12rem] flex-[2]" hint={t('resumes.theMatchPromptQuotesIt')}>
      <Input name="note" maxlength="300" placeholder={t('resumes.notePlaceholder')} />
    </Field>
    {/* The card's one affirmative act, and no AI call (POST /facts) — so primary, not violet. */}
    <Button>{t('resumes.rememberThis')}</Button>
  </form>
);

/**
 * The scanned `skills` list runs to ~85 entries and opens the same way on
 * every resume ("php, go, javascript…"), so the hub reads `primarySkills` —
 * the 2-5 core technologies — and keeps the rest as a count.
 */
const PrimaryStack: FC<{ resume: ResumeRow }> = ({ resume }) => {
  const core = resume.primarySkills.slice(0, PRIMARY_PREVIEW);
  const rest = resume.skills.length - core.length;
  if (core.length === 0) {
    return <span class="text-note text-ink-faint">{resume.scannedAt ? '—' : t('resumes.notScanned')}</span>;
  }
  return (
    <div class="flex flex-wrap items-center gap-1" translate="no">
      {core.map((skill) => (
        <Tag>{skill}</Tag>
      ))}
      {rest > 0 && <span class="text-meta text-ink-faint">+{rest}</span>}
    </div>
  );
};

/** Is this resume actually working? Count plus the best score it has reached. */
const MatchCell: FC<{ matches: ResumeRow['matches'] }> = ({ matches }) =>
  matches === null ? (
    <span class="text-note text-ink-faint">
      <span class="sm:hidden">—</span>
      <span class="hidden sm:inline">{t('resumes.neverCompared')}</span>
    </span>
  ) : (
    <div class="flex items-center gap-2">
      <FitBadge score={matches.best} />
      <span class="hidden text-meta text-ink-faint sm:inline">
        {t('resumes.runs', { n: matches.count })}
      </span>
    </div>
  );

/**
 * The on-demand review, surfaced where the user compares resumes (§B.4). Never
 * a call to action that runs anything: reviewing is a decision made on the
 * resume's own page, so an unreviewed row links there instead.
 */
const StrengthCell: FC<{ resume: ResumeRow }> = ({ resume }) =>
  resume.review === null ? (
    <a
      href={`/resumes/${resume.id}`}
      class="text-note text-ink-faint underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline"
    >
      {t('resumes.notReviewed')}
    </a>
  ) : (
    <div class="flex items-center gap-2">
      <FitBadge score={resume.review.reviewScore} label={t('review.strength')} />
      {resume.review.resumeVersion < resume.version && (
        <span title={t('resumes.reviewBehind', { reviewed: resume.review.resumeVersion, current: resume.version })}>
          <Badge tone="warn">v{resume.review.resumeVersion}</Badge>
        </span>
      )}
    </div>
  );

/** Shared by /resumes and the Settings card. Posts to /resumes and lands on the new resume. */
const ResumeUploadForm: FC = () => (
  <form
    method="post"
    action="/resumes"
    enctype="multipart/form-data"
    onsubmit={SUBMIT_ONCE}
    class="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]"
  >
    <Field label={t('resumes.name')} hint={t('resumes.blankTakenFromTheFile')}>
      <Input type="text" name="name" placeholder={t('resumes.namePlaceholder')} maxlength="100" />
    </Field>
    <Field label={t('resumes.file')} hint={t('upload.fileHint', { types: ACCEPTED_EXTENSIONS.join(', '), mb: MAX_UPLOAD_MB })}>
      <Input
        type="file"
        name="file"
        required
        accept={ACCEPTED_EXTENSIONS.join(',')}
        class={FILE_INPUT_CLASS}
      />
    </Field>
    <div class="flex items-end">
      <Button class="w-full">{t('resumes.uploadScan')}</Button>
    </div>
    <Hint class="sm:col-span-3">
      {t('resumes.oneCallToTheResume')}
    </Hint>
  </form>
);
