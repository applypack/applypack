/*
 * Maps a row the user brought (ADR 0061) to a NormalizedJob. Every tool and
 * every spreadsheet names its fields its own way, so which column is the
 * title, the link and the text — the mapping — is detected from the names and
 * the values, shown to the user, corrected there and kept on the source row.
 * Only mapped columns are read, and a column about a person is never offered,
 * so it is never kept. Pure — tested in map.test.ts.
 */

import { z } from 'zod';
import { findCountry, placeLabel } from '../countries';
import { cleanEmployer } from '../employer';
import { decodeHtmlEntities, stripHtml } from '../http';
import { isBlockedPostingHost } from '../jobs/blocked-hosts';
import { workplaceFromText, type LocationHints, type WorkplaceCode } from '../location';
import { feedItemKey, hashShortId } from '../text-utils';
import type { NormalizedJob } from '../types';
import { safeHref } from '../web/format';
import { isRow, type Row } from './rows';

/** What a column can be mapped to, in the order detection claims columns and the preview lists them. */
export const MAPPING_FIELDS = [
  'title',
  'url',
  'applyUrl',
  'employer',
  'description',
  'location',
  'postedAt',
  'id',
  'country',
  'workplace',
  'salary',
  'salaryMin',
  'salaryMax',
  'salaryCurrency',
  'salaryPeriod',
  'closed',
] as const;

export type MappingField = (typeof MAPPING_FIELDS)[number];

/** Field → the column it is read from: a header, or a dotted path into a nested object. Null = not in this source. */
export type Mapping = Record<MappingField, string | null>;

const MAX_PATH_CHARS = 200;

/** A form posts '' for "not in this file"; a stored mapping may predate a field. Both read as null. */
const PathSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().max(MAX_PATH_CHARS).nullable().default(null),
);

export const MappingSchema = z.object(
  Object.fromEntries(MAPPING_FIELDS.map((f) => [f, PathSchema])) as Record<MappingField, typeof PathSchema>,
);

/** `Company.sourceConfig` of a source whose rows the user brings: the mapping they confirmed. */
const SourceConfigSchema = z.object({ mapping: MappingSchema });

export type SourceConfig = z.infer<typeof SourceConfigSchema>;

export function readSourceConfig(raw: unknown): SourceConfig | null {
  const parsed = SourceConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function emptyMapping(): Mapping {
  return Object.fromEntries(MAPPING_FIELDS.map((f) => [f, null])) as Mapping;
}

/** A row becomes a job only with a title and something to tell it from the next row. */
export function usableMapping(mapping: Mapping): boolean {
  return mapping.title !== null && (mapping.id !== null || mapping.url !== null || mapping.applyUrl !== null);
}

/** Whether a mapping kept from an earlier file still names columns this one has. */
export function mappingFits(mapping: Mapping, columns: readonly string[]): boolean {
  return usableMapping(mapping) && MAPPING_FIELDS.every((f) => mapping[f] === null || columns.includes(mapping[f]));
}

/** How many rows detection and the column list look at. */
const SAMPLE_ROWS = 50;
const MAX_COLUMNS = 120;
/** An object with more keys than this is a map of opaque attributes, not a group of fields. */
const MAX_NESTED_KEYS = 24;

const MAX_TITLE_CHARS = 200;
const MAX_LOCATION_CHARS = 200;
const MAX_LINK_CHARS = 2000;
const MAX_ID_CHARS = 200;
const MAX_PAY_CHARS = 120;
/** What the model reads of a posting is 30 k; twice that is kept, as for a pasted one (manual-job.ts). */
const MAX_DESCRIPTION_CHARS = 60_000;
/** Markup is stripped from at most this much, so a 2 MB cell costs one bounded pass. */
const MAX_RAW_DESCRIPTION_CHARS = 400_000;
/** Under the paste form's minimum a description is a snippet, and the row says so. */
const THIN_DESCRIPTION_CHARS = 200;

/** A column is guessed to be the description only when its cells run longer than a title does. */
const MIN_GUESSED_TEXT_CHARS = 80;

const NO_TEXT_NOTE = 'No description came with this row — the full posting is behind the link.';
const SNIPPET_NOTE = 'Only this much came with the row — the full posting is behind the link.';

/** Lower case, letters and digits only: "Job Title", "job_title" and "jobTitle" are one name. */
function norm(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Columns about a person — who posted, who recruits, how to reach them. Never offered, never read. */
const PEOPLE_RE = /poster|postedby|recruiter|hiringmanager|contact|email|phone|author|photo|avatar|headshot/;

function isPeopleColumn(path: string): boolean {
  return PEOPLE_RE.test(norm(path));
}

/** Names a field goes by, normalised, most telling first. A nested path joins its parts: `employer.name` is `employername`. */
const ALIASES: Record<MappingField, readonly string[]> = {
  title: ['title', 'jobtitle', 'positionname', 'displaytitle', 'position', 'positiontitle', 'role', 'jobname', 'vacancy', 'name'],
  url: ['url', 'link', 'joburl', 'joblink', 'listingurl', 'postingurl', 'posturl', 'permalink', 'href', 'detailurl', 'detailsurl', 'sourceurl', 'pageurl'],
  applyUrl: ['applyurl', 'applylink', 'applicationurl', 'applicationlink', 'applyhref', 'externalapplylink', 'externalapplyurl', 'apply'],
  employer: ['companyname', 'company', 'employer', 'employername', 'organization', 'organisation', 'organizationname', 'hiringorganization', 'hiringorganizationname', 'hiringcompany'],
  description: ['descriptionhtml', 'htmldescription', 'jobdescriptionhtml', 'contenthtml', 'bodyhtml', 'descriptiontext', 'description', 'jobdescription', 'fulldescription', 'details', 'content', 'body', 'text', 'snippet', 'summary'],
  location: ['location', 'joblocation', 'locationname', 'locationtext', 'formattedlocation', 'place', 'city', 'address', 'where', 'locations'],
  postedAt: ['postedat', 'posteddate', 'dateposted', 'datepublished', 'publishedat', 'publisheddate', 'publicationdate', 'postdate', 'postedon', 'listedat', 'createdat', 'created', 'published', 'posted', 'date'],
  id: ['id', 'jobid', 'jobkey', 'key', 'externalid', 'postingid', 'listingid', 'requisitionid', 'reqid', 'uuid', 'guid'],
  country: ['countrycode', 'country', 'locationcountrycode', 'locationcountry', 'countryname', 'locationcountryname'],
  workplace: ['isremote', 'remote', 'worktype', 'workplacetype', 'workplace', 'workmode', 'workmodel', 'workarrangement', 'arrangement', 'locationtype', 'remotetype'],
  salary: ['salary', 'basesalary', 'pay', 'compensation', 'salaryrange', 'payrange', 'salarytext', 'wage'],
  salaryMin: ['salarymin', 'minsalary', 'salaryfrom', 'salarysalarymin', 'basesalarymin', 'paymin', 'compensationmin', 'minimumsalary'],
  salaryMax: ['salarymax', 'maxsalary', 'salaryto', 'salarysalarymax', 'basesalarymax', 'paymax', 'compensationmax', 'maximumsalary'],
  salaryCurrency: ['salarycurrency', 'currency', 'currencycode', 'salarycurrencycode', 'salarysalarycurrency', 'basesalarycurrencycode'],
  salaryPeriod: ['salaryperiod', 'salarytype', 'payperiod', 'salaryinterval', 'salaryunit', 'unitofwork', 'salarysalarytype', 'basesalaryunitofwork'],
  closed: ['expired', 'closed', 'isexpired', 'isclosed', 'inactive'],
};

/** Sub-fields of a nested value, by normalised name. */
const HTML_KEYS = ['html', 'descriptionhtml'];
const TEXT_KEYS = ['text', 'plain', 'descriptiontext', 'description'];
const NAME_KEYS = ['name', 'displayname', 'title'];
const PLACE_TEXT_KEYS = ['formattedaddressshort', 'formattedaddress', 'formatted', 'displayname', 'fulladdress', 'text', 'label', 'name'];
const CITY_KEYS = ['city', 'locality', 'town'];
const REGION_KEYS = ['region', 'state', 'admin1', 'province'];
const COUNTRY_NAME_KEYS = ['countryname', 'country'];
const COUNTRY_CODE_KEYS = ['countrycode', 'iso2', 'countryiso'];
const PAY_MIN_KEYS = ['min', 'salarymin', 'minvalue', 'minimum', 'from'];
const PAY_MAX_KEYS = ['max', 'salarymax', 'maxvalue', 'maximum', 'to'];
const PAY_CURRENCY_KEYS = ['currency', 'salarycurrency', 'currencycode'];
const PAY_PERIOD_KEYS = ['period', 'salarytype', 'unitofwork', 'unit', 'interval', 'type'];
const PAY_TEXT_KEYS = ['text', 'formatted', 'display', 'label'];

/** A posting's text carrying markup, written out or HTML-escaped (gotcha 12). */
const MARKUP_RE = /<\/?(p|div|ul|ol|li|br|h[1-6]|strong|em|b|table|span|a)[\s>/]|&lt;\/?(p|div|ul|ol|li|br|h[1-6])\b/i;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const MONTH_NAME_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
const YEAR_RE = /\b(?:19|20)\d{2}\b/;
/** A posting date before this, or past tomorrow, is a misread column rather than a date. */
const EARLIEST_POSTING = Date.UTC(2000, 0, 1);
const DAY_MS = 86_400_000;

const PERIODS: readonly (readonly [RegExp, string])[] = [
  [/year|annual|annum|\byr\b/, 'year'],
  [/month|\bmo\b/, 'month'],
  [/week|\bwk\b/, 'week'],
  [/hour|\bhr\b/, 'hour'],
  [/day|daily/, 'day'],
];

/** The value at a column: a header as written (a CSV's may hold a dot), else a path into nested objects. */
function valueAt(row: Row, path: string): unknown {
  if (Object.hasOwn(row, path)) return row[path];
  let value: unknown = row;
  for (const part of path.split('.')) {
    if (!isRow(value) || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

/** A cell as text: a string trimmed, a number or a boolean written out, a list of those joined. Anything else is nothing. */
function cellText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' || typeof v === 'number').join(', ');
  return '';
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function inner(value: Row, names: readonly string[]): unknown {
  for (const name of names) {
    for (const [key, v] of Object.entries(value)) if (norm(key) === name) return v;
  }
  return undefined;
}

/** A link only when it is http(s) — the rule `safeHref` keeps for every URL from outside. */
function httpLink(value: unknown): string | null {
  const text = cellText(value);
  return text.length > 0 && text.length <= MAX_LINK_CHARS ? safeHref(text) : null;
}

/**
 * A date the row states: ISO, a month name with a year, or an epoch. Words
 * ("2 days ago", "yesterday") and day/month orders that depend on the locale
 * are not dates here — the caller's fallback is more honest than a guess.
 */
export function readDate(value: unknown, now: Date): Date | null {
  const text = cellText(value);
  let ms: number;
  if (/^\d{10}$/.test(text)) ms = Number(text) * 1000;
  else if (/^\d{13}$/.test(text)) ms = Number(text);
  else if (ISO_DATE_RE.test(text)) ms = Date.parse(text.replace(' ', 'T'));
  else if (MONTH_NAME_RE.test(text) && YEAR_RE.test(text)) ms = Date.parse(text);
  else return null;
  return Number.isNaN(ms) || ms < EARLIEST_POSTING || ms > now.getTime() + DAY_MS ? null : new Date(ms);
}

function readId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value).trim();
  if (id.length === 0) return null;
  return id.length <= MAX_ID_CHARS ? id : hashShortId(id);
}

function readEmployer(value: unknown): string | null {
  return cleanEmployer(isRow(value) ? cellText(inner(value, NAME_KEYS)) : cellText(value));
}

function readDescription(value: unknown): string {
  const raw = isRow(value) ? cellText(inner(value, HTML_KEYS) ?? inner(value, TEXT_KEYS)) : cellText(value);
  const clipped = raw.slice(0, MAX_RAW_DESCRIPTION_CHARS);
  // Stripped once and only when it is markup: a second pass over plain text
  // flattens the paragraphs the first one built (gotcha 12).
  const text = MARKUP_RE.test(clipped) ? stripHtml(clipped) : decodeHtmlEntities(clipped);
  return text.slice(0, MAX_DESCRIPTION_CHARS).trim();
}

function readCountry(value: unknown): string | null {
  const text = cellText(value);
  return text.length > 0 && text.length <= 60 ? (findCountry(text)?.code ?? null) : null;
}

function readPlace(value: unknown): { text: string; country: string | null } {
  if (!isRow(value)) return { text: oneLine(cellText(value)), country: null };
  const parts = [CITY_KEYS, REGION_KEYS, COUNTRY_NAME_KEYS].map((keys) => cellText(inner(value, keys))).filter((p) => p.length > 0);
  return {
    text: oneLine(cellText(inner(value, PLACE_TEXT_KEYS)) || parts.join(', ')),
    country: readCountry(inner(value, COUNTRY_CODE_KEYS)) ?? readCountry(inner(value, COUNTRY_NAME_KEYS)),
  };
}

/** `isRemote: true`, "Fully remote", "Hybrid". A false or an unknown word says nothing. */
function readWorkplace(value: unknown): WorkplaceCode | null {
  const text = cellText(value);
  if (/^(?:true|yes|y|1)$/i.test(text)) return 'REMOTE';
  const code = workplaceFromText(text);
  return code === 'UNKNOWN' ? null : code;
}

function isTrue(value: unknown): boolean {
  return /^(?:true|yes|y|1|expired|closed)$/i.test(cellText(value));
}

function amount(value: unknown): number | null {
  const text = cellText(value).replace(/[\s,'_]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return n > 0 ? Number(n.toFixed(2)) : null;
}

function periodWord(value: unknown): string | null {
  const text = cellText(value).toLowerCase();
  return text.length > 0 ? (PERIODS.find(([re]) => re.test(text))?.[1] ?? null) : null;
}

/** "Salary: 90000-120000 EUR (year)." — the line the classifier reads the pay from, as Adzuna's mapper writes it. */
function salaryLine(at: (field: MappingField) => unknown): string | null {
  const pay = at('salary');
  const nested = isRow(pay) ? pay : null;
  const pick = (field: MappingField, keys: readonly string[]): unknown[] => [at(field), nested ? inner(nested, keys) : undefined];
  const first = <T>(values: unknown[], read: (v: unknown) => T | null): T | null => {
    for (const v of values) {
      const got = read(v);
      if (got !== null) return got;
    }
    return null;
  };
  const min = first(pick('salaryMin', PAY_MIN_KEYS), amount);
  const max = first(pick('salaryMax', PAY_MAX_KEYS), amount);
  if (min === null && max === null) {
    const text = oneLine(nested ? cellText(inner(nested, PAY_TEXT_KEYS)) : cellText(pay)).slice(0, MAX_PAY_CHARS).replace(/[.\s]+$/, '');
    return text.length > 0 ? `Salary: ${text}.` : null;
  }
  const currency = first(pick('salaryCurrency', PAY_CURRENCY_KEYS), (v) => (/^[A-Za-z]{3}$/.test(cellText(v)) ? cellText(v).toUpperCase() : null));
  const period = first(pick('salaryPeriod', PAY_PERIOD_KEYS), periodWord);
  const range = min !== null && max !== null && min !== max ? `${min}-${max}` : `${max ?? min}`;
  return `Salary: ${range}${currency ? ` ${currency}` : ''}${period ? ` (${period})` : ''}.`;
}

/** Whether a value could be this field at all — what lets a named column be passed over when its cells are something else. */
function fitsField(field: MappingField, value: unknown, now: Date): boolean {
  if (field === 'url' || field === 'applyUrl') return httpLink(value) !== null;
  if (field === 'postedAt') return readDate(value, now) !== null;
  return cellText(value).length > 0 || isRow(value);
}

/**
 * The columns a mapping can name, in the file's own order: every top-level
 * key, and the plain fields one level inside an object. A list of objects is
 * not a cell, and a column about a person is left out.
 */
export function columnsOf(rows: readonly Row[]): string[] {
  const out = new Set<string>();
  const add = (path: string): void => {
    if (path.length <= MAX_PATH_CHARS && !isPeopleColumn(path)) out.add(path);
  };
  for (const row of rows.slice(0, SAMPLE_ROWS)) {
    for (const [key, value] of Object.entries(row)) {
      if (Array.isArray(value) && value.some(isRow)) continue;
      add(key);
      if (!isRow(value) || Object.keys(value).length > MAX_NESTED_KEYS) continue;
      for (const [sub, nested] of Object.entries(value)) {
        if (!isRow(nested) && !Array.isArray(nested)) add(`${key}.${sub}`);
      }
    }
  }
  return [...out].slice(0, MAX_COLUMNS);
}

/** A column's first value, short enough for a table cell — what the preview shows beside its select. */
export function sampleValue(rows: readonly Row[], column: string): string {
  for (const row of rows.slice(0, SAMPLE_ROWS)) {
    const value = valueAt(row, column);
    const text = isRow(value) ? `{ ${Object.keys(value).filter((k) => !isPeopleColumn(k)).slice(0, 5).join(', ')} }` : oneLine(cellText(value));
    if (text.length > 0) return text.length > 90 ? `${text.slice(0, 89)}…` : text;
  }
  return '';
}

interface ColumnTexts {
  column: string;
  /** The non-empty cells of the sample. */
  texts: string[];
}

const share = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);
const average = (texts: readonly string[]): number => share(texts.reduce((sum, t) => sum + t.length, 0), texts.length);
const distinct = (texts: readonly string[]): number => share(new Set(texts).size, texts.length);

/**
 * What the values say when the names say nothing (a column called "Field3"):
 * all links → the link; the longest text → the description; dates → the date;
 * short and often repeated → the employer. Guesses, and the preview marks them.
 */
const GUESSES: readonly (readonly [MappingField, (cols: readonly ColumnTexts[], rows: number, now: Date) => string | null])[] = [
  [
    'url',
    (cols, rows) =>
      cols
        .filter((c) => c.texts.length >= rows * 0.8 && c.texts.every((t) => httpLink(t) !== null))
        // A link per posting differs on every row; the company's site repeats.
        .sort((a, b) => distinct(b.texts) - distinct(a.texts))[0]?.column ?? null,
  ],
  [
    'description',
    (cols) =>
      cols.filter((c) => average(c.texts) >= MIN_GUESSED_TEXT_CHARS).sort((a, b) => average(b.texts) - average(a.texts))[0]?.column ?? null,
  ],
  [
    'postedAt',
    (cols, rows, now) =>
      cols.find((c) => c.texts.length >= rows * 0.5 && share(c.texts.filter((t) => readDate(t, now) !== null).length, c.texts.length) >= 0.8)
        ?.column ?? null,
  ],
  [
    'employer',
    (cols, rows) =>
      rows < 5
        ? null
        : (cols.find(
            (c) =>
              c.texts.length >= rows * 0.8 &&
              average(c.texts) <= 40 &&
              distinct(c.texts) <= 0.7 &&
              c.texts.every((t) => httpLink(t) === null && !/^[\d\s.,:/-]+$/.test(t) && !/^(?:true|false|yes|no)$/i.test(t)),
          )?.column ?? null),
  ],
];

export interface DetectedMapping {
  mapping: Mapping;
  /** Fields read off the values, not the names: the weaker half, shown as a guess. */
  guessed: MappingField[];
}

export function detectMapping(rows: readonly Row[], now: Date = new Date()): DetectedMapping {
  const sample = rows.slice(0, SAMPLE_ROWS);
  const columns = columnsOf(sample);
  const mapping = emptyMapping();
  const used = new Set<string>();
  const claim = (field: MappingField, column: string): void => {
    mapping[field] = column;
    used.add(column);
  };
  for (const field of MAPPING_FIELDS) {
    const named = ALIASES[field]
      .flatMap((alias) => columns.filter((c) => norm(c) === alias))
      .find((c) => !used.has(c) && sample.some((row) => fitsField(field, valueAt(row, c), now)));
    if (named !== undefined) claim(field, named);
  }
  const guessed: MappingField[] = [];
  for (const [field, guess] of GUESSES) {
    if (mapping[field] !== null) continue;
    const free = columns
      .filter((c) => !used.has(c))
      .map((column) => ({ column, texts: sample.map((row) => valueAt(row, column)).filter((v) => !isRow(v)).map(cellText).filter((t) => t.length > 0) }))
      .filter((c) => c.texts.length > 0);
    const column = guess(free, sample.length, now);
    if (column === null) continue;
    claim(field, column);
    guessed.push(field);
  }
  return { mapping, guessed };
}

/** Why a row is not a job: marked closed by its source, no title, or nothing to tell it from the next row. */
export const DROP_REASONS = ['closed', 'no-title', 'no-identity'] as const;
export type DropReason = (typeof DROP_REASONS)[number];

export type MappedRow = { job: NormalizedJob; thin: boolean } | { dropped: DropReason };

/**
 * One row as a job. `employer` is always set — a name or null, never absent:
 * these rows carry many employers, and the source's own name is never one
 * (ADR 0056). `now` stands in for a date the row does not state.
 */
export function mapRow(row: Row, mapping: Mapping, companyId: number, now: Date): MappedRow {
  const at = (field: MappingField): unknown => (mapping[field] === null ? undefined : valueAt(row, mapping[field]));
  if (isTrue(at('closed'))) return { dropped: 'closed' };
  const title = oneLine(cellText(at('title'))).slice(0, MAX_TITLE_CHARS);
  if (title.length === 0) return { dropped: 'no-title' };
  const listing = httpLink(at('url'));
  const apply = httpLink(at('applyUrl'));
  const externalId = readId(at('id')) ?? feedItemKey(listing ?? apply);
  if (externalId === null) return { dropped: 'no-identity' };

  const body = readDescription(at('description'));
  const thin = body.length < THIN_DESCRIPTION_CHARS;
  const note = body.length === 0 ? NO_TEXT_NOTE : thin ? SNIPPET_NOTE : null;

  const place = readPlace(at('location'));
  const ownCountry = readCountry(at('country'));
  const country = ownCountry ?? place.country;
  const label = country === null ? '' : placeLabel(country);
  // A country in a column of its own is not in the place's text yet ("Berlin" + "DE").
  const location =
    place.text.length === 0 ? label : ownCountry !== null && !place.text.toLowerCase().includes(label.toLowerCase()) ? `${place.text}, ${label}` : place.text;
  const workplace = readWorkplace(at('workplace'));
  const hints: LocationHints = { ...(country !== null && { countries: [country] }), ...(workplace !== null && { workplace }) };

  return {
    thin,
    job: {
      companyId,
      externalId,
      title,
      // The apply link when the row has one on a host of its own; a link back
      // into a listing site is the listing, so the listing link stands.
      url: apply !== null && !isBlockedPostingHost(new URL(apply).hostname) ? apply : (listing ?? apply ?? ''),
      location: location.slice(0, MAX_LOCATION_CHARS),
      description: [salaryLine(at), body, note].filter((part) => part !== null && part.length > 0).join('\n\n'),
      postedAt: readDate(at('postedAt'), now) ?? now,
      employer: readEmployer(at('employer')),
      ...(Object.keys(hints).length > 0 && { locationHints: hints }),
    },
  };
}

export interface MappedRows {
  jobs: NormalizedJob[];
  dropped: Record<DropReason, number>;
  /** Rows whose id an earlier row of the same body already carries. */
  repeated: number;
  /** Rows that came with a snippet or no description. */
  thin: number;
}

export function mapRows(rows: readonly Row[], mapping: Mapping, companyId: number, now: Date): MappedRows {
  const out: MappedRows = { jobs: [], dropped: { closed: 0, 'no-title': 0, 'no-identity': 0 }, repeated: 0, thin: 0 };
  const seen = new Set<string>();
  for (const row of rows) {
    const mapped = mapRow(row, mapping, companyId, now);
    if ('dropped' in mapped) out.dropped[mapped.dropped]++;
    else if (seen.has(mapped.job.externalId)) out.repeated++;
    else {
      seen.add(mapped.job.externalId);
      out.jobs.push(mapped.job);
      if (mapped.thin) out.thin++;
    }
  }
  return out;
}
