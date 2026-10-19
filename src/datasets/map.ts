/*
 * Maps a row the user brought (ADR 0062) to a NormalizedJob. Every tool and
 * every spreadsheet names its fields its own way, so which column is the
 * title, the link and the text — the mapping — is detected from the names and
 * the values, shown to the user, corrected there and kept on the source row.
 * Only mapped columns are read, and a column about a person is never offered,
 * so it is never kept. Pure — tested in map.test.ts.
 */

import { z } from 'zod';
import { findCountry, placeLabel } from '../countries';
import { isCurrencyCode } from '../currency';
import { cleanEmployer } from '../employer';
import { decodeHtmlEntities, stripHtml, stripInlineTags } from '../http';
import { isBlockedPostingHost } from '../jobs/blocked-hosts';
import { workplaceFromText, type LocationHints, type WorkplaceCode } from '../location';
import { clipText, feedItemKey, hashShortId, storableText } from '../text-utils';
import type { NormalizedJob } from '../types';
import { safeHref } from '../web/format';
import { MAX_COLUMNS, findRows, isRow, keptColumns, type Row, type RowsResult } from './rows';

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
  // Not trimmed: a column is named by its key exactly as the file writes it.
  z.string().max(MAX_PATH_CHARS).nullable().default(null),
);

export const MappingSchema = z.object(
  Object.fromEntries(MAPPING_FIELDS.map((f) => [f, PathSchema])) as Record<MappingField, typeof PathSchema>,
);

/** The name filter of a folder source (`jobs-*.json`); longer than this is not a file name pattern. */
export const MAX_INCLUDE_CHARS = 200;

/** Whether a folder's matches send an alert (ADR 0062): as every source does, or never — they still land on /jobs. */
export const FOLDER_ALERTS = ['matches', 'off'] as const;
export type FolderAlerts = (typeof FOLDER_ALERTS)[number];

const sharedConfig = {
  include: z.string().max(MAX_INCLUDE_CHARS).nullable().default(null),
  alerts: z.enum(FOLDER_ALERTS).default('matches'),
};

/**
 * `Company.sourceConfig` of a source the user brings. Rows (an imported file,
 * a folder a tool writes into): the mapping they confirmed. Saved postings (a
 * folder the user saves pages into): no mapping — a file is one posting. For
 * a folder, the name filter of the files that count
 * (folder-scan.ts:includeMatcher) and whether its matches alert. A config
 * stored before `holds` existed reads as rows.
 */
const SourceConfigSchema = z.union([
  z.object({ holds: z.literal('postings'), mapping: z.null().default(null), ...sharedConfig }),
  z.object({ holds: z.literal('rows').default('rows'), mapping: MappingSchema, ...sharedConfig }),
]);

export type SourceConfig = z.infer<typeof SourceConfigSchema>;

export function readSourceConfig(raw: unknown): SourceConfig | null {
  const parsed = SourceConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * A folder set to "No alerts" (ADR 0062): its matches stay on Jobs and no
 * message carries them — not the alert, not a held one, not the daily recap.
 * Asked wherever a message is put together, so the promise has one reader.
 */
export function alertsOff(source: { atsType: string; sourceConfig: unknown }): boolean {
  return source.atsType === 'FOLDER' && readSourceConfig(source.sourceConfig)?.alerts === 'off';
}

export function emptyMapping(): Mapping {
  return Object.fromEntries(MAPPING_FIELDS.map((f) => [f, null])) as Mapping;
}

/** A row becomes a job only with a title and something to tell it from the next row. */
export function usableMapping(mapping: Mapping): boolean {
  return mapping.title !== null && (mapping.id !== null || mapping.url !== null || mapping.applyUrl !== null);
}

/** Whether two mappings read the same columns for every field. */
export function sameMapping(a: Mapping, b: Mapping): boolean {
  return MAPPING_FIELDS.every((f) => a[f] === b[f]);
}

/** Whether a mapping kept from an earlier file still names columns this one has. */
export function mappingFits(mapping: Mapping, columns: readonly string[]): boolean {
  return usableMapping(mapping) && MAPPING_FIELDS.every((f) => mapping[f] === null || columns.includes(mapping[f]));
}

/** How many rows detection and the column list look at. */
const SAMPLE_ROWS = 50;
/** An object with more keys than this is a map of opaque attributes, not a group of fields. */
const MAX_NESTED_KEYS = 24;

const MAX_TITLE_CHARS = 200;
const MAX_LOCATION_CHARS = 200;
const MAX_LINK_CHARS = 2000;
const MAX_ID_CHARS = 200;
const MAX_PAY_CHARS = 120;
/** Longer than any date a row writes; a longer cell is prose. */
const MAX_DATE_CHARS = 64;
/** What the model reads of a posting is 30 k; twice that is kept, as for a pasted one (manual-job.ts). */
const MAX_DESCRIPTION_CHARS = 60_000;
/** Markup is stripped from at most this much — markup around 60 k of text — so a 2 MB cell costs one bounded pass. */
const MAX_RAW_DESCRIPTION_CHARS = 200_000;
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

/**
 * Columns about a person, by their names — who posted, who recruits, whose
 * profile, how to reach them. Never offered, never read. A list of names can
 * only know the names it holds, so `holdsContacts` reads the cells as well.
 */
const PEOPLE_RE =
  /poster|postedby|createdby|submittedby|addedby|owner|recruiter|manager|contact|person|people|member|username|fullname|firstname|lastname|surname|author|profile(?:url|link|pic|photo|image|id)|userprofile|email|phone|telefon|^tel$|^mobile|mobile(?:number|no)$|photo|picture|image|avatar|headshot|gender|birth/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A number written to be dialled: a plus and at least seven digits. A bare run of digits is an id. */
const PHONE_RE = /^\+\d(?:[\s().-]*\d){6,}$/;

/**
 * Names that hold one of those words and are facts about the job: a permit
 * to work ("workAuthorization" holds "author"), a yes/no about who posted
 * ("isRecruiter"), working in person, ownership, a membership. They are cut
 * out of a name before it is asked about people, so "authorEmail" and
 * "personalEmail" are still left out for what remains (#403).
 */
const JOB_FACT_RE = /authori[sz]|authority|^(?:is|has)(?:a|an)?(?:recruiter|manager|agency)|inperson|ownership|membership|personal/g;

function isPeopleColumn(path: string): boolean {
  return PEOPLE_RE.test(norm(path).replace(JOB_FACT_RE, ' '));
}

/** Most of what a column holds is e-mail addresses or phone numbers, whatever the column is called. */
function holdsContacts(texts: readonly string[]): boolean {
  return texts.length > 0 && texts.filter((t) => EMAIL_RE.test(t) || PHONE_RE.test(t)).length >= texts.length * 0.8;
}

/** Names a field goes by, normalised, most telling first. A nested path joins its parts: `employer.name` is `employername`. */
const ALIASES: Record<MappingField, string[]> = {
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

/**
 * The same names in the interface's other languages (ADR 0061) and German:
 * a sheet with Ukrainian headers found neither its title nor its company
 * (#403). Tried after the English ones, with and without their accents.
 */
const MORE_ALIASES: Partial<Record<MappingField, readonly string[]>> = {
  title: ['посада', 'вакансія', 'назвавакансії', 'позиція', 'назва', 'puesto', 'cargo', 'vacante', 'título', 'titulo', 'poste', 'intitulé', 'intitule', 'intituléduposte', 'intituleduposte', 'titre', 'stelle', 'stellentitel', 'jobtitel', 'stellenbezeichnung', 'titel'],
  url: ['посилання', 'лінк', 'enlace', 'vínculo', 'vinculo', 'lien'],
  employer: ['компанія', 'роботодавець', 'організація', 'empresa', 'compañía', 'compania', 'empleador', 'entreprise', 'société', 'societe', 'employeur', 'unternehmen', 'firma', 'arbeitgeber'],
  description: ['опис', 'описвакансії', 'descripción', 'descripcion', 'beschreibung', 'stellenbeschreibung'],
  location: ['місто', 'локація', 'місце', 'розташування', 'місцезнаходження', 'ubicación', 'ubicacion', 'ciudad', 'lugar', 'localidad', 'lieu', 'ville', 'localisation', 'emplacement', 'ort', 'standort', 'arbeitsort', 'stadt'],
  postedAt: ['дата', 'датапублікації', 'опубліковано', 'fecha', 'fechadepublicación', 'fechadepublicacion', 'publicado', 'datedepublication', 'datum', 'veröffentlicht', 'veroffentlicht', 'veröffentlichungsdatum'],
  country: ['країна', 'país', 'pais', 'pays', 'land'],
  salary: ['зарплата', 'зарплатня', 'оплата', 'salario', 'sueldo', 'salaire', 'rémunération', 'remuneration', 'gehalt', 'vergütung', 'vergutung'],
};
for (const field of MAPPING_FIELDS) ALIASES[field] = [...ALIASES[field], ...(MORE_ALIASES[field] ?? [])];

const KNOWN_NAMES: ReadonlySet<string> = new Set(Object.values(ALIASES).flat());

/** Whether a column goes by a name of one of a job's fields — what is kept first of a table too wide to keep whole (rows.ts:keptColumns). */
function knownColumn(name: string): boolean {
  return KNOWN_NAMES.has(norm(name));
}

/** Sub-fields of a nested value, by normalised name. */
const HTML_KEYS = ['html', 'descriptionhtml'];
const TEXT_KEYS = ['text', 'plain', 'descriptiontext', 'description'];
const NAME_KEYS = ['name', 'displayname', 'title'];
const PLACE_TEXT_KEYS = ['formattedaddressshort', 'formattedaddress', 'formatted', 'displayname', 'fulladdress', 'address', 'text', 'label', 'name'];
const CITY_KEYS = ['city', 'locality', 'town', 'addresslocality'];
const REGION_KEYS = ['region', 'state', 'admin1', 'province', 'addressregion'];
const COUNTRY_NAME_KEYS = ['countryname', 'country', 'addresscountry'];
const COUNTRY_CODE_KEYS = ['countrycode', 'iso2', 'countryiso', 'addresscountry'];
/** Where a place nests its parts: schema.org's `Place.address`. */
const ADDRESS_KEYS = ['address'];
/** A posting lists a handful of places; a longer list is cut here. */
const MAX_PLACES = 5;
const PAY_MIN_KEYS = ['min', 'salarymin', 'minvalue', 'minimum', 'from'];
const PAY_MAX_KEYS = ['max', 'salarymax', 'maxvalue', 'maximum', 'to'];
const PAY_CURRENCY_KEYS = ['currency', 'salarycurrency', 'currencycode'];
const PAY_PERIOD_KEYS = ['period', 'salarytype', 'unitofwork', 'unit', 'interval', 'type'];
const PAY_TEXT_KEYS = ['text', 'formatted', 'display', 'label'];

/**
 * A posting's text whose lines come from its markup, written out or
 * HTML-escaped (gotcha 12): paragraphs, lists, breaks, headings, tables.
 */
const BLOCK_MARKUP_RE = /(?:<|&lt;)\/?(?:p|div|ul|ol|li|br|h[1-6]|table|tr|td|section|article|blockquote)(?:[\s>/]|&gt;)/i;
/**
 * Text that only dresses words — a link, a bold phrase — and closes what it
 * opens. Its lines are already lines: the tags go, the newlines stay (#403).
 */
const INLINE_MARKUP_RE = /(?:<|&lt;)\/(?:a|b|i|u|s|em|strong|span|font|small|sup|sub|mark|code)\s*(?:>|&gt;)/i;
/** A short field is read from at most this much of its cell. */
const MAX_RAW_LINE_CHARS = 4_000;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const MONTH_NAME_RE = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const YEAR_RE = /\b(?:19|20)\d{2}\b/;
/** What a written date is made of besides its digits: the month, a weekday, "5th", "at", am/pm, a zone. */
const DATE_WORDS_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|at|am|pm|gmt|utc|z)\b/gi;
const ORDINAL_RE = /\b(\d{1,2})(?:st|nd|rd|th)\b/gi;
/** A date that says which zone it is in; one that does not is read as UTC, on every machine alike. */
const ZONED_RE = /(?:Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i;
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

/** A cell as text: a string cleaned and trimmed, a number or a boolean written out, a list of those joined. Anything else is nothing. */
function cellText(value: unknown): string {
  if (typeof value === 'string') return storableText(value).trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return storableText(value.filter((v) => typeof v === 'string' || typeof v === 'number').join(', ')).trim();
  return '';
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A title, a company or a place as plain words on one line: entities
 * decoded, the tags it closes taken out. `Evil <b>Corp</b>` was stored with
 * its tags — escaped on every page, so harmless, and shown as tags on Jobs,
 * the job page and in every message (#403).
 */
function plainLine(value: unknown): string {
  return oneLine(stripInlineTags(cellText(value).slice(0, MAX_RAW_LINE_CHARS)));
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
  const href = text.length > 0 && text.length <= MAX_LINK_CHARS ? safeHref(text) : null;
  // Measured again as it will be stored: a link in another script grows when it is written out.
  return href !== null && href.length <= MAX_LINK_CHARS ? href : null;
}

/**
 * A date the row states: ISO, a month name with a year, or an epoch. Words
 * ("2 days ago", "yesterday") and day/month orders that depend on the locale
 * are not dates here — the caller's fallback is more honest than a guess.
 * A day with no time is its midnight UTC, which `web/format.ts:formatPosted`
 * writes as that day in every zone (#532).
 */
export function readDate(value: unknown, now: Date): Date | null {
  const text = cellText(value);
  if (text.length > MAX_DATE_CHARS) return null;
  let ms: number;
  if (/^\d{10}$/.test(text)) ms = Number(text) * 1000;
  else if (/^\d{13}$/.test(text)) ms = Number(text);
  else if (ISO_DATE_RE.test(text)) {
    // "2026-10-05 10:00:00 +02:00": the space before the zone is how a database prints it, and Date.parse refuses it.
    const iso = text.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T').replace(/\s+/g, '');
    ms = Date.parse(text.length === 10 || ZONED_RE.test(text) ? iso : `${iso}Z`);
  } else if (MONTH_NAME_RE.test(text) && YEAR_RE.test(text)) {
    // A date and nothing else. "You may apply 2026" holds a month's name and a year, and Date.parse reads it as 1 May (#403).
    const written = text.replace(ORDINAL_RE, '$1').replace(/\bat\b/gi, ' ');
    if (/\p{L}/u.test(written.replace(DATE_WORDS_RE, ' '))) return null;
    ms = Date.parse(ZONED_RE.test(written) ? written : `${written} UTC`);
  } else return null;
  return Number.isNaN(ms) || ms < EARLIEST_POSTING || ms > now.getTime() + DAY_MS ? null : new Date(ms);
}

function readId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = cellText(value);
  if (id.length === 0) return null;
  return id.length <= MAX_ID_CHARS ? id : hashShortId(id);
}

function readEmployer(value: unknown): string | null {
  return cleanEmployer(plainLine(isRow(value) ? inner(value, NAME_KEYS) : value));
}

function readDescription(value: unknown): string {
  const raw = isRow(value) ? cellText(inner(value, HTML_KEYS) ?? inner(value, TEXT_KEYS)) : cellText(value);
  const clipped = raw.slice(0, MAX_RAW_DESCRIPTION_CHARS);
  // Stripped once and only when it is markup: a second pass over plain text
  // flattens the paragraphs the first one built (gotcha 12). Markup that
  // only dresses words leaves the lines alone.
  const text = BLOCK_MARKUP_RE.test(clipped) ? stripHtml(clipped) : INLINE_MARKUP_RE.test(clipped) ? stripInlineTags(clipped) : decodeHtmlEntities(clipped);
  return clipText(storableText(text).trim(), MAX_DESCRIPTION_CHARS).trim();
}

function readCountry(value: unknown): string | null {
  const text = cellText(value);
  return text.length > 0 && text.length <= 60 ? (findCountry(text)?.code ?? null) : null;
}

/** A list of places as a cell holds it: a posting in two cities (`jobLocation: [{…}, {…}]`). */
function isPlaceList(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.some(isRow);
}

/**
 * Where a posting is. A string as written; an object by its formatted text,
 * else its city, region and country; a schema.org `Place`, whose parts sit
 * one level down in `address`; and a list of places, each read as one and
 * their names joined — "Lisbon, Portugal; Porto, Portugal". A list used to
 * be no column at all, and a `Place` read as nothing (#403).
 */
function readPlace(value: unknown): { text: string; country: string | null } {
  if (isPlaceList(value)) {
    const places = value.filter(isRow).slice(0, MAX_PLACES).map(readPlace);
    const countries = new Set(places.flatMap((p) => p.country ?? []));
    // One country for all of them is the posting's country; two are a choice the text keeps.
    return { text: [...new Set(places.map((p) => p.text).filter((t) => t.length > 0))].join('; '), country: countries.size === 1 ? [...countries][0]! : null };
  }
  if (!isRow(value)) return { text: plainLine(value), country: null };
  const address = inner(value, ADDRESS_KEYS);
  const place = isRow(address) ? { ...value, ...address } : value;
  // A country may be a thing with a name of its own (`{ "@type": "Country", "name": "PT" }`).
  const named = (keys: readonly string[]): unknown => {
    const v = inner(place, keys);
    return isRow(v) ? inner(v, NAME_KEYS) : v;
  };
  const country = readCountry(named(COUNTRY_CODE_KEYS)) ?? readCountry(named(COUNTRY_NAME_KEYS));
  const parts = [plainLine(inner(place, CITY_KEYS)), plainLine(inner(place, REGION_KEYS)), country === null ? plainLine(named(COUNTRY_NAME_KEYS)) : placeLabel(country)].filter((p) => p.length > 0);
  const text = plainLine(inner(place, PLACE_TEXT_KEYS));
  // An address taken apart says more than the place's own name ("Head office").
  return { text: isRow(address) ? parts.join(', ') || text : text || parts.join(', '), country };
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

/** Signs that name one currency. "$" and "¥" name several, and are kept as the row wrote them. */
const SIGN_CODES: Readonly<Record<string, string>> = { '€': 'EUR', '£': 'GBP', '₴': 'UAH', '₹': 'INR', '₪': 'ILS', zł: 'PLN' };
/** An amount as people write it: a sign or a code before or after, "k" or "m" for thousands and millions. */
const MONEY_RE = /^(?<lead>[$€£¥₴₹₪]|[a-z]{3})?(?<digits>\d+(?:[.,]\d+)*)(?<scale>k|m)?(?<tail>[$€£¥₴₹₪]|zł|[a-z]{3})?$/i;
const SCALE: Readonly<Record<string, number>> = { k: 1_000, m: 1_000_000 };

interface Money {
  amount: number;
  /** The currency the cell itself names by code or by a sign only one currency uses. */
  currency: string | null;
  /** "$" or "¥", when that is all the cell says of the currency. */
  sign: string | null;
}

/**
 * An amount of money. A number is taken as it is; a text is read the way
 * amounts are written on both sides of the decimal comma: with both marks
 * the last one is the decimal ("90.000,50", "90,000.50"), and one mark
 * before exactly three final digits groups thousands ("65.000", "65,000") —
 * nobody pays to a tenth of a cent. A currency sign or code around the
 * digits and a "k" after them are part of how pay is written ("$90,000",
 * "90k", "€65.000", "65000 EUR"), not a reason to read nothing (#403).
 * Anything else — "DOE", a range in one cell — is not an amount here.
 */
function money(value: unknown): Money | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? { amount: Number(value.toFixed(2)), currency: null, sign: null } : null;
  const found = MONEY_RE.exec(cellText(value).replace(/[\s'_\u00A0\u202F]/g, ''));
  if (!found?.groups) return null;
  const { lead, digits: text = '', scale, tail } = found.groups;
  const marked = [lead, tail].filter((m): m is string => m !== undefined);
  // A word of three letters is a currency only when it is one: "90000 net" is not an amount in NET.
  if (marked.some((m) => /^[a-z]{3}$/i.test(m) && !isCurrencyCode(m))) return null;
  const mark = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','));
  const marks = text.replace(/\d/g, '');
  const grouped = marks.length > 0 && new Set(marks).size === 1 && /^\d{1,3}(?:[.,]\d{3})+$/.test(text);
  const digits = (part: string): string => part.replace(/[.,]/g, '');
  const n = (mark === -1 || grouped ? Number(digits(text)) : Number(`${digits(text.slice(0, mark))}.${text.slice(mark + 1)}`)) * (scale ? SCALE[scale.toLowerCase()]! : 1);
  if (!(n > 0)) return null;
  const code = marked.map((m) => (/^[a-z]{3}$/i.test(m) ? m.toUpperCase() : SIGN_CODES[m.toLowerCase()])).find((c) => c !== undefined) ?? null;
  return { amount: Number(n.toFixed(2)), currency: code, sign: code === null ? (marked.find((m) => m === '$' || m === '¥') ?? null) : null };
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
  const min = first(pick('salaryMin', PAY_MIN_KEYS), money);
  const max = first(pick('salaryMax', PAY_MAX_KEYS), money);
  if (min === null && max === null) {
    const text = clipText(oneLine(nested ? cellText(inner(nested, PAY_TEXT_KEYS)) : cellText(pay)), MAX_PAY_CHARS).replace(/[.\s]+$/, '');
    return text.length > 0 ? `Salary: ${text}.` : null;
  }
  // The currency column first; else what the amounts' own cells say.
  const currency = first(pick('salaryCurrency', PAY_CURRENCY_KEYS), (v) => (/^[A-Za-z]{3}$/.test(cellText(v)) ? cellText(v).toUpperCase() : null)) ?? min?.currency ?? max?.currency ?? null;
  const sign = currency === null ? (min?.sign ?? max?.sign ?? '') : '';
  const period = first(pick('salaryPeriod', PAY_PERIOD_KEYS), periodWord);
  const [low, high] = [min?.amount ?? null, max?.amount ?? null];
  const range = low !== null && high !== null && low !== high ? `${sign}${low}-${sign}${high}` : `${sign}${high ?? low}`;
  return `Salary: ${range}${currency ? ` ${currency}` : ''}${period ? ` (${period})` : ''}.`;
}

/** Whether a value could be this field at all — what lets a named column be passed over when its cells are something else. */
function fitsField(field: MappingField, value: unknown, now: Date): boolean {
  if (field === 'url' || field === 'applyUrl') return httpLink(value) !== null;
  if (field === 'postedAt') return readDate(value, now) !== null;
  return cellText(value).length > 0 || isRow(value) || (field === 'location' && isPlaceList(value));
}

/**
 * The columns a mapping can name, in the file's own order: every top-level
 * key, and the plain fields one level inside an object. A list of objects is
 * not a cell, and a column about a person is left out.
 */
export function columnsOf(rows: readonly Row[]): string[] {
  const sample = rows.slice(0, SAMPLE_ROWS);
  const out = new Set<string>();
  const add = (path: string): void => {
    if (path.length <= MAX_PATH_CHARS && !isPeopleColumn(path)) out.add(path);
  };
  for (const row of sample) {
    for (const [key, value] of Object.entries(row)) {
      // A list of objects is not a cell — except a posting's places, which the place reader takes whole.
      if (Array.isArray(value) && value.some(isRow)) {
        if (ALIASES.location.includes(norm(key))) add(key);
        continue;
      }
      add(key);
      if (!isRow(value) || Object.keys(value).length > MAX_NESTED_KEYS) continue;
      for (const [sub, nested] of Object.entries(value)) {
        if (!isRow(nested) && !Array.isArray(nested)) add(`${key}.${sub}`);
      }
    }
  }
  const all = [...out];
  // Of more columns than are offered, the ones named like a job's fields first, then the first of the rest.
  return keptColumns(all, knownColumn).map((i) => all[i]!).filter((column) => !holdsContacts(textsOf(sample, column)));
}

/** A column's non-empty cells as text; an object in a cell is not text. */
function textsOf(rows: readonly Row[], column: string): string[] {
  return rows
    .map((row) => valueAt(row, column))
    .filter((v) => !isRow(v))
    .map(cellText)
    .filter((t) => t.length > 0);
}

/** A column's first value, short enough for a table cell — what the preview shows beside its select. */
export function sampleValue(rows: readonly Row[], column: string): string {
  for (const row of rows.slice(0, SAMPLE_ROWS)) {
    const value = valueAt(row, column);
    const text = isRow(value) ? `{ ${Object.keys(value).filter((k) => !isPeopleColumn(k)).slice(0, 5).join(', ')} }` : isPlaceList(value) ? readPlace(value).text : oneLine(cellText(value));
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

/** Why a column cannot tell one posting from another: it counts the rows, its values repeat, or its numbers were too large to be read exactly. */
export type WeakId = 'rows' | 'repeats' | 'large';

/**
 * A column that counts 1, 2, 3 (or 0, 1, 2) down this many rows is a row
 * number. A run that starts anywhere else — 4100000001, 4100000002 — is what
 * a board's own ids look like when three postings went up one after another.
 */
const MIN_ROW_RUN = 3;

/**
 * Whether a column named like an id is one a re-export would keep (#403).
 * A row number names another posting once the sheet is sorted again — new
 * postings read "already stored" and old ones are added twice. Values that
 * repeat fold two postings into one. And a number past 2^53 lost its last
 * digits when the JSON was read: two postings arrive with the same id.
 * Read off the sample, like the rest of a mapping.
 */
export function weakId(rows: readonly Row[], column: string): WeakId | null {
  const values = rows
    .slice(0, SAMPLE_ROWS)
    .map((row) => valueAt(row, column))
    .filter((v): v is string | number => (typeof v === 'string' || typeof v === 'number') && cellText(v).length > 0);
  if (values.some((v) => typeof v === 'number' && Number.isInteger(v) && !Number.isSafeInteger(v))) return 'large';
  const texts = values.map(cellText);
  if (new Set(texts).size < texts.length) return 'repeats';
  const start = Number(texts[0]);
  const counts = texts.length >= MIN_ROW_RUN && (start === 0 || start === 1) && texts.every((t, i) => /^\d{1,9}$/.test(t) && Number(t) === start + i);
  return counts ? 'rows' : null;
}

/**
 * What the preview says beside the id: the column a mapping reads ids from
 * when it is a weak one (`used`), or the column named like an id that was
 * passed over for being weak. Null when there is nothing to say.
 */
export function idNote(rows: readonly Row[], mapping: Mapping): { column: string; why: WeakId; used: boolean } | null {
  if (mapping.id !== null) {
    const why = weakId(rows, mapping.id);
    return why === null ? null : { column: mapping.id, why, used: true };
  }
  const taken = new Set(MAPPING_FIELDS.map((f) => mapping[f]));
  const columns = columnsOf(rows);
  const named = ALIASES.id.flatMap((alias) => columns.filter((c) => norm(c) === alias)).find((c) => !taken.has(c));
  const why = named === undefined ? null : weakId(rows, named);
  return named === undefined || why === null ? null : { column: named, why, used: false };
}

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
      .map((column) => ({ column, texts: textsOf(sample, column) }))
      .filter((c) => c.texts.length > 0);
    const column = guess(free, sample.length, now);
    if (column === null) continue;
    claim(field, column);
    guessed.push(field);
  }
  // With a link to tell rows apart, a column that only looks like an id is passed over (#403). Decided here and
  // not in `mapRow`: a source keeps the mapping its rows were stored under, so what it already holds is still known.
  if (mapping.id !== null && (mapping.url !== null || mapping.applyUrl !== null) && weakId(sample, mapping.id) !== null) mapping.id = null;
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
/** What a posting has, by the mapper's own fields: its title first, then what tells it from any other thing with a name. */
const POSTING_FIELDS: readonly MappingField[] = ['title', 'url', 'applyUrl', 'description', 'employer', 'location', 'postedAt'];

/**
 * How much of a posting an object names: how many of a posting's own fields
 * it carries under a name the mapper knows, and 0 when it names no title.
 * Read off the names alone, as a mapping is detected. Two is a posting — a
 * title and one more thing; a stats file or a place with a name is less.
 */
export function postingFields(row: Row): number {
  const names = new Set(
    Object.keys(row)
      .filter((key) => row[key] !== null && row[key] !== undefined && row[key] !== '')
      .map(norm),
  );
  const has = (field: MappingField): boolean => ALIASES[field].some((alias) => names.has(alias));
  return has('title') ? POSTING_FIELDS.filter(has).length : 0;
}

/**
 * `findRows` for a caller that reads jobs: with the mapper's word on what a
 * posting is, so a posting that holds a list (its places, its skills) is one
 * row and not that list (#395).
 */
export function findJobRows(body: string, maxRows?: number, from?: number): RowsResult {
  return findRows(body, maxRows, from, postingFields, knownColumn);
}

/**
 * The date a row with none takes from its file: the file's own time, when
 * that can be a posting's date. A time ahead of the clock (a drive, a machine
 * set wrong) or before any posting (a file out of an archive, stamped 1980)
 * is no date, and such a row is dated now, as an uploaded one is.
 */
export function fileDate(mtimeMs: number, now: Date): Date {
  return mtimeMs > now.getTime() || mtimeMs < EARLIEST_POSTING ? now : new Date(mtimeMs);
}

/** `now` is the clock a stated date is held against; `undated` is what a row that states none takes — the same, unless the rows come from a file with a time of its own. */
export function mapRow(row: Row, mapping: Mapping, companyId: number, now: Date, undated: Date = now): MappedRow {
  const at = (field: MappingField): unknown => (mapping[field] === null ? undefined : valueAt(row, mapping[field]));
  if (isTrue(at('closed'))) return { dropped: 'closed' };
  const title = clipText(plainLine(at('title')), MAX_TITLE_CHARS).trim();
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
  const stated = readDate(at('postedAt'), now);

  return {
    thin,
    job: {
      companyId,
      externalId,
      title,
      // The apply link when the row has one on a host of its own; a link back
      // into a listing site is the listing, so the listing link stands.
      url: apply !== null && !isBlockedPostingHost(new URL(apply).hostname) ? apply : (listing ?? apply ?? ''),
      location: clipText(location, MAX_LOCATION_CHARS).trim(),
      description: [salaryLine(at), body, note].filter((part) => part !== null && part.length > 0).join('\n\n'),
      postedAt: stated ?? undated,
      // The import's time or the file's is not when the posting was published: nothing reads it as recent (#379).
      ...(stated === null && { undated: true }),
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

export function mapRows(rows: readonly Row[], mapping: Mapping, companyId: number, now: Date, undated: Date = now): MappedRows {
  const out: MappedRows = { jobs: [], dropped: { closed: 0, 'no-title': 0, 'no-identity': 0 }, repeated: 0, thin: 0 };
  const seen = new Set<string>();
  for (const row of rows) {
    const mapped = mapRow(row, mapping, companyId, now, undated);
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
