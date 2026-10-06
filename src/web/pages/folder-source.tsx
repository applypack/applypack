/** @jsxImportSource hono/jsx */
import type { SourceFile } from '@prisma/client';
import type { FC } from 'hono/jsx';
import { INBOX_ROOTS_ENV } from '../../datasets/folder-path';
import { MAX_DEPTH, MAX_FILES_PER_LOOK } from '../../datasets/folder-scan';
import { MAX_INCLUDE_CHARS, usableMapping, type Mapping, type MappingField } from '../../datasets/map';
import type { PreviewCounts } from '../../datasets/preview';
import { MAX_BODY_MB, type Row, type RowFormat } from '../../datasets/rows';
import type { FolderSummary } from '../../jobs/source-file-store';
import type { NormalizedJob } from '../../types';
import type { FlashMessage } from '../flash';
import { fileLine, folderLine } from '../folder-words';
import { Layout } from '../layout';
import { ActionForm, Badge, Button, Card, Code, Empty, Field, Flash, Hint, Input, More, Notice, PageHeader, SectionTitle, Table, Td, Tr, When } from '../ui';
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
        A folder a tool of yours writes job files into: an export it saves, a synced drive. ApplyPack reads the new{' '}
        .json, .jsonl, .csv and .tsv files in it on each hourly check and never writes, moves or deletes anything
        there.
      </Hint>
      <More class="mb-4 mt-1">
        <p>
          Each file holds rows, one job a row, as on Jobs → Import a file. A file is read once and again only when it
          changes; one still being written waits for the next check. Up to {MAX_FILES_PER_LOOK} files are read a check,
          each up to {MAX_BODY_MB} MB, {MAX_DEPTH} folders deep.
        </p>
        <p>
          The rows go through your searches’ filter and are scored like every job, so a wide folder costs AI calls:
          the check on the next page says how many. Nothing is requested from anywhere.
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
              <Input type="text" name="name" maxlength="80" placeholder="Tool output" />
            </Field>
            <Field label="Only files named (optional)" hint="For a mixed folder: jobs-*.json">
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
                <Button variant="secondary" size="sm" aria-label={`Check the mapping of ${f.name}`}>
                  Mapping
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

const KIND_NAME: Record<RowFormat, string> = { json: '.json', jsonl: '.jsonl', csv: '.csv', tsv: '.tsv' };

export interface FolderPreviewProps {
  /** The folder's real path: what is stored and read. */
  path: string;
  name: string;
  include: string | null;
  /** The source this path already is, when it was added before. */
  existing: { id: number; active: boolean } | null;
  kinds: Partial<Record<RowFormat, number>>;
  /** Files that are not files of rows, or that the name filter leaves out. */
  other: number;
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
  scoring: boolean;
  searches: { running: number; usable: number };
  cost: string;
  flash?: FlashMessage | null;
}

/** Why the folder cannot be added yet, or null. One reason, the first that holds. */
function blocker({ rows, mapping, sample }: FolderPreviewProps): string | null {
  if (rows.length === 0) return 'No file of rows could be read here yet. Put one of the files in the folder and check again: its columns are what gets mapped.';
  if (!usableMapping(mapping)) return 'Choose the column that holds the job title, and one that holds a link or an id, then check again.';
  if (sample.length === 0) return 'With these columns no row is a job. Check the title and the link, then check again.';
  return null;
}

export const FolderPreviewPage: FC<FolderPreviewProps> = (props) => {
  const { path, name, include, existing, kinds, other, newest, plan, rows, columns, mapping, guessed, sample, misfits, counts, scoring, searches, cost, flash } = props;
  const blocked = blocker(props);
  const rowFiles = Object.values(kinds).reduce((sum, n) => sum + (n ?? 0), 0);
  const byKind = (Object.keys(KIND_NAME) as RowFormat[]).filter((k) => (kinds[k] ?? 0) > 0).map((k) => `${kinds[k]} ${KIND_NAME[k]}`);
  const fresh = counts.usable - counts.stored;
  return (
    <Layout title="Check the folder" active="companies">
      <div class="w-full">
        <PageHeader title="Check the folder" back={{ href: '/companies', label: 'Companies' }}>
          <Code>{path}</Code>
          {existing ? ' is one of your sources already; this is its mapping.' : ' is not a source yet. Nothing is stored.'}
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
              <Button disabled={blocked !== null}>{existing ? 'Save the mapping' : 'Add (off)'}</Button>
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
export const FolderFilesPage: FC<{ folder: FolderSourceRow; files: SourceFile[] }> = ({ folder, files }) => {
  const lastLook = folder.summary?.lastLookAt?.getTime() ?? null;
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
