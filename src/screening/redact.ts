import type { MessageKey } from '../i18n/catalog';
import { t } from '../i18n/t';
import { storedReadNote } from '../resume/docx-text';

/*
 * Blind screening (ADR 0048): what is taken out of an applicant's resume
 * before a model reads it, and it cannot be switched off. Name, contact
 * details and links identify the person; date of birth, age, marital
 * status, children, gender, citizenship and a street address are the
 * protected characteristics hr-screening-plan.md §3.C lists — Ukrainian and
 * European CVs carry most of them in the header; religion and health are the
 * special-category data a DACH or Polish CV still states ("Konfession:",
 * "Stan zdrowia:" — TASKS E5); graduation years are an age proxy and the
 * score never reads them. The city stays: a location gate needs it. Pure —
 * text in, text and an audit out.
 *
 * Two shapes of removal: a whole field ("Date of birth: 12.05.1990") goes
 * as one SEGMENT of its line, split on the separators resumes use between
 * header items, so "Kyiv · born 1990 · married" keeps "Kyiv"; a pattern
 * inside prose (an email, a phone) is replaced in place. A line nothing was
 * taken from is left byte for byte as it was.
 *
 * JS's \b is ASCII-only, so every word edge here is spelled out with
 * Unicode classes — a Cyrillic field name has no \b to match.
 */

const REDACTION_KINDS = [
  'name',
  'email',
  'phone',
  'link',
  'birth',
  'age',
  'marital',
  'gender',
  'citizenship',
  'address',
  'religion',
  'health',
  'graduation',
] as const;
export type RedactionKind = (typeof REDACTION_KINDS)[number];

/** How the audit line names each kind: once (a person has one name), or with how many were removed. */
const REDACTION_WORDS: Record<RedactionKind, { once: MessageKey } | { counted: MessageKey }> = {
  name: { once: 'screening.redaction.name' },
  email: { counted: 'screening.redaction.email' },
  phone: { counted: 'screening.redaction.phone' },
  link: { counted: 'screening.redaction.link' },
  birth: { once: 'screening.redaction.birth' },
  age: { counted: 'screening.redaction.age' },
  marital: { counted: 'screening.redaction.marital' },
  gender: { once: 'screening.redaction.gender' },
  citizenship: { once: 'screening.redaction.citizenship' },
  address: { counted: 'screening.redaction.address' },
  religion: { once: 'screening.redaction.religion' },
  health: { once: 'screening.redaction.health' },
  graduation: { counted: 'screening.redaction.graduation' },
};

export interface Redaction {
  kind: RedactionKind;
  count: number;
}

export interface RedactedApplicant {
  /** What the model sees. */
  text: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  redactions: Redaction[];
}

/** Word edges in any script. */
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const word = (alternatives: string, flags = 'iu'): RegExp => new RegExp(`${B}(?:${alternatives})${E}`, flags);

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** A run of digits with the separators phones use; the callback keeps only runs of 9–15 digits, so a date or a ZIP stays. */
const PHONE_RUN = /\(?\+?\d[\d\s().\-]{6,}\d/g;
const PHONE_DIGITS = { min: 9, max: 15 };
const URL =
  /(?:https?:\/\/|www\.)[^\s<>"')\]]+|(?<![\w.])(?:linkedin\.com|github\.com|gitlab\.com|t\.me|telegram\.me|behance\.net|dribbble\.com|stackoverflow\.com|medium\.com|x\.com|twitter\.com|facebook\.com|instagram\.com)\/[^\s<>"')\]]+/gi;
/** Header separators, captured so a rewritten line keeps its own. */
const SEGMENT = /(\s*[·•|;,]\s*|\s+\/\s+)/;

const BIRTH = word(
  "date of birth|birth ?date|d\\.?\\s?o\\.?\\s?b\\.?|born(?: on| in)?|дата народження|рік народження|народи(?:вся|лася|лась)|д\\.н\\.|дата рождения|год рождения|родил(?:ся|ась)|geburtsdatum|geburtstag|geboren|data urodzenia|urodzon[ay]",
);
const AGE_FIELD = word('(?:age|вік|возраст|alter|wiek)\\s*[:：\\-–]?\\s*\\d{1,2}');
const AGE_WORDS = new RegExp(
  `${B}[1-6]\\d\\s*(?:years old|y\\.?\\s?o\\.?|роки|років|рік|лет|года|год|jahre alt|lat|lata)${E}(?!\\s*(?:of|досвід|опыт|experience|у |в |in ))`,
  'iu',
);
const MARITAL_FIELD = word('marital status|family status|сімейний стан|сімейний статус|семейное положение|familienstand|stan cywilny');
const MARITAL_WORD = new RegExp(
  `^(?:married|single|divorced|widowed|separated|одружен\\p{L}*|неодружен\\p{L}*|заміжня|незаміжня|розлучен\\p{L}*|женат|не женат|холост|замужем|не замужем|разведен\\p{L}*|verheiratet|ledig|geschieden|żonaty|zamężna|kawaler|panna)(?:\\s*[,(].*)?$`,
  'iu',
);
const CHILDREN = word('children|kids|діти|дітей|дитина|дети|детей|kinder|dzieci');
const GENDER_FIELD = word('(?:gender|sex|стать|пол|geschlecht|płeć)\\s*[:：\\-–]');
const GENDER_WORD = /^(?:male|female|чоловік|чоловіча|жінка|жіноча|мужской|женский|мужчина|женщина|männlich|weiblich|mężczyzna|kobieta)$/iu;
const CITIZENSHIP = word('citizenship|nationality|громадянство|національність|гражданство|национальность|staatsangehörigkeit|staatsbürgerschaft|obywatelstwo|narodowość');
/** A bare demonym next to a birth / family field is the citizenship line; alone it may be a language, and stays. */
const DEMONYM =
  /^(?:british|american|german|ukrainian|polish|french|italian|spanish|dutch|indian|canadian|irish|swiss|austrian|czech|romanian|turkish|georgian|belarusian|kazakh|moldovan|lithuanian|latvian|estonian|portuguese|brazilian|nigerian|pakistani|chinese|japanese|korean|vietnamese|filipino|mexican|australian|swedish|norwegian|danish|finnish|greek|hungarian|bulgarian|serbian|croatian|slovak|slovenian|belgian|eu citizen|українець|українка|поляк|полька|німець|громадянин \S+)$/iu;
/**
 * A street needs its number next to it — "22 Baker Street", "вул. Хрещатик 22"
 * — and a unit its number right after: "Suite 200", "кв. 14". Measured on the
 * first live batch: a looser "street word, then a number within four words"
 * took "Built the Playwright end-to-end suite for 40 microservices" for an
 * address and removed the applicant's best bullet.
 */
const STREET_WORDS =
  'вул\\.?|вулиця|просп\\.?|проспект|бульв\\.?|бульвар|пров\\.?|провулок|ул\\.?|улица|пр-т|ulica|ul\\.|street|st\\.|avenue|ave\\.|road|rd\\.|lane|ln\\.|boulevard|blvd\\.?';
/** A street word on its own, or the German suffix form ("Musterstraße", "Hauptstr."). */
const STREET_TOKEN = `(?:${B}(?:${STREET_WORDS})${E}|\\p{L}+(?:straße|strasse|str\\.))`;
/** A house number: then a separator or the end of the segment — "road to 5 nines" has neither. */
const HOUSE_NUMBER = `\\d{1,4}[a-z]?(?=\\s*(?:[,;·•|/]|$))`;
const STREET = new RegExp(
  `(?:^\\d{1,4}[a-z]?,?\\s+(?:[\\p{L}'’.-]+\\s+){0,2}${STREET_TOKEN})|(?:${STREET_TOKEN}\\s*(?:[\\p{L}'’.-]+\\s+){0,2}${HOUSE_NUMBER})`,
  'iu',
);
const UNIT = word('(?:apt\\.?|apartment|suite|ste\\.?|кв\\.?|квартира|буд\\.?|д\\.)\\s*#?\\s*\\d{1,5}[a-z]?');
/**
 * Religion and health go only in the shape of a field — a name and a colon,
 * no word edge after it ("Religion:Catholic" has no space). The words alone
 * name products, domains and employers ("Health tech", "Christian Dior"), and
 * a bare "Health:" can open a line of domain skills, so the health fields are
 * the ones only a personal-data block uses.
 */
const field = (names: string): RegExp => new RegExp(`${B}(?:${names})\\s*[:：]`, 'iu');
const RELIGION_FIELD = field(
  "religion|religious affiliation|віросповідання|релігія|конфесія|вероисповедание|религия|конфессия|konfession|religionszugehörigkeit|glaubensbekenntnis|wyznanie|religia",
);
/** A bare faith next to a birth / family field is the religion line, as a bare demonym is the citizenship one. */
const RELIGION_WORD =
  /^(?:(?:roman |römisch-)?(?:catholic|katholisch)|orthodox|protestant|evangelisch|christian|muslim|jewish|hindu|buddhist|atheist|православн\p{L}*|католи\p{L}*|протестант\p{L}*|мусульман\p{L}*|іуде\p{L}*|иуде\p{L}*|katoli\p{L}*|prawosławn\p{L}*|muzułman\p{L}*)$/iu;
const HEALTH_FIELD = field(
  "health status|state of health|medical condition|disability|disabilities|стан здоров['’]я|інвалідність|состояние здоровья|инвалидность|gesundheitszustand|behinderung|schwerbehinderung|grad der behinderung|stan zdrowia|niepełnosprawność",
);
const BARE_YEAR = /(?<![\d.])(?:19[6-9]\d|20[0-4]\d)(?![\d.])/g;
const DATE_RANGE = /((?:\p{L}{3,10}\.?\s*)?(?:19|20)\d\d)\s*[–—-]\s*((?:\p{L}{3,10}\.?\s*)?(?:19|20)\d\d|present|current|дотепер|зараз|heute|obecnie)/giu;
/** An education heading, in the languages the corpus writes them. */
const EDUCATION_HEADING = /^#*\s*(?:education|academic|qualifications|освіта|образование|ausbildung|bildung|wykształcenie|edukacja)\b/iu;
const DEGREE_LINE = word('bsc|msc|b\\.s\\.|m\\.s\\.|ba|ma|phd|bachelor\\p{L}*|master\\p{L}*|бакалавр\\p{L}*|магістр\\p{L}*|магистр\\p{L}*|спеціаліст|diplom\\p{L}*|licencjat|magister|inżynier');
const HEADING = /^(?:#+\s+\S|[\p{Lu}\s&/,-]{4,44}$)/u;

/** Words a first line can carry and still not be a name. */
const NOT_A_NAME = word('resume|cv|curriculum|vitae|engineer|developer|manager|designer|analyst|architect|specialist|consultant|lead|senior|junior|intern|розробник|інженер|резюме');
const NAME_FIELD = /^(?:name|full name|ім'?я|піб|прізвище|фио|имя)\s*[:：]\s*(.+)$/iu;

/** The header line that is the applicant's name, if the text opens with one. */
export function detectName(text: string): string | null {
  const lines = text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).filter((l) => l.length > 0);
  for (const line of lines.slice(0, 6)) {
    const field = NAME_FIELD.exec(line);
    if (field?.[1]) return field[1].trim();
  }
  const first = lines[0];
  if (!first) return null;
  const candidate = first.split(SEGMENT)[0]?.trim() ?? '';
  const words = candidate.split(/\s+/);
  if (words.length < 2 || words.length > 4 || candidate.length > 48) return null;
  if (/[\d@]/.test(candidate) || NOT_A_NAME.test(candidate)) return null;
  if (!words.every((w) => /^\p{Lu}[\p{L}'’.-]*$/u.test(w))) return null;
  return candidate;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word occurrences of `form`, any whitespace between its words. */
function nameRe(form: string): RegExp {
  return new RegExp(`${B}${escape(form).replace(/\s+/g, '\\s+')}${E}`, 'gu');
}

function digitsOf(s: string): number {
  return s.replace(/\D/g, '').length;
}

function isPhone(run: string): boolean {
  const n = digitsOf(run);
  return n >= PHONE_DIGITS.min && n <= PHONE_DIGITS.max;
}

/**
 * The applicant's resume with the person taken out. `number` is the only
 * identity the model gets — "Applicant №12" replaces the name wherever it
 * stands, including a surname alone or the name reversed.
 */
export function redactApplicant(text: string, number: number): RedactedApplicant {
  const counts = new Map<RedactionKind, number>();
  const count = (kind: RedactionKind, n = 1): void => {
    if (n > 0) counts.set(kind, (counts.get(kind) ?? 0) + n);
  };
  const label = `Applicant №${number}`;
  let out = text.replace(/\r\n/g, '\n');

  const name = detectName(out);
  const email = out.match(EMAIL)?.[0] ?? null;
  const phone = (out.match(PHONE_RUN) ?? []).find(isPhone)?.trim() ?? null;

  out = out
    .split('\n')
    .map((line) => dropFields(line, count))
    .join('\n');
  out = stripGraduationYears(out, (n) => count('graduation', n));

  out = out.replace(EMAIL, () => (count('email'), '[email removed]'));
  out = out.replace(URL, () => (count('link'), '[link removed]'));
  out = out.replace(PHONE_RUN, (run) => (isPhone(run) ? (count('phone'), '[phone removed]') : run));

  if (name) {
    const parts = name.split(/\s+/).filter((p) => p.replace(/[.'’-]/g, '').length >= 2);
    const forms = [name, [...parts].reverse().join(' '), ...parts.filter((p) => p.replace(/[.'’-]/g, '').length >= 3)];
    // A hyphenated surname is also its halves.
    for (const p of parts) for (const half of p.split('-')) if (half.length >= 4 && !forms.includes(half)) forms.push(half);
    for (const form of forms) out = out.replace(nameRe(form), () => (count('name'), label));
    out = out.replace(new RegExp(`(?:${escape(label)}\\s*){2,}`, 'g'), label);
  }

  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return {
    // The name line, once replaced, already opens the text with the label.
    text: out.replace(/^#+\s*/, '').startsWith(label) ? out : `${label}\n\n${out}`,
    name,
    email,
    phone,
    redactions: REDACTION_KINDS.filter((k) => counts.has(k)).map((k) => ({ kind: k, count: counts.get(k)! })),
  };
}

/** A line with its protected segments removed — or the line itself, untouched, when it has none. */
function dropFields(line: string, count: (kind: RedactionKind) => void): string {
  const pieces = line.split(SEGMENT);
  const segments = pieces.filter((_, i) => i % 2 === 0);
  const kinds = segments.map((s) => fieldKind(s));
  // A demonym or a faith alone is only citizenship or religion beside a birth or family field.
  const identityLine = kinds.some((k) => k === 'birth' || k === 'marital' || k === 'gender' || k === 'citizenship' || k === 'religion');
  segments.forEach((s, i) => {
    if (kinds[i] !== null || !identityLine) return;
    if (DEMONYM.test(s.trim())) kinds[i] = 'citizenship';
    else if (RELIGION_WORD.test(s.trim())) kinds[i] = 'religion';
  });
  if (kinds.every((k) => k === null)) return line;
  if (segments.length === 1) {
    count(kinds[0]!);
    return '';
  }
  let outLine = '';
  let pendingSep = '';
  segments.forEach((s, i) => {
    const sep = i === 0 ? '' : (pieces[i * 2 - 1] ?? '');
    const kind = kinds[i];
    if (kind) {
      count(kind);
      return;
    }
    outLine += (outLine === '' ? '' : sep || pendingSep) + s;
    pendingSep = sep;
  });
  return outLine;
}

/** Which protected field a header segment is, or null when it is ordinary text. */
function fieldKind(segment: string): RedactionKind | null {
  const s = segment.trim();
  if (s.length === 0) return null;
  if (BIRTH.test(s)) return 'birth';
  if (AGE_FIELD.test(s) || AGE_WORDS.test(s)) return 'age';
  if (MARITAL_FIELD.test(s) || MARITAL_WORD.test(s) || CHILDREN.test(s)) return 'marital';
  if (GENDER_FIELD.test(s) || GENDER_WORD.test(s)) return 'gender';
  if (CITIZENSHIP.test(s)) return 'citizenship';
  if (RELIGION_FIELD.test(s)) return 'religion';
  if (HEALTH_FIELD.test(s)) return 'health';
  if (STREET.test(s) || UNIT.test(s)) return 'address';
  return null;
}

/**
 * Blank the years on the education lines: everything under an education
 * heading until the next heading, plus any line naming a degree. A role's
 * dates elsewhere are what the years part reads and stay.
 */
function stripGraduationYears(text: string, onCount: (n: number) => void): string {
  const lines = text.split('\n');
  let removed = 0;
  let inEducation = false;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return line;
    if (EDUCATION_HEADING.test(trimmed)) {
      inEducation = true;
      return line;
    }
    if (inEducation && HEADING.test(trimmed) && !DATE_RANGE.test(trimmed)) {
      DATE_RANGE.lastIndex = 0;
      inEducation = false;
    }
    DATE_RANGE.lastIndex = 0;
    if (!inEducation && !DEGREE_LINE.test(trimmed)) return line;
    let next = line.replace(DATE_RANGE, () => (removed++, '[years removed]'));
    next = next.replace(BARE_YEAR, () => (removed++, '[year removed]'));
    return next;
  });
  onCount(removed);
  return out.join('\n');
}

/**
 * What still identifies the person after redaction — the leak test, run on
 * every applicant at intake and logged. Empty is the only acceptable answer.
 */
export function findLeaks(redacted: string, identity: { name: string | null; email: string | null; phone: string | null }): string[] {
  const leaks: string[] = [];
  const body = redacted.replace(/^Applicant №\d+\n/, '');
  if (new RegExp(EMAIL.source).test(body)) leaks.push('email');
  if (new RegExp(URL.source, 'i').test(body)) leaks.push('link');
  if (identity.phone) {
    const digits = identity.phone.replace(/\D/g, '');
    if (digits.length >= PHONE_DIGITS.min && body.replace(/\D/g, '').includes(digits)) leaks.push('phone');
  }
  if (identity.name) {
    for (const part of identity.name.split(/\s+/)) {
      if (part.replace(/[.'’-]/g, '').length >= 3 && new RegExp(nameRe(part).source, 'u').test(body)) leaks.push(`name:${part}`);
    }
  }
  return leaks;
}

/** A leak entry without the part of the person it names: "name:Petrenko" is "name". */
export function leakKinds(leaks: string[]): string[] {
  return [...new Set(leaks.map((l) => l.split(':')[0]!))];
}

/**
 * The row's note while it is held (TASKS E4): what the leak check found, never
 * the text it found. Stored, and exported, in English; `noteWords` words it on a page.
 */
export function heldNote(kinds: string[]): string {
  return `Held for a look: after redaction the leak check still found ${kinds.join(', ')}.`;
}

const HELD_NOTE = /^Held for a look: after redaction the leak check still found (.+)\.$/s;

const LEAK_WORDS: Record<string, MessageKey> = {
  name: 'screening.leak.name',
  email: 'screening.leak.email',
  phone: 'screening.leak.phone',
  link: 'screening.leak.link',
};

/** A leak kind ("name", "email") or a whole entry ("name:Petrenko") in the reader's language. */
export function leakLabel(leak: string): string {
  const [kind = '', ...part] = leak.split(':');
  const word = Object.hasOwn(LEAK_WORDS, kind) ? t(LEAK_WORDS[kind]!) : kind;
  return part.length > 0 ? t('screening.leak.withPart', { kind: word, part: part.join(':') }) : word;
}

/** A stored applicant note as a page shows it: the held note worded, any other note (a reader's error) as stored. */
export function noteWords(note: string): string {
  const held = HELD_NOTE.exec(note);
  if (held) return t('screening.heldNote', { kinds: held[1]!.split(', ').map(leakLabel).join(', ') });
  // A file that gave no text keeps the reader's failure as its note, in English (resume/docx-text.ts).
  return storedReadNote(note) ?? note;
}

/** Reader for the stored `redactions` column. */
export function readRedactions(value: unknown): Redaction[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (r): r is Redaction =>
      typeof r === 'object' && r !== null && (REDACTION_KINDS as readonly string[]).includes((r as Redaction).kind) && typeof (r as Redaction).count === 'number',
  );
}

/** "name, 1 email, 1 phone, 2 links, date of birth" — the audit line on the scorecard. */
export function describeRedactions(redactions: Redaction[]): string {
  if (redactions.length === 0) return t('screening.redaction.nothing');
  return redactions
    .map((r) => {
      const words = REDACTION_WORDS[r.kind];
      return 'once' in words ? t(words.once) : t(words.counted, { n: r.count });
    })
    .join(', ');
}
