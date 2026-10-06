/** @jsxImportSource hono/jsx */
import type { SourceFile } from '@prisma/client';
import type { FC } from 'hono/jsx';
import { INBOX_ROOTS_ENV } from '../../datasets/folder-path';
import { MAX_DEPTH, MAX_FILES_PER_LOOK, maxBytesOf, type FolderHolds, type PostingKind } from '../../datasets/folder-scan';
import { MAX_INCLUDE_CHARS, usableMapping, type FolderAlerts, type Mapping, type MappingField } from '../../datasets/map';
import type { PreviewCounts } from '../../datasets/preview';
import { MAX_BODY_MB, type Row, type RowFormat } from '../../datasets/rows';
import type { FolderSummary } from '../../jobs/source-file-store';
import type { NormalizedJob } from '../../types';
import type { FlashMessage } from '../flash';
import { fileLine, folderLine } from '../folder-words';
import { Layout } from '../layout';
import { ActionForm, Badge, Button, Card, Code, Empty, Field, Flash, Hint, Input, More, Notice, PageHeader, Radio, SectionTitle, Select, Table, Td, Tr, When } from '../ui';
import { MappedRowsList, MappingFields, MappingNote } from './mapping-fields';

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Where a folder may be on this install: what the add form says before anything is typed. */
export interface FolderHost {
  /** `npm start` on the user's own machine. */
  launcher: boolean;
  /** The folders named in APPLYPACK_INBOX_ROOTS. */
  roots: string[];
}

/** Add sources → "A folder on this computer": a path and Check — a browser cannot hand a server a folder. */
export const AddFolderCard: FC<{ host: FolderHost }> = ({ host }) => {
  const closed = !host.launcher && host.roots.length === 0;
  return (
    <Card>
      <Hint>
        A folder you save postings into — “Save page as…”, a PDF, a .docx — or one a tool of yours writes job files
        into. ApplyPack reads what is new in it and never writes, moves or deletes anything there.
      </Hint>
      <More class="mb-4 mt-1">
        <p>
          Saved postings: each file is one posting, a saved page (.html), a PDF, a .docx, text or Markdown. It is
          taken as a posting you pasted: scored whatever your searches’ filter says, kept on Jobs, and a match alerts
          like any other. Reading its title and company is one small AI call when the page does not state them.
          {' '}With npm start a saved file is read within a minute; otherwise at the hourly check.
        </p>
        <p>
          A tool’s files: each holds rows, one job a row, as on Jobs → Import a file — .json, .jsonl, .csv or .tsv.
          The rows go through your searches’ filter and are scored like every job.
        </p>
        <p>
          A file is read once and again only when it changes; one still being written waits. Up to {MAX_FILES_PER_LOOK}{' '}
          files are read a check, {MAX_DEPTH} folders deep. The check on the next page says what it would cost.
          Nothing is requested from anywhere.
        </p>
        <p>
          Do not point it at Downloads or at a folder that holds other things; a folder of its own is best, and the
          name filter is there for a mixed one.
        </p>
      </More>
      {closed ? (
        <Notice tone="warn">
          On a server ApplyPack reads only the folders named in {INBOX_ROOTS_ENV}, and none is named. Whoever runs this
          install sets it in .env and mounts the folder read-only into both services (docker-compose.yml shows where).
        </Notice>
      ) : (
        <>
          <form method="post" action="/companies/folder/check" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]">
            <Field
              label="Folder"
              hint={host.launcher ? 'The full path, inside your home folder: ~/ApplyPack/inbox.' : `The full path, inside ${host.roots.join(' or ')}.`}
            >
              <Input type="text" name="path" required mono placeholder={host.launcher ? '~/ApplyPack/inbox' : (host.roots[0] ?? '/inbox')} autocomplete="off" spellcheck="false" />
            </Field>
            <Field label="Name" hint="Your own words for it. Empty takes the folder’s name.">
              <Input type="text" name="name" maxlength="80" placeholder="Saved postings" />
            </Field>
            <Field label="Only files named (optional)" hint="For a mixed folder: jobs-*.json, *.pdf">
              <Input type="text" name="include" maxlength={String(MAX_INCLUDE_CHARS)} mono placeholder="jobs-*.json" autocomplete="off" spellcheck="false" />
            </Field>
            <div class="flex items-end">
              <Button class="w-full">Check</Button>
            </div>
          </form>
          {host.launcher && (
            <div class="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
              <ActionForm action="/companies/folder/inbox">
                <Button variant="secondary">Create ~/ApplyPack/inbox and check it</Button>
              </ActionForm>
              <Hint>A new, empty folder in your home folder, which needs no permission from the system.</Hint>
            </div>
          )}
        </>
      )}
    </Card>
  );
};

export interface FolderSourceRow {
  id: number;
  name: string;
  path: string;
  active: boolean;
  include: string | null;
  holds: FolderHolds;
  summary: FolderSummary | undefined;
}

/** The folders among the sources: what each holds, its files, and a check on demand. */
export const FolderSourcesSection: FC<{ folders: FolderSourceRow[] }> = ({ folders }) =>
  folders.length === 0 ? null : (
    <Card class="mb-4" id="folders">
      <SectionTitle>Folders on this computer</SectionTitle>
      <div class="flex flex-col gap-2">
        {folders.map((f) => (
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised px-4 py-3">
            <div class="min-w-0">
              <div class="truncate font-medium text-ink">{f.name}</div>
              <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-note text-ink-muted">
                <Code>{f.path}</Code>
                <span>
                  {folderLine(f.summary)}
                  {f.summary?.lastLookAt && (
                    <>
                      {', '}
                      <When at={f.summary.lastLookAt} />
                    </>
                  )}
                </span>
                {!f.active && <Badge tone="neutral">Switched off</Badge>}
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <Button href={`/companies/${f.id}/files`} variant="secondary" size="sm">
                Files
              </Button>
              <form method="post" action="/companies/folder/check" class="flex">
                <input type="hidden" name="path" value={f.path} />
                <input type="hidden" name="name" value={f.name} />
                <input type="hidden" name="include" value={f.include ?? ''} />
                <Button variant="secondary" size="sm" aria-label={`${f.holds === 'rows' ? 'Check the mapping of' : 'Check'} ${f.name}`}>
                  {f.holds === 'rows' ? 'Mapping' : 'Check'}
                </Button>
              </form>
              {f.active && (
                <ActionForm action={`/companies/${f.id}/check-now`} once>
                  <Button variant="secondary" size="sm" aria-label={`Check ${f.name} now`}>
                    Check now
                  </Button>
                </ActionForm>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );

/** What a folder holds: saved postings, one a file, or a tool's rows. Switching it and checking again reads the folder the other way. */
const HoldsField: FC<{ holds: FolderHolds }> = ({ holds }) => (
  <fieldset class="sm:col-span-2">
    <legend class="text-label text-ink">What is in it</legend>
    <Hint class="mt-0.5">Changed it? Press Check again to see the folder read that way.</Hint>
    <div class="mt-1.5 grid gap-2 sm:grid-cols-2">
      <Radio name="holds" value="postings" checked={holds === 'postings'} title="Postings I save">
        One posting a file: a saved page (.html), a PDF, a .docx, text or Markdown.
      </Radio>
      <Radio name="holds" value="rows" checked={holds === 'rows'} title="Files a tool writes">
        Rows of jobs: .json, .jsonl, .csv or .tsv, many jobs a file.
      </Radio>
    </div>
  </fieldset>
);

/** Whether a match from this folder alerts. Off keeps it on Jobs with its score and sends nothing. */
const AlertsField: FC<{ alerts: FolderAlerts }> = ({ alerts }) => (
  <Field label="Alerts" hint="A match is a posting at or above a search’s fit threshold, sent at your alert hours.">
    <Select name="alerts">
      <option value="matches" selected={alerts === 'matches'}>
        A match sends an alert, like every source
      </option>
      <option value="off" selected={alerts === 'off'}>
        No alerts: matches stay on Jobs, and get no application pack
      </option>
    </Select>
  </Field>
);

const KIND_NAME: Record<RowFormat, string> = { json: '.json', jsonl: '.jsonl', csv: '.csv', tsv: '.tsv' };

interface PreviewBase {
  /** The folder's real path: what is stored and read. */
  path: string;
  name: string;
  include: string | null;
  /** The source this path already is, when it was added before. */
  existing: { id: number; active: boolean } | null;
  alerts: FolderAlerts;
  /** Files of the kind this folder does not hold, or that the name filter leaves out. */
  other: number;
  scoring: boolean;
  searches: { running: number; usable: number };
  cost: string;
  flash?: FlashMessage | null;
}

export interface RowsPreviewProps extends PreviewBase {
  holds: 'rows';
  kinds: Partial<Record<RowFormat, number>>;
  /** The newest row files, by name. */
  newest: string[];
  /** What the first check would do with the row files. */
  plan: { read: number; later: number; waiting: number; tooLarge: number; unchanged: number };
  /** Empty when no row file could be read for a sample. */
  rows: Row[];
  columns: string[];
  mapping: Mapping;
  guessed: MappingField[];
  /** The sampled rows as jobs: the three shown, and the proof the mapping reads these files. */
  sample: NormalizedJob[];
  /** Files of the first check whose rows do not fit the mapping. */
  misfits: number;
  counts: PreviewCounts;
}

/** Why the folder cannot be added yet, or null. One reason, the first that holds. */
function blocker({ rows, mapping, sample }: RowsPreviewProps): string | null {
  if (rows.length === 0) return 'No file of rows could be read here yet. Put one of the files in the folder and check again: its columns are what gets mapped.';
  if (!usableMapping(mapping)) return 'Choose the column that holds the job title, and one that holds a link or an id, then check again.';
  if (sample.length === 0) return 'With these columns no row is a job. Check the title and the link, then check again.';
  return null;
}

const RowsPreviewPage: FC<RowsPreviewProps> = (props) => {
  const { path, name, include, existing, alerts, kinds, other, newest, plan, rows, columns, mapping, guessed, sample, misfits, counts, scoring, searches, cost, flash } = props;
  const blocked = blocker(props);
  const rowFiles = Object.values(kinds).reduce((sum, n) => sum + (n ?? 0), 0);
  const byKind = (Object.keys(KIND_NAME) as RowFormat[]).filter((k) => (kinds[k] ?? 0) > 0).map((k) => `${kinds[k]} ${KIND_NAME[k]}`);
  const fresh = counts.usable - counts.stored;
  return (
    <Layout title="Check the folder" active="companies">
      <div class="w-full">
        <PageHeader title="Check the folder" back={{ href: '/companies', label: 'Companies' }}>
          <Code>{path}</Code>
          {existing ? ' is one of your sources already; this is how it is read.' : ' is not a source yet. Nothing is stored.'}
        </PageHeader>
        <Flash flash={flash} />

        <Card>
          <SectionTitle>What is in it</SectionTitle>
          <ul class="space-y-1 text-sm text-ink">
            <li>
              {rowFiles === 0 ? 'No files of rows' : `${count(rowFiles, 'file')} of rows (${byKind.join(', ')})`}
              {include ? `, counting only files named ${include}` : ''}
              {other > 0 ? `; ${count(other, 'other file')} left alone` : ''}.
            </li>
            {newest.length > 0 && <li>The newest: {newest.join(', ')}.</li>}
            {rowFiles > 0 && (
              <li>
                The next check would read {count(plan.read, 'file')}
                {plan.unchanged > 0 ? `; ${plan.unchanged} were read before and have not changed` : ''}
                {plan.later > 0 ? `; ${plan.later} more wait for the checks after it (${MAX_FILES_PER_LOOK} a check)` : ''}
                {plan.waiting > 0 ? `; ${plan.waiting} changed a moment ago and wait` : ''}
                {plan.tooLarge > 0 ? `; ${plan.tooLarge} are over ${MAX_BODY_MB} MB and are never read` : ''}.
              </li>
            )}
          </ul>
        </Card>

        <form method="post" action="/companies/folder" class="contents">
          <input type="hidden" name="path" value={path} />
          <Card class="mt-6">
            <SectionTitle>Name and files</SectionTitle>
            <div class="grid gap-4 sm:grid-cols-2">
              <Field label="Name" hint="How this source is called on Jobs and Companies.">
                <Input type="text" name="name" value={name} required maxlength="80" />
              </Field>
              <Field label="Only files named (optional)" hint="For a mixed folder: jobs-*.json. Empty reads every file of rows.">
                <Input type="text" name="include" value={include ?? ''} maxlength={String(MAX_INCLUDE_CHARS)} mono autocomplete="off" spellcheck="false" />
              </Field>
              <HoldsField holds="rows" />
              <AlertsField alerts={alerts} />
            </div>
          </Card>

          {rows.length > 0 && (
            <Card class="mt-6">
              <SectionTitle>Which column is which</SectionTitle>
              <MappingFields mapping={mapping} guessed={guessed} rows={rows} columns={columns} />
              <div class="mt-4">
                <MappingNote columns={columns} />
              </div>
            </Card>
          )}

          {sample.length > 0 && (
            <Card class="mt-6">
              <SectionTitle>The first rows as they would be stored</SectionTitle>
              <MappedRowsList jobs={sample} />
            </Card>
          )}

          <Card class="mt-6">
            <SectionTitle>What the next check does</SectionTitle>
            {rows.length > 0 && plan.read === 0 && <p class="text-sm text-ink">Nothing: every file here was read before and has not changed.</p>}
            {rows.length > 0 && plan.read > 0 && (
              <ul class="space-y-1 text-sm text-ink">
                <li>
                  {count(counts.usable, 'row')} of the files it reads {counts.usable === 1 ? 'is a job' : 'are jobs'}
                  {counts.stored > 0 ? `; ${counts.stored} already stored` : ''}.
                </li>
                <li>
                  Of the {count(fresh, 'new row')}, {count(counts.passing, 'passes', 'pass')} your running searches’ filter and would be
                  stored; the rest are set aside without any AI
                  {counts.turnedAway > 0 ? `, ${counts.turnedAway} of them at a company you muted or applied to recently` : ''}.
                </li>
                {counts.passing > 0 && (
                  <li>
                    {scoring
                      ? `Each stored row is scored: about ${count(counts.passing, 'AI call')} at that check, and one for every new row after it. ${cost}`
                      : 'Fetching is paused: the hourly check does not run. “Check now” still reads the folder and stores the rows unscored, with no AI spent.'}
                  </li>
                )}
                {misfits > 0 && <li>{count(misfits, 'file does', 'files do')} not fit these columns and would be set aside.</li>}
                {mapping.employer === null && counts.passing > 0 && (
                  <li>No column is read as the company, so where a company is shown these rows will carry the source’s name.</li>
                )}
              </ul>
            )}
            {searches.running === 0 && (
              <Notice tone="warn" class="mt-3">
                No search is running, so a check would store nothing. Switch one on under Settings → Searches.
              </Notice>
            )}
            {scoring && searches.running > 0 && searches.usable === 0 && (
              <Notice tone="warn" class="mt-3">
                Every running search is empty, so nothing would be scored or stored. Give one a required stack or role types on
                Settings → Searches.
              </Notice>
            )}
            {blocked && (
              <Notice tone="warn" class="mt-3">
                {blocked}
              </Notice>
            )}
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <Button disabled={blocked !== null}>{existing ? 'Save' : 'Add (off)'}</Button>
              <Button variant="secondary" formaction="/companies/folder/check">
                Check again
              </Button>
              <Hint>
                {existing
                  ? 'Saving changes how the next files are read; jobs already stored stay as they are.'
                  : 'Added switched off: turn it on in the Companies table, and the hourly check reads what is new.'}
              </Hint>
            </div>
          </Card>
        </form>
      </div>
    </Layout>
  );
};


const POSTING_KIND_NAME: Record<PostingKind, string> = { html: '.html', txt: '.txt', md: '.md', pdf: '.pdf', docx: '.docx' };

/** One of the newest saved files, as code reads it with no model. */
export interface PostingSample {
  relPath: string;
  kind: PostingKind;
  /** The posting's title as the page states it, else the page's own title; null when the file says neither. */
  title: string | null;
  company: string | null;
  address: string | null;
  /** Whether reading it asks a model for its title and company. */
  asksModel: boolean;
  /** Why it would give no job; null when it would. */
  why: string | null;
}

export interface PostingsPreviewProps extends PreviewBase {
  holds: 'postings';
  kinds: Partial<Record<PostingKind, number>>;
  newest: PostingSample[];
  plan: { read: number; later: number; waiting: number; tooLarge: number; unchanged: number };
}

const PostingsPreviewPage: FC<PostingsPreviewProps> = ({ path, name, include, existing, alerts, kinds, other, newest, plan, scoring, searches, cost, flash }) => {
  const files = Object.values(kinds).reduce((sum, n) => sum + (n ?? 0), 0);
  const byKind = (Object.keys(POSTING_KIND_NAME) as PostingKind[]).filter((k) => (kinds[k] ?? 0) > 0).map((k) => `${kinds[k]} ${POSTING_KIND_NAME[k]}`);
  const asking = newest.filter((f) => f.why === null && f.asksModel).length;
  return (
    <Layout title="Check the folder" active="companies">
      <div class="w-full">
        <PageHeader title="Check the folder" back={{ href: '/companies', label: 'Companies' }}>
          <Code>{path}</Code>
          {existing ? ' is one of your sources already; this is how it is read.' : ' is not a source yet. Nothing is stored.'}
        </PageHeader>
        <Flash flash={flash} />

        <Card>
          <SectionTitle>What is in it</SectionTitle>
          <ul class="space-y-1 text-sm text-ink">
            <li>
              {files === 0 ? 'No saved postings yet' : `${count(files, 'saved posting')} (${byKind.join(', ')})`}
              {include ? `, counting only files named ${include}` : ''}
              {other > 0 ? `; ${count(other, 'other file')} left alone` : ''}.
            </li>
            {files > 0 && (
              <li>
                The next check would read {count(plan.read, 'file')}
                {plan.unchanged > 0 ? `; ${plan.unchanged} were read before and have not changed` : ''}
                {plan.later > 0 ? `; ${plan.later} more wait for the checks after it (${MAX_FILES_PER_LOOK} a check)` : ''}
                {plan.waiting > 0 ? `; ${plan.waiting} changed a moment ago and wait` : ''}
                {plan.tooLarge > 0 ? `; ${plan.tooLarge} are too large and are never read` : ''}.
              </li>
            )}
          </ul>
          {files === 0 && (
            <Hint class="mt-2">
              Save a posting into it — “Save page as…” in the browser, or print the page to PDF — and it is read at the next check.
            </Hint>
          )}
        </Card>

        {newest.length > 0 && (
          <Card class="mt-6" flush>
            <div class="px-5 pt-5">
              <SectionTitle>The newest files, as read without AI</SectionTitle>
            </div>
            <Table caption="The newest saved postings" hideBelow={['', '', 'md']} columns={['File', 'Read as', 'Address']}>
              {newest.map((f) => (
                <Tr>
                  <Td class="max-w-[16rem] font-mono text-meta text-ink">
                    <div class="break-all">{f.relPath}</div>
                  </Td>
                  <Td class="text-note">
                    {f.why !== null ? (
                      <span class="text-ink-muted">{f.why}</span>
                    ) : (
                      <>
                        <span class="text-ink">{f.title ?? 'No title on the page'}</span>
                        {f.company && <span class="text-ink-muted"> · {f.company}</span>}
                        {f.asksModel && <span class="block text-ink-faint">The title and company are read by the AI engine.</span>}
                      </>
                    )}
                  </Td>
                  <Td class="max-w-[16rem] text-meta text-ink-muted">
                    <div class="break-all">{f.address ?? '—'}</div>
                  </Td>
                </Tr>
              ))}
            </Table>
          </Card>
        )}

        <form method="post" action="/companies/folder" class="contents">
          <input type="hidden" name="path" value={path} />
          <Card class="mt-6">
            <SectionTitle>Name and files</SectionTitle>
            <div class="grid gap-4 sm:grid-cols-2">
              <Field label="Name" hint="How this source is called on Jobs and Companies, and in an alert.">
                <Input type="text" name="name" value={name} required maxlength="80" />
              </Field>
              <Field label="Only files named (optional)" hint="For a mixed folder: *.pdf. Empty reads every saved posting.">
                <Input type="text" name="include" value={include ?? ''} maxlength={String(MAX_INCLUDE_CHARS)} mono autocomplete="off" spellcheck="false" />
              </Field>
              <HoldsField holds="postings" />
              <AlertsField alerts={alerts} />
            </div>
          </Card>

          <Card class="mt-6">
            <SectionTitle>What the next check does</SectionTitle>
            <ul class="space-y-1 text-sm text-ink">
              <li>
                Each new file becomes one job, taken as a posting you pasted: your searches’ filter does not set it aside, it is
                scored, and it stays on Jobs whatever the score — Saved when no search wants it.
              </li>
              <li>
                {scoring
                  ? `Each is one AI call to score it, and one more to read its title and company when the page does not state them${newest.length > 0 ? ` (${asking} of the ${newest.length} newest would)` : ''}. ${cost}`
                  : 'Fetching is paused: the hourly check does not run. “Check now” stores the files whose page states its title and company, unscored; the others wait until fetching is resumed.'}
              </li>
              <li>
                A file is read once, and again only when it changes; a copy of a file already read is set aside, and a page saved twice
                from the same posting is one job. Up to {maxBytesOf('html') / (1024 * 1024)} MB a page or a text file,{' '}
                {maxBytesOf('pdf') / (1024 * 1024)} MB a PDF or a .docx; what a browser saves beside a page is passed over.
              </li>
              <li>What a saved file holds goes to your AI engine as every posting does; a local engine keeps it on this computer.</li>
            </ul>
            {searches.running === 0 && (
              <Notice tone="warn" class="mt-3">
                No search is running, so a check would store nothing. Switch one on under Settings → Searches.
              </Notice>
            )}
            {scoring && searches.running > 0 && searches.usable === 0 && (
              <Notice tone="warn" class="mt-3">
                Every running search is empty, so nothing would be scored or stored. Give one a required stack or role types on
                Settings → Searches.
              </Notice>
            )}
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <Button>{existing ? 'Save' : 'Add (off)'}</Button>
              <Button variant="secondary" formaction="/companies/folder/check">
                Check again
              </Button>
              <Hint>
                {existing
                  ? 'Saving changes how the next files are read; jobs already stored stay as they are.'
                  : 'Added switched off: turn it on in the Companies table, and what you save is read.'}
              </Hint>
            </div>
          </Card>
        </form>
      </div>
    </Layout>
  );
};

export type FolderPreviewProps = RowsPreviewProps | PostingsPreviewProps;

/** Check: the folder as it would be read, for either kind it may hold. */
export const FolderPreviewPage: FC<FolderPreviewProps> = (props) =>
  props.holds === 'postings' ? <PostingsPreviewPage {...props} /> : <RowsPreviewPage {...props} />;

/** The jobs a file became, linked: one for a saved posting, the first few for a file of rows. */
const FILE_JOBS_SHOWN = 3;
const FileJobs: FC<{ jobs: FileJob[] }> = ({ jobs }) =>
  jobs.length === 0 ? null : (
    <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-note">
      {jobs.slice(0, FILE_JOBS_SHOWN).map((job) => (
        <a href={`/jobs/${job.id}`} class="text-accent hover:underline">
          {job.title}
          {job.fitScore !== null ? ` · fit ${job.fitScore}` : ' · not scored yet'}
        </a>
      ))}
      {jobs.length > FILE_JOBS_SHOWN && <span class="text-ink-faint">and {jobs.length - FILE_JOBS_SHOWN} more</span>}
    </div>
  );

const BYTES = ['B', 'kB', 'MB', 'GB'];

function fileSize(bytes: number): string {
  let n = bytes;
  let unit = 0;
  while (n >= 1000 && unit < BYTES.length - 1) {
    n /= 1000;
    unit++;
  }
  return `${unit === 0 ? n : n.toFixed(1)} ${BYTES[unit]}`;
}

/** One folder's files, each with what became of it — without this list a folder is a black box. */
/** A job a file became, for the link beside it. */
export interface FileJob {
  id: number;
  title: string;
  fitScore: number | null;
  status: string;
  sourceFile: string | null;
}

export const FolderFilesPage: FC<{ folder: FolderSourceRow; files: SourceFile[]; jobs: FileJob[] }> = ({ folder, files, jobs }) => {
  const lastLook = folder.summary?.lastLookAt?.getTime() ?? null;
  const byFile = new Map<string, FileJob[]>();
  for (const job of jobs) if (job.sourceFile) byFile.set(job.sourceFile, [...(byFile.get(job.sourceFile) ?? []), job]);
  return (
    <Layout title={`${folder.name}: files`} active="companies">
      <div class="w-full">
        <PageHeader title={folder.name} back={{ href: '/companies#folders', label: 'Companies' }} meta={folderLine(folder.summary)}>
          <Code>{folder.path}</Code>
          {folder.include ? `, files named ${folder.include}` : ''}. ApplyPack reads these files and never changes them.
        </PageHeader>
        {files.length === 0 ? (
          <Empty title="No files read yet">
            {folder.active
              ? 'The next hourly check lists the folder; Check now on Companies does it at once.'
              : 'This source is switched off. Turn it on in the Companies table, and the hourly check reads the folder.'}
          </Empty>
        ) : (
          <Card flush>
            <Table caption={`Files of ${folder.name}`} hideBelow={['', '', 'md', 'md']} columns={['File', 'What became of it', <span class="block text-right">Size</span>, 'Changed']}>
              {files.map((file) => {
                const line = fileLine(file, lastLook === null || file.seenAt.getTime() === lastLook);
                return (
                  <Tr>
                    <Td class="max-w-[20rem] font-mono text-meta text-ink">
                      <div class="break-all">{file.relPath}</div>
                    </Td>
                    <Td>
                      <div class="flex flex-wrap items-baseline gap-2">
                        <Badge tone={line.tone}>{line.label}</Badge>
                        <span class="text-note text-ink-muted">{line.text}</span>
                      </div>
                      <FileJobs jobs={byFile.get(file.relPath) ?? []} />
                    </Td>
                    <Td class="whitespace-nowrap text-right font-mono text-meta tabular-nums text-ink-muted">{fileSize(file.size)}</Td>
                    <Td class="whitespace-nowrap text-note text-ink-faint">
                      <When at={file.mtime} />
                    </Td>
                  </Tr>
                );
              })}
            </Table>
          </Card>
        )}
      </div>
    </Layout>
  );
};
