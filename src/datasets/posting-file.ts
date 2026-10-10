/*
 * One posting the user saved into a folder (ADR 0062, saved postings): the
 * file's bytes as text, what code can read off them with no model, and the
 * job they become. A web page goes through saved-page.ts; text and Markdown
 * are read as they are; a PDF or a .docx through the readers of the resume
 * module (ADR 0008 addendum), the PDF reader loaded on the first PDF so a
 * worker that never meets one never loads it. No request, no model.
 * Tested in posting-file.test.ts.
 */

import { t } from '../i18n/t';
import type { WorkplaceCode } from '../location';
import { docxToText } from '../resume/docx-text';
import { ZipLimitError } from '../resume/zip';
import { clipText, hashShortId, storableText } from '../text-utils';
import type { NormalizedJob } from '../types';
import type { PostingKind } from './folder-scan';
import { decodeBody } from './rows';
import { MAX_POSTING_TEXT_CHARS, readSavedPage, type PageFacts } from './saved-page';

/** As `jobs/manual-job.ts:MIN_DESCRIPTION_CHARS`: less than this is not a posting, it is a note. */
const MIN_POSTING_CHARS = 200;
/**
 * What a saved .docx may unpack to. A posting's document.xml is tens of
 * kilobytes, and these files are read with nobody watching: one that inflates
 * to megabytes is not a posting, and reading it costs the worker 50 MB of
 * memory a megabyte (zip.ts, #400).
 */
const MAX_POSTING_DOCX_BYTES = 2 * 1024 * 1024;
const MAX_TITLE_CHARS = 200;

export type PostingRead =
  | { ok: true; text: string; address: string | null; addressIsOwn: boolean; facts: PageFacts | null; pageTitle: string | null }
  | { ok: false; why: string };

/** What the per-file list says about a saved posting that gave no job: worded when read, in the language of the moment. */
export const POSTING_NOTES = {
  get tooShort(): string {
    return t('datasets.posting.tooShort', { n: MIN_POSTING_CHARS });
  },
  get pdf(): string {
    return t('datasets.posting.pdf');
  },
  get docx(): string {
    return t('datasets.posting.docx');
  },
  get docxTooLarge(): string {
    return t('datasets.posting.docxTooLarge', { mb: MAX_POSTING_DOCX_BYTES / 1024 / 1024 });
  },
  get needsModel(): string {
    return t('datasets.posting.needsModel');
  },
};

const text = (raw: string): string => clipText(storableText(raw.replace(/\r\n?/g, '\n')).trim(), MAX_POSTING_TEXT_CHARS).trim();
const plain = (body: string): Extract<PostingRead, { ok: true }> => ({ ok: true, text: text(body), address: null, addressIsOwn: false, facts: null, pageTitle: null });

/** A saved file as text and what it says about itself. Never throws for what a file holds. */
export async function readPostingFile(kind: PostingKind, bytes: Uint8Array, now: Date = new Date()): Promise<PostingRead> {
  let read: Exclude<PostingRead, { ok: false }>;
  if (kind === 'html') {
    read = { ok: true, ...readSavedPage(decodeBody(bytes), now) };
  } else if (kind === 'pdf') {
    try {
      const { pdfToText } = await import('../resume/pdf-text.js');
      read = plain(await pdfToText(Buffer.from(bytes)));
    } catch {
      return { ok: false, why: POSTING_NOTES.pdf };
    }
  } else if (kind === 'docx') {
    try {
      read = plain(docxToText(Buffer.from(bytes), MAX_POSTING_DOCX_BYTES));
    } catch (err) {
      return { ok: false, why: err instanceof ZipLimitError ? POSTING_NOTES.docxTooLarge : POSTING_NOTES.docx };
    }
  } else {
    read = plain(decodeBody(bytes).replace(/^\uFEFF/, ''));
  }
  return read.text.length < MIN_POSTING_CHARS ? { ok: false, why: POSTING_NOTES.tooShort } : read;
}

/** What a model read off the text: `jobs/posting-extract.ts:PostingFacts`, the fields this needs. */
export interface ModelFacts {
  title: string | null;
  company: string | null;
  location: string | null;
  workplace: 'remote' | 'hybrid' | 'onsite' | null;
}

/** Whether the page said its title and its company itself; if not, a model reads them. */
export function needsModel(read: Extract<PostingRead, { ok: true }>): boolean {
  return read.facts?.title == null || read.facts.company == null;
}

const WORKPLACE: Record<NonNullable<ModelFacts['workplace']>, WorkplaceCode> = { remote: 'REMOTE', hybrid: 'HYBRID', onsite: 'ONSITE' };

/** The file's own name as a title: "Senior PHP Developer at Acme.pdf" says what it is. */
function nameOf(relPath: string): string {
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return stem.length > 0 ? clipText(stem, MAX_TITLE_CHARS) : 'Saved posting';
}

export interface SavedFile {
  companyId: number;
  relPath: string;
  mtimeMs: number;
}

/**
 * The job a saved posting becomes. What the page said itself comes first, a
 * model's reading second, the file's name last for the title. The id is
 * `savedPostingId`: nothing a model said. Flagged `handPicked`: the user
 * chose it, so no base filter and no employer gate turns it away.
 */
export function savedPostingJob(file: SavedFile, read: Extract<PostingRead, { ok: true }>, model: ModelFacts | null): NormalizedJob {
  const facts = read.facts;
  const title = facts?.title ?? model?.title ?? nameOf(file.relPath);
  const workplace = facts?.workplace ?? (model?.workplace ? WORKPLACE[model.workplace] : null);
  return {
    companyId: file.companyId,
    externalId: savedPostingId(read),
    title,
    url: read.address ?? '',
    location: facts?.location ?? model?.location ?? '',
    description: read.text,
    postedAt: facts?.postedAt ?? new Date(file.mtimeMs),
    ...(workplace && { locationHints: { workplace } }),
    employer: facts?.company ?? model?.company ?? null,
    sourceFile: file.relPath,
    handPicked: true,
  };
}

/**
 * A saved posting's id, from what code read and never from what a model said
 * (a title worded differently would make a second job): the page's own
 * address when it names this posting alone — the same posting saved twice is
 * one job — else its text.
 */
function savedPostingId(read: Extract<PostingRead, { ok: true }>): string {
  return `saved-${hashShortId(read.addressIsOwn && read.address !== null ? read.address : read.text)}`;
}

/** The per-file list's line for a saved posting that became a job. */
export function savedPostingNote(job: NormalizedJob): string {
  return t('datasets.posting.readAs', { title: job.title, named: job.employer ? 'yes' : 'no', company: job.employer ?? '', noAddress: job.url ? 'no' : 'yes' });
}
