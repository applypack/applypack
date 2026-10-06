/** @jsxImportSource hono/jsx */
import os from 'node:os';
import path from 'node:path';
import { AtsType, type Prisma } from '@prisma/client';
import { Hono } from 'hono';
import { config } from '../../config';
import { FolderError, currentFolderRules, listFolder, readFolderFile, realFolder } from '../../datasets/folder-io';
import { folderAllowed, folderPathFrom } from '../../datasets/folder-path';
import { MAX_ROWS_PER_LOOK, includeMatcher, judgeFile, planScan, rowFileKind, type ListedFile } from '../../datasets/folder-scan';
import {
  MAPPING_FIELDS,
  MAX_INCLUDE_CHARS,
  MappingSchema,
  columnsOf,
  detectMapping,
  mapRows,
  readSourceConfig,
  usableMapping,
  type Mapping,
  type MappingField,
  type SourceConfig,
} from '../../datasets/map';
import { previewCounts } from '../../datasets/preview';
import { decodeBody, findRows, type Row, type RowFormat } from '../../datasets/rows';
import { prisma } from '../../db';
import { employerGate, hiringKey } from '../../employer';
import { loadEmployerRules } from '../../jobs/employer-store';
import { folderSummaries, listSourceFiles, loadLedger } from '../../jobs/source-file-store';
import { underLauncher } from '../../local/child';
import { logger } from '../../logger';
import { isBlankProfile } from '../../profile-guards';
import { listActiveProfiles } from '../../profiles';
import { getSettings } from '../../settings';
import type { NormalizedJob } from '../../types';
import { spendHint } from '../cost-hint';
import { flashRedirect } from '../flash';
import { explainFolderFault } from '../folder-words';
import { createInbox } from '../inbox-folder';
import { FolderFilesPage, FolderPreviewPage, type FolderPreviewProps } from '../pages/folder-source';
import { idParam } from '../params';

/*
 * A folder a tool writes job files into, as a source (ADR 0062): Check reads
 * the folder and shows what a first look would do, spending no AI; Add stores
 * the path, the name filter and the column mapping on an inactive FOLDER row.
 * The tick does the rest (fetchers/folder.ts). Every request here re-reads
 * the folder — it is on this machine's disk, so nothing has to be kept
 * between the two steps — and re-checks the path rules (folder-path.ts).
 */

const MAX_NAME_CHARS = 80;
/** How many of the newest files the mapping is detected from, and how many rows of them. */
const SAMPLE_FILES = 3;
const SAMPLE_ROWS = 200;
const NEWEST_SHOWN = 5;
const BACK = '/companies';

export const foldersRoute = new Hono();

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The folder a form names, as its real path — or the sentence that says why it cannot be a source. */
async function resolveFolder(typed: string): Promise<{ root: string } | { error: string }> {
  const asked = folderPathFrom(typed, os.homedir());
  if (asked === null) return { error: 'Type the folder’s full path, starting from the root of the disk or from ~ for your home folder.' };
  try {
    const root = await realFolder(asked);
    const allowed = folderAllowed(root, await currentFolderRules(underLauncher(), config.APPLYPACK_INBOX_ROOTS));
    return allowed.ok ? { root } : { error: allowed.reason };
  } catch (err) {
    if (err instanceof FolderError) return { error: explainFolderFault(err.fault, err.message, process.platform, !underLauncher()) };
    throw err;
  }
}

/** The rows of the newest files a mapping can be detected from; a file that cannot be read gives none. */
async function sampleRows(root: string, files: readonly ListedFile[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const file of [...files].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, SAMPLE_FILES)) {
    const got = await readFolderFile(root, file.relPath);
    const found = got.ok ? findRows(decodeBody(got.bytes)) : null;
    if (found?.ok) rows.push(...found.rows.slice(0, SAMPLE_ROWS - rows.length));
  }
  return rows;
}

/** The form's selects as a mapping, when every one names a column the sample has; null otherwise. */
function postedMapping(form: Record<string, unknown>, columns: readonly string[]): Mapping | null {
  if (!MAPPING_FIELDS.some((f) => typeof form[f] === 'string')) return null;
  const parsed = MappingSchema.safeParse(form);
  if (!parsed.success) return null;
  return MAPPING_FIELDS.every((f) => parsed.data[f] === null || columns.includes(parsed.data[f])) ? parsed.data : null;
}

type Preview = Omit<FolderPreviewProps, 'flash'>;

/** What Check shows: the folder as it is now, the mapping, and what a first look would hand to the pipeline. */
async function previewFolder(root: string, form: Record<string, unknown>): Promise<Preview | { error: string }> {
  let listing: ListedFile[];
  try {
    listing = await listFolder(root);
  } catch (err) {
    if (err instanceof FolderError) return { error: explainFolderFault(err.fault, err.message, process.platform, !underLauncher()) };
    throw err;
  }
  const existing = await prisma.company.findUnique({
    where: { atsType_atsToken: { atsType: AtsType.FOLDER, atsToken: root } },
    select: { id: true, name: true, active: true, sourceConfig: true },
  });
  const kept = existing ? readSourceConfig(existing.sourceConfig) : null;
  // The form's own words win; a folder checked again from its row brings what the row holds.
  const include = (typeof form.include === 'string' ? text(form.include) : (kept?.include ?? '')).slice(0, MAX_INCLUDE_CHARS) || null;
  const name = (text(form.name) || existing?.name || path.basename(root)).slice(0, MAX_NAME_CHARS);

  const matches = includeMatcher(include);
  const rowFiles = listing.filter((f) => rowFileKind(f.relPath) !== null && matches(f.relPath));
  const kinds: Partial<Record<RowFormat, number>> = {};
  for (const file of rowFiles) {
    const kind = rowFileKind(file.relPath)!;
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  const now = new Date();
  const ledger = existing ? await loadLedger(existing.id) : [];
  const plan = planScan(listing, ledger, now.getTime(), matches);

  const rows = await sampleRows(root, plan.read.length > 0 ? plan.read : rowFiles);
  // A folder's files need not all carry every column: the ones its mapping already names stay on offer,
  // so checking it again against three other files cannot lose them. They were offered once, so none is about a person.
  const columns = [...new Set([...columnsOf(rows), ...(kept ? MAPPING_FIELDS.flatMap((f) => kept.mapping[f] ?? []) : [])])];
  const posted = postedMapping(form, columns);
  const detected = posted ? { mapping: posted, guessed: [] as MappingField[] } : kept ? { mapping: kept.mapping, guessed: [] as MappingField[] } : detectMapping(rows, now);

  // The first look, as the fetcher would take it (fetchers/folder.ts), with nothing staged and nothing stored.
  const readAs = new Map(ledger.filter((e) => e.status === 'done' && e.sha256 !== null).map((e) => [e.sha256!, e.relPath]));
  const jobs: NormalizedJob[] = [];
  let misfits = 0;
  if (usableMapping(detected.mapping)) {
    for (const file of plan.read) {
      if (jobs.length >= MAX_ROWS_PER_LOOK) break;
      const verdict = judgeFile(file, await readFolderFile(root, file.relPath), detected.mapping, existing?.id ?? 0, readAs);
      if (verdict.rows === 'misfit') misfits++;
      if (verdict.rows === 'fit') {
        readAs.set(verdict.change!.sha256!, file.relPath);
        jobs.push(...verdict.jobs);
      }
    }
  }

  const [settings, active, employers, stored] = await Promise.all([
    getSettings(),
    listActiveProfiles(),
    loadEmployerRules(now),
    existing && jobs.length > 0
      ? prisma.job.findMany({ where: { companyId: existing.id, externalId: { in: [...new Set(jobs.map((j) => j.externalId))] } }, select: { externalId: true } })
      : [],
  ]);
  const scoring = settings.fetchingEnabled;
  const roster = scoring ? active.filter((p) => !isBlankProfile(p)) : active;
  const unique = [...new Map(jobs.map((j) => [j.externalId, j])).values()];
  const counts = previewCounts(unique, roster, new Set(stored.map((s) => s.externalId)), (job) => employerGate(hiringKey(job.employer, name, true), employers) !== null);
  return {
    path: root,
    name,
    include,
    existing: existing ? { id: existing.id, active: existing.active } : null,
    kinds,
    other: plan.other,
    newest: [...rowFiles].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, NEWEST_SHOWN).map((f) => f.relPath),
    plan: { read: plan.read.length, later: plan.later.length, waiting: plan.waiting.length, tooLarge: plan.tooLarge.length, unchanged: plan.unchanged },
    rows,
    columns,
    ...detected,
    // The sample as jobs: what the page shows, and what says the mapping reads these files at all.
    sample: mapRows(rows, detected.mapping, 0, now).jobs,
    misfits,
    counts,
    scoring,
    searches: { running: active.length, usable: roster.length },
    cost: scoring && counts.passing > 0 ? await spendHint('classifier') : '',
  };
}

/** Check: the folder read, nothing stored, no AI spent. Rendered straight from the POST — there is nothing to keep. */
foldersRoute.post('/companies/folder/check', async (c) => {
  const form = await c.req.parseBody();
  const folder = await resolveFolder(text(form.path));
  if ('error' in folder) return flashRedirect(BACK, 'err', `Nothing was added. ${folder.error}`);
  const preview = await previewFolder(folder.root, form);
  if ('error' in preview) return flashRedirect(BACK, 'err', `Nothing was added. ${preview.error}`);
  return c.html(<FolderPreviewPage {...preview} />);
});

/** A local install only: an empty folder of ApplyPack's own in the home directory, then its check. */
foldersRoute.post('/companies/folder/inbox', async (c) => {
  if (!underLauncher()) {
    return flashRedirect(BACK, 'err', 'Nothing was created: on a server the folder is one you mount and name in APPLYPACK_INBOX_ROOTS.');
  }
  let inbox: string;
  try {
    inbox = await createInbox(os.homedir());
  } catch (err) {
    // A file where the folder would go, a home the system will not write in: said, never a 500.
    const code = (err as { code?: unknown } | null)?.code;
    if (typeof code !== 'string') throw err;
    logger.warn({ code }, 'web: inbox folder not created');
    return flashRedirect(BACK, 'err', `Nothing was created: the system refused to make ~/ApplyPack/inbox (${code}). Make the folder yourself and type its path below.`);
  }
  const folder = await resolveFolder(inbox);
  if ('error' in folder) return flashRedirect(BACK, 'err', `The folder ${inbox} is there, but it cannot be a source. ${folder.error}`);
  const preview = await previewFolder(folder.root, { name: 'Inbox' });
  if ('error' in preview) return flashRedirect(BACK, 'err', preview.error);
  return c.html(<FolderPreviewPage {...preview} />);
});

/** Add (off), or save the mapping of a folder that is a source already. */
foldersRoute.post('/companies/folder', async (c) => {
  const form = await c.req.parseBody();
  const folder = await resolveFolder(text(form.path));
  if ('error' in folder) return flashRedirect(BACK, 'err', `Nothing was added. ${folder.error}`);
  const preview = await previewFolder(folder.root, form);
  if ('error' in preview) return flashRedirect(BACK, 'err', `Nothing was added. ${preview.error}`);
  // The mapping must be the form's own: one this request's sample accepted, column by column.
  const mapping = postedMapping(form, preview.columns);
  if (!mapping || !usableMapping(mapping) || mapRows(preview.rows, mapping, 0, new Date()).jobs.length === 0) {
    return c.html(
      <FolderPreviewPage
        {...preview}
        flash={{ kind: 'err', text: 'Nothing was saved. Choose the column that holds the job title, and one that holds a link or an id; the files in the folder must give at least one job.' }}
      />,
    );
  }
  const config: SourceConfig = { mapping, include: preview.include };
  const sourceConfig = config as Prisma.InputJsonValue;
  const saved = await prisma.company.upsert({
    where: { atsType_atsToken: { atsType: AtsType.FOLDER, atsToken: folder.root } },
    update: { name: preview.name, sourceConfig },
    create: { name: preview.name, atsType: AtsType.FOLDER, atsToken: folder.root, active: false, sourceConfig },
    select: { id: true },
  });
  // A new mapping may read what the old one could not: files that misfit wait for the next look.
  if (preview.existing) await prisma.sourceFile.updateMany({ where: { companyId: saved.id, status: 'failed', sha256: { not: null } }, data: { status: 'waiting' } });
  logger.info({ companyId: saved.id, existing: preview.existing !== null }, 'web: folder source saved');
  return flashRedirect(
    `${BACK}#folders`,
    'ok',
    preview.existing
      ? `Saved the mapping of “${preview.name}”. The next check reads its files with it.`
      : `Added “${preview.name}”, switched off. Turn it on in the table below, and the hourly check reads what is new in the folder.`,
  );
});

/** The per-file list: what became of every file the folder's looks have seen. */
foldersRoute.get('/companies/:id/files', async (c) => {
  const id = idParam(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const company = await prisma.company.findFirst({ where: { id, atsType: AtsType.FOLDER }, select: { id: true, name: true, atsToken: true, active: true, sourceConfig: true } });
  if (!company) return c.text('Not found', 404);
  const [files, summaries] = await Promise.all([listSourceFiles(id), folderSummaries()]);
  return c.html(
    <FolderFilesPage
      folder={{ id, name: company.name, path: company.atsToken, active: company.active, include: readSourceConfig(company.sourceConfig)?.include ?? null, summary: summaries.get(id) }}
      files={files}
    />,
  );
});
