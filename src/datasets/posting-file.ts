/*
 * One posting the user saved into a folder (ADR 0062, saved postings): the
 * file's bytes as text, what code can read off them with no model, and the
 * job they become. A web page goes through saved-page.ts; text and Markdown
 * are read as they are; a PDF or a .docx through the readers of the resume
 * module (ADR 0008 addendum), the PDF reader loaded on the first PDF so a
 * worker that never meets one never loads it. No request, no model.
 * Tested in posting-file.test.ts.
 */

import { hamming64, simhash64 } from '../fingerprint';
import { t } from '../i18n/t';
import type { WorkplaceCode } from '../location';
import { docxToText } from '../resume/docx-text';
import { ZipLimitError } from '../resume/zip';
import { clipText, hashShortId, normalizeUrlKey, storableText } from '../text-utils';
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
  | { ok: true; text: string; address: string | null; addressIsOwn: boolean; facts: PageFacts | null; pageTitle: string | null; earlierKey: string }
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
const plain = (body: string): Extract<PostingRead, { ok: true }> => {
  const read = text(body);
  return { ok: true, text: read, address: null, addressIsOwn: false, facts: null, pageTitle: null, earlierKey: read };
};

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
 * model's reading second, the file's name last for the title. Its id is the
 * one `identifyPosting` gave: nothing a model said. Flagged `handPicked`: the
 * user chose it, so no base filter and no employer gate turns it away.
 */
export function savedPostingJob(file: SavedFile, read: Extract<PostingRead, { ok: true }>, model: ModelFacts | null, externalId: string): NormalizedJob {
  const facts = read.facts;
  const title = facts?.title ?? model?.title ?? nameOf(file.relPath);
  const workplace = facts?.workplace ?? (model?.workplace ? WORKPLACE[model.workplace] : null);
  return {
    companyId: file.companyId,
    externalId,
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
 * (a title worded differently would make a second job). The page's own
 * address when it names this posting alone, without its campaign parameters,
 * so the same posting saved twice is one job; else its text. The role and the
 * place its block states go in beside either: one opening in two cities
 * shares a description, and two postings may name the same careers page as
 * their address, and each is a job of its own.
 */
function savedPostingId(read: Extract<PostingRead, { ok: true }>): string {
  const own = read.addressIsOwn ? normalizeUrlKey(read.address) : null;
  const said = [read.facts?.title, read.facts?.location].filter((fact) => fact != null);
  return textId([...said, own ?? read.text].join('\n'));
}

/** A job a folder of saved postings holds already, as much of it as telling one posting from the next takes. */
export interface StoredPosting {
  externalId: string;
  title: string;
  employer: string | null;
  url: string;
  /** The file it was read from. */
  sourceFile: string | null;
  /** `fingerprint.ts:simhash64` of its text; null for a text too short to have one. */
  fingerprint: bigint | null;
}

/**
 * How far the fingerprint of a file's text may move for the file to be the
 * posting it was. Measured on 437 stored descriptions: a note appended moved
 * it 11 bits at most, a "posted 3 days ago" line or a print's date stamp 10,
 * five lines of notes 12 or less in 96 of 100; two different postings stood
 * 32 apart at the median and within 12 in 4 pairs of 1,000. Asked of the same
 * file only: across files it would join one opening's two cities.
 */
const SAME_FILE_MAX_DISTANCE = 12;
/** How much may stand below or above a posting's text and still be a note on it, not another posting. */
const MAX_NOTE_CHARS = 4_000;

const textId = (text: string): string => `saved-${hashShortId(text)}`;

/**
 * Whether a job was keyed by this text before something was written below or
 * above it — a file that states nothing has the hash of its text for an id.
 * Exact, so it holds for a text too short to have a fingerprint: a few lines
 * about a job, and the notes kept under them.
 */
function grewFrom(text: string, job: StoredPosting): boolean {
  for (let at = text.lastIndexOf('\n'); at > 0 && text.length - at <= MAX_NOTE_CHARS; at = text.lastIndexOf('\n', at - 1)) {
    if (textId(text.slice(0, at).trim()) === job.externalId) return true;
  }
  for (let at = text.indexOf('\n'); at !== -1 && at <= MAX_NOTE_CHARS; at = text.indexOf('\n', at + 1)) {
    if (textId(text.slice(at).trim()) === job.externalId) return true;
  }
  return false;
}

export interface PostingIdentity {
  externalId: string;
  /** The stored job this file is, when it is one: nothing new is stored and no model is asked. */
  known: StoredPosting | null;
}

/**
 * Which job a saved file is: one the folder holds already, or a new one under
 * `savedPostingId`. A stored job is this file's when it carries the same id;
 * or the id versions up to 2.55.11 gave it and the title the page states —
 * that id was shared by different postings, which is why the title is asked;
 * or when it came from this very file and is still the posting it was: the
 * same stated title and company, or for a file that states none the text it
 * had with a note under or over it, or a text that barely moved (a page
 * saved again). Another posting saved over the same name is a new job.
 * `stored` lists the newest first.
 */
export function identifyPosting(relPath: string, read: Extract<PostingRead, { ok: true }>, stored: readonly StoredPosting[]): PostingIdentity {
  const externalId = savedPostingId(read);
  const title = read.facts?.title ?? null;
  const sameTitle = (job: StoredPosting): boolean => title === null || job.title === title;
  const earlierId = textId(read.earlierKey);
  const company = read.facts?.company ?? null;
  const fingerprint = title === null ? simhash64(read.text) : null;
  const unchanged = (job: StoredPosting): boolean =>
    title !== null
      ? job.title === title && (company === null || job.employer === null || job.employer === company)
      : grewFrom(read.text, job) || (fingerprint !== null && job.fingerprint !== null && hamming64(fingerprint, job.fingerprint) <= SAME_FILE_MAX_DISTANCE);
  const known =
    stored.find((job) => job.externalId === externalId) ??
    stored.find((job) => job.externalId === earlierId && sameTitle(job)) ??
    stored.find((job) => job.sourceFile === relPath && unchanged(job)) ??
    null;
  return { externalId: known?.externalId ?? externalId, known };
}

/** The per-file list's line for a saved posting that became a job. */
export function savedPostingNote(job: Pick<NormalizedJob, 'title' | 'url'> & { employer?: string | null }): string {
  return t('datasets.posting.readAs', { title: job.title, named: job.employer ? 'yes' : 'no', company: job.employer ?? '', noAddress: job.url ? 'no' : 'yes' });
}
