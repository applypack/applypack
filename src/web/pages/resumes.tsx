/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { ActionForm, Badge, Button, Card, Disclosure, Empty, Field, FILE_INPUT_CLASS, FitBadge, Flash, Hint, Input, MarkIcon, PageHeader, SectionTitle, Select, SUBMIT_ONCE, Table, Tag, Td, Tr } from '../ui';
import type { FlashMessage } from '../flash';
import { formatRelative } from '../format';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MAX_UPLOAD_MB } from '../upload';

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
  <Layout title="Resumes" active="resumes">
    <PageHeader title="Resumes" meta={`${resumes.length} uploaded`}>
      The resumes you send. Each is scanned once, then compared against any job from its page.
    </PageHeader>
    <Flash flash={flash} />

    {/* The list is what the page is about: with a resume in it the upload form folds
        behind its button; with none it is the first thing to do, so it stands open. */}
    <Disclosure variant="button" summary="Upload a resume" open={resumes.length === 0} class="mb-4">
      <Card class="mt-3">
        <ResumeUploadForm />
      </Card>
    </Disclosure>

    {resumes.length === 0 ? (
      <Empty>No resumes yet. The first one you upload becomes the default.</Empty>
    ) : (
      <Card flush class="mb-4">
        <Table caption="Resumes"
          columns={[
            'Name',
            'Headline',
            'Core stack',
            'Matches',
            'Strength',
            'Scanned',
            <span class="block text-right">Default</span>,
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
                  >
                    {r.name}
                  </a>
                  {/* Both are repeated by columns of their own; at 375px the
                      row needs every pixel for the name and the action. */}
                  <Badge tone="info" class={HIDE_SM_INLINE}>
                    v{r.version}
                  </Badge>
                  {r.isDefault && <Badge tone="ok" class={HIDE_SM_INLINE}>default</Badge>}
                </div>
                <div class="mt-0.5 hidden truncate font-mono text-xs text-ink-faint sm:block">
                  {r.sourceFilename}
                </div>
              </Td>
              <Td class="max-w-[16rem] text-ink-muted">
                <div class="truncate" title={r.title ?? undefined}>
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
              <Td class="whitespace-nowrap text-[13px] text-ink-faint">
                {r.scannedAt ? formatRelative(r.scannedAt) : <Badge tone="warn">not scanned</Badge>}
              </Td>
              <Td>
                <div class="flex justify-end">
                  {r.isDefault ? (
                    <Badge tone="ok">default</Badge>
                  ) : (
                    <ActionForm action={`/resumes/${r.id}/default`}>
                      <Button size="sm" variant="secondary">
                        <span class="sm:hidden">Use</span>
                        <span class="hidden sm:inline">Set default</span>
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

    <Card class="mt-4">
      <SectionTitle>Confirmed facts</SectionTitle>
      <Hint class="mb-3">
        Your answers to a comparison's "do you have this?" questions. They feed every future
        match; none of this calls the AI.
      </Hint>
      {facts.length > 0 && (
        <ul class="mb-3 divide-y divide-line">
          {/* What you know about yourself, read as knowledge: the term leads, the answer is a
              drawn mark plus words, the note sits under it; what you have comes first. */}
          {confirmedFirst(facts).map((f) => (
            <li class="flex flex-col gap-1.5 py-2.5 first:pt-0 sm:flex-row sm:items-center sm:gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-baseline gap-x-2.5">
                  <span class="truncate text-entity text-ink">{f.term}</span>
                  <span
                    class={`inline-flex items-center gap-1 text-[13px] ${
                      f.status === 'confirmed' ? 'font-medium text-ok' : 'text-ink-muted'
                    }`}
                  >
                    <MarkIcon kind={f.status === 'confirmed' ? 'check' : 'x'} class="!h-3 !w-3" />
                    {f.status === 'confirmed' ? 'I have this' : "I don't"}
                  </span>
                </div>
                {f.note && <div class="mt-0.5 truncate text-meta text-ink-faint">{f.note}</div>}
              </div>
              <div class="flex items-center gap-1.5">
                {/* The same POST /facts the comparison uses, with the answer
                    turned around — no second endpoint for the same decision. */}
                <ActionForm
                  action="/facts"
                  hidden={{
                    term: f.term,
                    decision: f.status === 'confirmed' ? 'denied' : 'confirmed',
                    note: f.note ?? '',
                    back: '/resumes',
                  }}
                >
                  <Button size="sm" variant="ghost">
                    {f.status === 'confirmed' ? "I don't, actually" : 'I do have it'}
                  </Button>
                </ActionForm>
                <ActionForm action="/facts/delete" hidden={{ term: f.term, back: '/resumes' }}>
                  <Button size="sm" variant="ghost">
                    Forget
                  </Button>
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Disclosure variant="button" summary="Add a fact">
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
    <Field label="Skill or tool" class="min-w-[10rem] flex-1">
      <Input name="term" maxlength="100" required placeholder="kubernetes" />
    </Field>
    <Field label="Do you have it?" class="w-40">
      <Select name="decision">
        <option value="confirmed">I have it</option>
        <option value="denied">I don't</option>
      </Select>
    </Field>
    <Field label="Where / when" class="min-w-[12rem] flex-[2]" hint="The match prompt quotes it.">
      <Input name="note" maxlength="300" placeholder="ran the cluster at Vodwork, 2023-2025" />
    </Field>
    <Button variant="violet">Remember this</Button>
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
    return <span class="text-[13px] text-ink-faint">{resume.scannedAt ? '—' : 'not scanned'}</span>;
  }
  return (
    <div class="flex flex-wrap items-center gap-1">
      {core.map((skill) => (
        <Tag>{skill}</Tag>
      ))}
      {rest > 0 && <span class="text-xs text-ink-faint">+{rest}</span>}
    </div>
  );
};

/** Is this resume actually working? Count plus the best score it has reached. */
const MatchCell: FC<{ matches: ResumeRow['matches'] }> = ({ matches }) =>
  matches === null ? (
    <span class="text-[13px] text-ink-faint">
      <span class="sm:hidden">—</span>
      <span class="hidden sm:inline">never compared</span>
    </span>
  ) : (
    <div class="flex items-center gap-2">
      <FitBadge score={matches.best} />
      <span class="hidden text-xs text-ink-faint sm:inline">
        {matches.count === 1 ? '1 run' : `${matches.count} runs`}
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
      class="text-[13px] text-ink-faint underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline"
    >
      not reviewed
    </a>
  ) : (
    <div class="flex items-center gap-2">
      <FitBadge score={resume.review.reviewScore} label="strength" />
      {resume.review.resumeVersion < resume.version && (
        <span title={`the review read v${resume.review.resumeVersion}, the resume is at v${resume.version}`}>
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
    <Field label="Name" hint="Blank = taken from the file name.">
      <Input type="text" name="name" placeholder="Senior Backend" maxlength="100" />
    </Field>
    <Field label="File" hint={`${ACCEPTED_EXTENSIONS.join(', ')} · up to ${MAX_UPLOAD_MB} MB`}>
      <Input
        type="file"
        name="file"
        required
        accept={ACCEPTED_EXTENSIONS.join(',')}
        class={FILE_INPUT_CLASS}
      />
    </Field>
    <div class="flex items-end">
      <Button class="w-full">Upload &amp; scan</Button>
    </div>
    <Hint class="sm:col-span-3">
      One call to the resume model reads headline, skills and issues; you can leave the progress
      page. The file never leaves your Postgres.
    </Hint>
  </form>
);
