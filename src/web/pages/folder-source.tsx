/** @jsxImportSource hono/jsx */
import type { SourceFile } from '@prisma/client';
import type { FC } from 'hono/jsx';
import { INBOX_ROOTS_ENV } from '../../datasets/folder-path';
import { MAX_DEPTH, MAX_FILES_PER_LOOK, MAX_ROW_FILES_PER_LOOK, maxBytesOf, type FolderHolds, type PostingKind } from '../../datasets/folder-scan';
import { MAX_INCLUDE_CHARS, usableMapping, type FolderAlerts, type Mapping, type MappingField } from '../../datasets/map';
import type { PreviewCounts } from '../../datasets/preview';
import { MAX_BODY_MB, type Row, type RowFormat } from '../../datasets/rows';
import type { FolderSummary, JobsOfFile } from '../../jobs/source-file-store';
import { formatList, formatNumber } from '../../i18n/format';
import { t } from '../../i18n/t';
import type { NormalizedJob } from '../../types';
import type { FlashMessage } from '../flash';
import { fileLine, folderLine, folderTrouble, setAsideLine, untitledLine } from '../folder-words';
import { Layout } from '../layout';
import { tRich } from '../rich';
import { ActionForm, Badge, Button, Card, Code, Empty, Field, Flash, Hint, Input, More, Notice, PageHeader, Radio, SectionTitle, Select, Table, Td, Tr, When } from '../ui';
import { MappedRowsList, MappingFields, MappingNote } from './mapping-fields';

/** Where a folder may be on this install: what the add form says before anything is typed. */
export interface FolderHost {
  /** `npm start` on the user's own machine. */
  launcher: boolean;
  /** The folders named in APPLYPACK_INBOX_ROOTS. */
  roots: string[];
}

/** The form Check posts to; a refusal from it brings the typed path back (#546). */
export const FOLDER_CHECK = '/companies/folder/check';

/**
 * Add sources → "A folder on this computer": a path and Check — a browser
 * cannot hand a server a folder. `refused`: the path Check just turned away
 * and why, put back into the form beside the reason.
 */
export const AddFolderCard: FC<{ host: FolderHost; refused?: { path: string; reason: string } }> = ({ host, refused }) => {
  const closed = !host.launcher && host.roots.length === 0;
  return (
    <Card>
      <Hint>{t('folders.add.intro')}</Hint>
      <More class="mb-4 mt-1">
        <p>{t('folders.add.savedPostings')}</p>
        <p>{t('folders.add.toolFiles')}</p>
        <p>{t('folders.add.readOnce', { files: MAX_ROW_FILES_PER_LOOK, postings: MAX_FILES_PER_LOOK, depth: MAX_DEPTH })}</p>
        <p>{t('folders.add.notDownloads')}</p>
      </More>
      {closed ? (
        <Notice tone="warn">{t('folders.add.serverClosed', { env: INBOX_ROOTS_ENV })}</Notice>
      ) : (
        <>
          {refused && (
            <Notice tone="danger" class="mb-3">
              {refused.reason}
            </Notice>
          )}
          <form method="post" action={FOLDER_CHECK} class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]">
            <input type="hidden" name="add" value="1" />
            <Field
              label={t('folders.add.folder')}
              hint={host.launcher ? t('folders.add.pathHintHome') : t('folders.add.pathHintRoots', { roots: formatList(host.roots, 'disjunction') })}
            >
              <Input type="text" name="path" required mono value={refused?.path} placeholder={host.launcher ? '~/ApplyPack/inbox' : (host.roots[0] ?? '/inbox')} translate="no" autocomplete="off" spellcheck="false" />
            </Field>
            <Field label={t('companies.name')} hint={t('folders.add.nameHint')}>
              <Input type="text" name="name" maxlength="80" placeholder={t('folders.add.namePlaceholder')} />
            </Field>
            <Field label={t('folders.include')} hint={t('folders.add.includeHint')}>
              <Input type="text" name="include" maxlength={String(MAX_INCLUDE_CHARS)} mono placeholder="jobs-*.json" translate="no" autocomplete="off" spellcheck="false" />
            </Field>
            <div class="flex items-end">
              <Button class="w-full">{t('folders.check')}</Button>
            </div>
          </form>
          {host.launcher && (
            <div class="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
              <ActionForm action="/companies/folder/inbox">
                <Button variant="secondary">{t('folders.add.createInbox')}</Button>
              </ActionForm>
              <Hint>{t('folders.add.createInboxHint')}</Hint>
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
  /** The source's own health (ADR 0019): what the last check came to, and how many in a row failed. */
  lastFetchStatus: string | null;
  consecutiveFailures: number;
}

/** The status a folder fails with when there is nothing at its path: moved, renamed, or deleted. */
const NOT_FOUND = 'slug_gone';

/** A failing folder says so in its card, as its row in the table does: the ledger's line cannot (#405). */
const FolderTrouble: FC<{ folder: FolderSourceRow }> = ({ folder }) => {
  const trouble = folderTrouble(folder.lastFetchStatus, folder.consecutiveFailures);
  if (!trouble) return null;
  return (
    <>
      <span title={trouble.title}>
        <Badge tone={trouble.tone}>{trouble.label}</Badge>
        {folder.consecutiveFailures > 0 && <span class="sr-only">{t('sources.health.streakAfterLabel', { n: folder.consecutiveFailures })}</span>}
      </span>
      {/* Moved or renamed: the way out keeps the source, its jobs and its files (#478); Delete was the only one. */}
      {folder.lastFetchStatus === NOT_FOUND && (
        <a href={`/companies/${folder.id}/files#moved`} class="text-accent hover:underline">
          {t('folders.moved.link')}
        </a>
      )}
    </>
  );
};

/** The folders among the sources: what each holds, its files, and a check on demand. */
export const FolderSourcesSection: FC<{ folders: FolderSourceRow[] }> = ({ folders }) =>
  folders.length === 0 ? null : (
    <Card class="mb-4" id="folders">
      <SectionTitle>{t('folders.section.title')}</SectionTitle>
      <div class="flex flex-col gap-2">
        {folders.map((f) => (
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised px-4 py-3">
            <div class="min-w-0">
              <div class="truncate font-medium text-ink" translate="no">{f.name}</div>
              <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-note text-ink-muted">
                <Code>{f.path}</Code>
                <span>
                  {folderLine(f.summary)}
                  {setAsideLine(f.summary) && (
                    <>
                      {' · '}
                      <a href={`/companies/${f.id}/files`} class="text-accent hover:underline">
                        {setAsideLine(f.summary)}
                      </a>
                    </>
                  )}
                  {f.summary?.lastLookAt && (
                    <>
                      {', '}
                      <When at={f.summary.lastLookAt} />
                    </>
                  )}
                </span>
                <FolderTrouble folder={f} />
                {!f.active && <Badge tone="neutral">{t('folders.switchedOff')}</Badge>}
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              {/* Added switched off: the switch is here, not only on its row among every other source (#405). */}
              {!f.active && (
                <ActionForm action={`/companies/${f.id}/toggle-active`}>
                  <Button size="sm" aria-label={t('companies.enableNamed', { name: f.name })}>
                    {t('ui.enable')}
                  </Button>
                </ActionForm>
              )}
              <Button href={`/companies/${f.id}/files`} variant="secondary" size="sm">
                {t('companies.files')}
              </Button>
              <form method="post" action="/companies/folder/check" class="flex">
                <input type="hidden" name="path" value={f.path} />
                <input type="hidden" name="name" value={f.name} />
                <input type="hidden" name="include" value={f.include ?? ''} />
                <Button variant="secondary" size="sm" aria-label={t(f.holds === 'rows' ? 'folders.checkMappingOf' : 'folders.checkNamed', { name: f.name })}>
                  {t(f.holds === 'rows' ? 'folders.mapping' : 'folders.check')}
                </Button>
              </form>
              {f.active && (
                <ActionForm action={`/companies/${f.id}/check-now`} once>
                  <Button variant="secondary" size="sm" aria-label={t('folders.checkNamedNow', { name: f.name })}>
                    {t('watchlist.checkNow')}
                  </Button>
                </ActionForm>
              )}
              {/* Switched on here, switched off here (#546): the table's switch is among every other source. */}
              {f.active && (
                <ActionForm action={`/companies/${f.id}/toggle-active`}>
                  <Button variant="ghost" size="sm" aria-label={t('companies.disableNamed', { name: f.name })}>
                    {t('ui.disable')}
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
    <legend class="text-label text-ink">{t('folders.whatIsInIt')}</legend>
    <Hint class="mt-0.5">{t('folders.holds.hint')}</Hint>
    <div class="mt-1.5 grid gap-2 sm:grid-cols-2">
      <Radio name="holds" value="postings" checked={holds === 'postings'} title={t('folders.holds.postings')}>
        {t('folders.holds.postingsBody')}
      </Radio>
      <Radio name="holds" value="rows" checked={holds === 'rows'} title={t('folders.holds.rows')}>
        {t('folders.holds.rowsBody')}
      </Radio>
    </div>
  </fieldset>
);

/** Whether a match from this folder alerts. Off keeps it on Jobs with its score and sends nothing. */
const AlertsField: FC<{ alerts: FolderAlerts }> = ({ alerts }) => (
  <Field label={t('folders.alerts')} hint={t('folders.alerts.hint')}>
    <Select name="alerts">
      <option value="matches" selected={alerts === 'matches'}>
        {t('folders.alerts.matches')}
      </option>
      <option value="off" selected={alerts === 'off'}>
        {t('folders.alerts.off')}
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
  /** What the first check could not read of a file, or had to assume about it (datasets/read-notes.ts). */
  fileNotes: { file: string; note: string }[];
  counts: PreviewCounts;
}

/** Why the folder cannot be added yet, or null. One reason, the first that holds. */
function blocker({ rows, mapping, sample }: RowsPreviewProps): string | null {
  if (rows.length === 0) return t('folders.block.noRows');
  if (!usableMapping(mapping)) return t('folders.block.mapping');
  if (sample.length === 0) return t('folders.block.noJob');
  return null;
}

const RowsPreviewPage: FC<RowsPreviewProps> = (props) => {
  const { path, name, include, existing, alerts, kinds, other, newest, plan, rows, columns, mapping, guessed, sample, misfits, fileNotes, counts, scoring, searches, cost, flash } = props;
  const blocked = blocker(props);
  const rowFiles = Object.values(kinds).reduce((sum, n) => sum + (n ?? 0), 0);
  const byKind = (Object.keys(KIND_NAME) as RowFormat[]).filter((k) => (kinds[k] ?? 0) > 0).map((k) => `${kinds[k]} ${KIND_NAME[k]}`);
  const fresh = counts.usable - counts.stored;
  return (
    <Layout title={t('folders.checkTitle')} active="companies">
      <div class="w-full">
        <PageHeader title={t('folders.checkTitle')} back={{ href: '/companies', label: t('nav.companies') }}>
          {tRich(existing ? 'folders.preview.existing' : 'folders.preview.new', {}, { path: () => <Code>{path}</Code> })}
        </PageHeader>
        <Flash flash={flash} />

        <Card>
          <SectionTitle>{t('folders.whatIsInIt')}</SectionTitle>
          <ul class="space-y-1 text-sm text-ink">
            <li>{t('folders.rows.contents', { files: rowFiles, kinds: byKind.join(', '), filtered: include ? 'yes' : 'no', include: include ?? '', other })}</li>
            {newest.length > 0 && <li>{t('folders.newest', { files: newest.join(', ') })}</li>}
            {rowFiles > 0 && <li>{t('folders.rows.plan', { ...plan, perCheck: MAX_ROW_FILES_PER_LOOK, mb: MAX_BODY_MB })}</li>}
          </ul>
          {fileNotes.map(({ file, note }) => (
            <Notice tone="warn" class="mt-3">
              <span class="font-mono" translate="no">
                {file}
              </span>{' '}
              {note}
            </Notice>
          ))}
        </Card>

        <form method="post" action="/companies/folder" class="contents">
          <input type="hidden" name="path" value={path} />
          <Card class="mt-6">
            <SectionTitle>{t('folders.nameAndFiles')}</SectionTitle>
            <div class="grid gap-4 sm:grid-cols-2">
              <Field label={t('companies.name')} hint={t('folders.rows.nameHint')}>
                <Input type="text" name="name" value={name} required maxlength="80" />
              </Field>
              <Field label={t('folders.include')} hint={t('folders.rows.includeHint')}>
                <Input type="text" name="include" value={include ?? ''} maxlength={String(MAX_INCLUDE_CHARS)} mono autocomplete="off" spellcheck="false" />
              </Field>
              <HoldsField holds="rows" />
              <AlertsField alerts={alerts} />
            </div>
          </Card>

          {rows.length > 0 && (
            <Card class="mt-6">
              <SectionTitle>{t('import.whichColumn')}</SectionTitle>
              <MappingFields mapping={mapping} guessed={guessed} rows={rows} columns={columns} />
              <div class="mt-4">
                <MappingNote columns={columns} />
              </div>
            </Card>
          )}

          {sample.length > 0 && (
            <Card class="mt-6">
              <SectionTitle>{t('import.firstRows')}</SectionTitle>
              <MappedRowsList jobs={sample} />
            </Card>
          )}

          <Card class="mt-6">
            <SectionTitle>{t('folders.nextCheck')}</SectionTitle>
            {rows.length > 0 && plan.read === 0 && <p class="text-sm text-ink">{t('folders.rows.nothing')}</p>}
            {rows.length > 0 && plan.read > 0 && (
              <ul class="space-y-1 text-sm text-ink">
                <li>{t('folders.rows.usable', { usable: counts.usable, stored: counts.stored })}</li>
                <li>{t('import.preview.passing', { fresh, passing: counts.passing, turnedAway: counts.turnedAway })}</li>
                {counts.passing > 0 && <li>{scoring ? `${t('folders.rows.cost', { n: counts.passing })} ${cost}` : t('folders.rows.paused')}</li>}
                {misfits > 0 && <li>{t('folders.rows.misfits', { n: misfits })}</li>}
                {mapping.employer === null && counts.passing > 0 && <li>{t('import.noCompanyColumn')}</li>}
              </ul>
            )}
            {searches.running === 0 && (
              <Notice tone="warn" class="mt-3">
                {t('folders.noSearch')}
              </Notice>
            )}
            {scoring && searches.running > 0 && searches.usable === 0 && (
              <Notice tone="warn" class="mt-3">
                {t('import.allSearchesBlank')}
              </Notice>
            )}
            {blocked && (
              <Notice tone="warn" class="mt-3">
                {blocked}
              </Notice>
            )}
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <Button disabled={blocked !== null}>{t(existing ? 'common.save' : 'companies.addOff')}</Button>
              <Button variant="secondary" formaction="/companies/folder/check">
                {t('folders.checkAgain')}
              </Button>
              <Hint>
                {t(existing ? 'folders.savingHint' : 'folders.rows.addedOff')}
              </Hint>
            </div>
          </Card>
        </form>
      </div>
    </Layout>
  );
};


const POSTING_KIND_NAME: Record<PostingKind, string> = { html: '.html', txt: '.txt', md: '.md', pdf: '.pdf', docx: '.docx', mhtml: '.mhtml', webarchive: '.webarchive' };

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
    <Layout title={t('folders.checkTitle')} active="companies">
      <div class="w-full">
        <PageHeader title={t('folders.checkTitle')} back={{ href: '/companies', label: t('nav.companies') }}>
          {tRich(existing ? 'folders.preview.existing' : 'folders.preview.new', {}, { path: () => <Code>{path}</Code> })}
        </PageHeader>
        <Flash flash={flash} />

        <Card>
          <SectionTitle>{t('folders.whatIsInIt')}</SectionTitle>
          <ul class="space-y-1 text-sm text-ink">
            <li>{t('folders.postings.contents', { files, kinds: byKind.join(', '), filtered: include ? 'yes' : 'no', include: include ?? '', other })}</li>
            {files > 0 && <li>{t('folders.postings.plan', { ...plan, perCheck: MAX_FILES_PER_LOOK })}</li>}
          </ul>
          {files === 0 && <Hint class="mt-2">{t('folders.postings.saveHint')}</Hint>}
        </Card>

        {newest.length > 0 && (
          <Card class="mt-6" flush>
            <div class="px-5 pt-5">
              <SectionTitle>{t('folders.postings.newestTitle')}</SectionTitle>
            </div>
            <Table
              caption={t('folders.postings.caption')}
              hideBelow={['', '', 'md']}
              columns={[t('folders.col.file'), t('folders.col.readAs'), t('folders.col.address')]}
            >
              {newest.map((f) => (
                <Tr>
                  <Td class="max-w-[16rem] font-mono text-meta text-ink">
                    <div class="[overflow-wrap:anywhere]">{f.relPath}</div>
                  </Td>
                  <Td class="text-note">
                    {f.why !== null ? (
                      <span class="text-ink-muted">{f.why}</span>
                    ) : (
                      <>
                        <span class="text-ink">{f.title ?? untitledLine(f.relPath)}</span>
                        {f.company && <span class="text-ink-muted"> · {f.company}</span>}
                        {f.asksModel && <span class="block text-ink-faint">{t('folders.postings.asksModel')}</span>}
                      </>
                    )}
                  </Td>
                  <Td class="max-w-[16rem] text-meta text-ink-muted">
                    <div class="[overflow-wrap:anywhere]">{f.address ?? '—'}</div>
                  </Td>
                </Tr>
              ))}
            </Table>
          </Card>
        )}

        <form method="post" action="/companies/folder" class="contents">
          <input type="hidden" name="path" value={path} />
          <Card class="mt-6">
            <SectionTitle>{t('folders.nameAndFiles')}</SectionTitle>
            <div class="grid gap-4 sm:grid-cols-2">
              <Field label={t('companies.name')} hint={t('folders.postings.nameHint')}>
                <Input type="text" name="name" value={name} required maxlength="80" />
              </Field>
              <Field label={t('folders.include')} hint={t('folders.postings.includeHint')}>
                <Input type="text" name="include" value={include ?? ''} maxlength={String(MAX_INCLUDE_CHARS)} mono autocomplete="off" spellcheck="false" />
              </Field>
              <HoldsField holds="postings" />
              <AlertsField alerts={alerts} />
            </div>
          </Card>

          <Card class="mt-6">
            <SectionTitle>{t('folders.nextCheck')}</SectionTitle>
            <ul class="space-y-1 text-sm text-ink">
              <li>{t('folders.postings.oneJob')}</li>
              <li>{scoring ? `${t('folders.postings.cost', { newest: newest.length, asking })} ${cost}` : t('folders.postings.paused')}</li>
              <li>{t('folders.postings.readOnce', { textMb: maxBytesOf('html') / (1024 * 1024), docMb: maxBytesOf('pdf') / (1024 * 1024) })}</li>
              <li>{t('folders.postings.privacy')}</li>
            </ul>
            {searches.running === 0 && (
              <Notice tone="warn" class="mt-3">
                {t('folders.noSearch')}
              </Notice>
            )}
            {scoring && searches.running > 0 && searches.usable === 0 && (
              <Notice tone="warn" class="mt-3">
                {t('import.allSearchesBlank')}
              </Notice>
            )}
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <Button>{t(existing ? 'common.save' : 'companies.addOff')}</Button>
              <Button variant="secondary" formaction="/companies/folder/check">
                {t('folders.checkAgain')}
              </Button>
              <Hint>
                {t(existing ? 'folders.savingHint' : 'folders.postings.addedOff')}
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
const FileJobs: FC<{ jobs: JobsOfFile | undefined }> = ({ jobs }) =>
  !jobs ? null : (
    <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-note">
      {jobs.shown.map((job) => (
        <a href={`/jobs/${job.id}`} class="text-accent hover:underline">
          {job.title}
          {` · ${job.fitScore !== null ? t('folders.files.fit', { score: job.fitScore }) : t('folders.files.notScored')}`}
        </a>
      ))}
      {jobs.total > jobs.shown.length && <span class="text-ink-faint">{t('folders.files.more', { n: jobs.total - jobs.shown.length })}</span>}
    </div>
  );

/** The units a size is written in, as the size message's branches name them. */
const BYTES = ['b', 'kb', 'mb', 'gb'];

function fileSize(bytes: number): string {
  let n = bytes;
  let unit = 0;
  while (n >= 1000 && unit < BYTES.length - 1) {
    n /= 1000;
    unit++;
  }
  const shown = unit === 0 ? formatNumber(n) : formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return t('folders.size', { n: shown, unit: BYTES[unit]! });
}

/** One folder's files, each with what became of it — without this list a folder is a black box. */
export const FolderFilesPage: FC<{
  folder: FolderSourceRow;
  files: SourceFile[];
  jobs: Map<string, JobsOfFile>;
  flash?: FlashMessage | null;
}> = ({ folder, files, jobs, flash }) => {
  // A folder not found at its path opens on the way to point it at the new one.
  const lost = folder.lastFetchStatus === NOT_FOUND;
  return (
    <Layout title={t('folders.files.title', { name: folder.name })} active="companies">
      <div class="w-full">
        <PageHeader
          title={folder.name}
          titleIsData
          back={{ href: '/companies#folders', label: t('nav.companies') }}
          meta={[folderLine(folder.summary), setAsideLine(folder.summary)].filter((part) => part !== null).join(' · ')}
          // #546: "Read every file again" waits for the next check, and with fetching paused there is none.
          actions={
            folder.active && (
              <ActionForm action={`/companies/${folder.id}/check-now`} hidden={{ back: `/companies/${folder.id}/files` }} once>
                <Button variant="secondary">{t('watchlist.checkNow')}</Button>
              </ActionForm>
            )
          }
        >
          {tRich(
            'folders.files.header',
            { filtered: folder.include ? 'yes' : 'no', include: folder.include ?? '' },
            { path: () => <Code>{folder.path}</Code> },
          )}
        </PageHeader>
        <Flash flash={flash} />
        {lost && <MovedFolderCard folder={folder} class="mb-6" />}
        {files.length === 0 ? (
          <Empty title={t('folders.files.empty')}>{t(folder.active ? 'folders.files.emptyActive' : 'folders.files.emptyOff')}</Empty>
        ) : (
          <Card flush>
            <Table
              caption={t('folders.files.caption', { name: folder.name })}
              hideBelow={['', '', 'md', 'md']}
              columns={[t('folders.col.file'), t('folders.col.became'), <span class="block text-right">{t('folders.col.size')}</span>, t('folders.col.changed')]}
            >
              {files.map((file) => {
                const line = fileLine(file, file.goneAt === null);
                return (
                  <Tr>
                    <Td class="max-w-[20rem] font-mono text-meta text-ink">
                      <div class="[overflow-wrap:anywhere]">{file.relPath}</div>
                    </Td>
                    <Td>
                      <div class="flex flex-wrap items-baseline gap-2">
                        <Badge tone={line.tone}>{line.label}</Badge>
                        <span class="text-note text-ink-muted">{line.text}</span>
                      </div>
                      <FileJobs jobs={jobs.get(file.relPath)} />
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
        {/* A saved posting is never turned away by a search, so only a folder of rows has anything to read again. */}
        {folder.holds === 'rows' && files.length > 0 && (
          <Card class="mt-6">
            <ActionForm action={`/companies/${folder.id}/files/reread`} once>
              <Button variant="secondary">{t('folders.files.reread')}</Button>
            </ActionForm>
            <Hint class="mt-3">{t('folders.files.rereadHint')}</Hint>
          </Card>
        )}
        {!lost && <MovedFolderCard folder={folder} class="mt-6" />}
      </div>
    </Layout>
  );
};

/** "The folder moved" (#478): a new path for this source, checked as Add checks one; its jobs and its ledger stay. */
const MovedFolderCard: FC<{ folder: FolderSourceRow; class: string }> = ({ folder, class: className }) => (
  <Card class={className} id="moved">
    <SectionTitle>{t('folders.moved.title')}</SectionTitle>
    <Hint>{t('folders.moved.hint')}</Hint>
    <form method="post" action={`/companies/${folder.id}/folder/move`} class="mt-3 flex flex-wrap items-end gap-3">
      <Field label={t('folders.moved.path')} class="min-w-0 flex-1">
        <Input type="text" name="path" required mono value={folder.path} translate="no" autocomplete="off" spellcheck="false" />
      </Field>
      <Button>{t('folders.moved.submit')}</Button>
    </form>
  </Card>
);
