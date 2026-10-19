/*
 * The edits the suggestion cards can make to the resume text: replace a quoted
 * span, cut one, add a term to a skills line — and the inverse of any of them,
 * which is what Undo restores. Dependency-free ES module, no DOM — served
 * as-is and unit-tested from src/web/text-edits.test.ts.
 *
 * There is deliberately no "move this bullet to the top". 24 stored actions use
 * move/lead wording, and reading them shows the model means "make the first
 * bullet say this" — it quotes the leading bullet and proposes new words for
 * it, which is a replacement. A real move applied to only 4 of the 24.
 *
 * Every function is total: it returns either { text, span, change } — the
 * whole new text, where the edit landed (so the caller can outline it) and
 * exactly what it replaced (so Undo can put it back) — or { error }, never a
 * partial write and never a throw. Nothing here mutates.
 *
 * It lives beside target.mjs rather than inside it because the landing demo
 * ships a byte copy of that file (site-vendor.test.ts) and imports it in the
 * browser; this module is dashboard-only.
 */

import { locateQuote, findTerm } from './target.mjs';

/*
 * The contact line is protected: gotcha 11 is that removal quotes leak into it,
 * and 7 of the 237 quoted spans in the live corpus sit on the line carrying the
 * email and phone. These patterns, and LINK_RE below, are copied from
 * src/resume/parse-warnings.ts — a browser module cannot import TypeScript, so
 * they are kept in step by hand (text-edits.test.ts compares the two).
 */
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RUN_RE = /\+?\d[\d\s().\/-]{6,}\d/g;
/** A phone needs ≥9 digits in one run — "2022-2026" date ranges have 8. */
const PHONE_MIN_DIGITS = 9;

function isContactLine(line) {
  if (EMAIL_RE.test(line)) return true;
  return (line.match(PHONE_RUN_RE) ?? []).some((run) => (run.match(/\d/g) ?? []).length >= PHONE_MIN_DIGITS);
}

const LINK_RE = /(?:https?:\/\/|www\.)[^\s|·•,;]+|\b[\w-]+\.(?:com|dev|io|net|org|me|co)\/[^\s|·•,;]+/gi;

/**
 * Every email, phone and — beside one of those — link in a span, as written.
 * A copy of parse-warnings.ts:contactDetails, held equal by text-edits.test.ts.
 */
export function contactDetails(text) {
  const emails = text.match(new RegExp(EMAIL_RE.source, 'gi')) ?? [];
  const phones = (text.match(PHONE_RUN_RE) ?? []).filter((run) => (run.match(/\d/g) ?? []).length >= PHONE_MIN_DIGITS);
  const links = emails.length + phones.length === 0 ? [] : (text.match(LINK_RE) ?? []).map((l) => l.replace(/[.)]+$/, ''));
  return [...new Set([...emails, ...phones, ...links])];
}

/** Start of the line containing `index`. */
function lineStart(text, index) {
  return text.lastIndexOf('\n', index - 1) + 1;
}

/** End of the line containing `index`, not counting the newline. */
function lineEnd(text, index) {
  const next = text.indexOf('\n', index);
  return next === -1 ? text.length : next;
}

/** Every line the span [start, end) touches, as one string. */
function affectedLines(text, start, end) {
  return text.slice(lineStart(text, start), lineEnd(text, end));
}

// A bullet marker the edit must not eat when it replaces the words after it.
const BULLET = /^(\s*(?:[-•*·–—]|\d+[.)])\s+)/;

/** Wording without a bullet marker of its own. */
function unmarked(wording) {
  return String(wording).trim().replace(BULLET, '').trim();
}

/**
 * Replace the quoted span with `replacement`. The span is found the same way
 * the editor highlights it, so what gets replaced is what was outlined.
 * A leading bullet marker survives: the model quotes the sentence, not the "• ".
 * Refuses a wording that loses an email, a phone or a profile link the span
 * carried (gotcha 11); the separators between them may change.
 */
export function applyReplacement(text, quote, replacement) {
  const loc = locateQuote(text, quote);
  if (!loc) return { error: 'not-found' };
  if (typeof replacement !== 'string' || replacement.trim() === '') return { error: 'no-replacement' };
  const start = lineStart(text, loc.start);
  const marker = BULLET.exec(text.slice(start, loc.end));
  // Only when the quote swallowed the marker: otherwise it is already outside the span.
  const keep = marker && loc.start <= start + marker[1].length ? marker[1] : '';
  // The resume's own marker wins: a wording that brings a "- " of its own
  // came out as "• - Owned the backend" (measured on the live data).
  const onBullet = keep !== '' || (marker !== null && loc.start >= start + marker[1].length);
  const body = keep + (onBullet ? unmarked(replacement) : replacement.trim());
  const from = keep ? start : loc.start;
  // The gate refuses such a wording (replacement-gate.ts); a comparison stored
  // before it did, or a wording typed over the card, must not drop them either.
  if (contactDetails(text.slice(from, loc.end)).some((detail) => !body.includes(detail))) return { error: 'protected' };
  return {
    text: text.slice(0, from) + body + text.slice(loc.end),
    span: { start: from, end: from + body.length },
    change: { start: from, removed: text.slice(from, loc.end), inserted: body },
  };
}

/**
 * Cut the quoted span. When the quote is the whole line, the line goes with its
 * newline so no blank gap is left behind. Refuses on the contact line — dropping
 * a ZIP code there has taken the email with it before (gotcha 11).
 */
export function removeSpan(text, quote) {
  const loc = locateQuote(text, quote);
  if (!loc) return { error: 'not-found' };
  if (affectedLines(text, loc.start, loc.end).split('\n').some(isContactLine)) return { error: 'protected' };
  const start = lineStart(text, loc.start);
  const end = lineEnd(text, loc.end);
  const before = text.slice(start, loc.start);
  const after = text.slice(loc.end, end);
  // A quote of a bullet's words is the bullet: cutting only the words left a
  // lone "• " behind (measured on the live corpus, the formula bullet).
  const bareBefore = before.trim() === '' || before.replace(BULLET, '') === '';
  const wholeLine = bareBefore && after.trim() === '';
  let from = wholeLine ? start : loc.start;
  // Take the trailing newline with the line; at the end of the text take the leading one.
  let to = wholeLine ? (end < text.length ? end + 1 : end) : loc.end;
  if (!wholeLine) {
    // Part of a line: take the separator on the open side with it, so a cut
    // from a list leaves "Go, JavaScript" rather than "Go, , JavaScript", and
    // one at the start of a line leaves no space in front of it.
    // The last item of a list takes the separator before it: after it there is none.
    if (after.trim() === '' && !bareBefore) {
      while (from > start && SEPARATOR_CHAR.test(text[from - 1])) from--;
    } else if (bareBefore || SEPARATOR_AT.test(text.slice(from - 2, from)) || LABEL_AT.test(before)) {
      while (to < end && SEPARATOR_CHAR.test(text[to])) to++;
    }
  }
  const cutLeadingNewline = wholeLine && end >= text.length && from > 0;
  const at = cutLeadingNewline ? from - 1 : from;
  return {
    text: text.slice(0, at) + text.slice(to),
    span: { start: at, end: at },
    change: { start: at, removed: text.slice(at, to), inserted: '' },
  };
}

/** What stands between two items of a line — a cut takes one side's with it. */
const SEPARATOR_CHAR = /[\s,;·∙•|]/;
const SEPARATOR_AT = /[,;·∙•|]\s?$/;
/** A label before the cut ("Skills: ", "Tools — "): the first item goes with the separator after it. */
const LABEL_AT = /(?::|\s[–—])\s*$/;

/** The separators a skills line uses between terms, most specific first. */
const SEPARATORS = [' | ', ' · ', ' • ', '; ', ', '];

/**
 * Is this line a list of terms, rather than a bare label or a run of labels?
 * Measured need: on all six resumes in the live corpus the skills section is a
 * column of bare labels with the values stacked below, so appending to "the
 * line that says Programming" would write the term onto a label while the real
 * list sits further down.
 */
function termList(line) {
  const colon = line.indexOf(':');
  const body = (colon === -1 ? line : line.slice(colon + 1)).trim();
  if (body === '') return null;
  for (const sep of SEPARATORS) {
    const parts = body.split(sep).map((p) => p.trim());
    // Two real items, and no item that is itself another label.
    if (parts.length >= 2 && parts.every((p) => p !== '' && !p.endsWith(':'))) return { body, sep };
  }
  return null;
}

const SKILLS_HEADING = /skills|technolog|stack|competenc/i;
const HEADING_MAX = 60;
/** The section names a resume writes in ordinary case ("Technical Skills", "Experience:"). */
const HEADING_WORDS =
  /^(?:(?:key|core|technical|professional|relevant|work|career|employment)\s+)?(?:skills?(?:\s+(?:and|&)\s+tools)?|technologies|tech(?:nology)?\s+stack|competencies|expertise|summary|profile|experience|employment|history|education|projects|certifications?|languages|interests|awards|publications|references)$/i;
/** A role's dates ("2020 – Present"): a line carrying them is work history, never a skills line. */
const DATE_RANGE = /\b(?:19|20)\d{2}\s*[–—-]\s*(?:(?:[a-z]{3,9}\.?\s+|\d{1,2}[/.])?(?:19|20)\d{2}|present|current|now)\b/i;

/**
 * A line that opens a section: `## Skills`, a shouted line, or the whole line one
 * of the usual names. A bullet ("- Built full-stack checkout"), a job title
 * ("Senior Full-Stack Engineer") or a list is not one — the first walk read each
 * of those as a skills heading and wrote the keyword into a job's stack line.
 */
function isSectionHeading(line) {
  if (line.trim() === '' || line.length >= HEADING_MAX || BULLET.test(line) || termList(line)) return false;
  if (/^\s*#{1,6}\s/.test(line)) return true;
  const t = line.trim().replace(/\s*:$/, '');
  return (/\p{Lu}/u.test(t) && !/\p{Ll}/u.test(t)) || HEADING_WORDS.test(t);
}

/**
 * The families a skills section is usually split into: the words a line's label
 * uses for one, and the terms that belong to it. Not a taxonomy — enough to put
 * a keyword with no hint on "Cloud & DevOps" rather than on whichever list came
 * last (#576: Kubernetes, NoSQL, OAuth2 and JSON all landed under "Testing").
 */
const FAMILIES = [
  {
    label: /cloud|devops|infra|\bops\b|deploy/,
    terms: /\b(?:kubernetes|k8s|docker|containers?|terraform|helm|aws|gcp|azure|ansible|jenkins|ci\/cd|github actions|gitlab|circleci|argo\s?cd|nginx|linux|serverless|lambda|ecs|eks|cloudformation|pulumi|prometheus|grafana|datadog|openshift)\b/,
  },
  {
    label: /data|\bdbs?\b|storage|persistence|messaging/,
    terms: /sql|\b(?:postgres|mongo(?:db)?|redis|dynamodb|cassandra|elasticsearch|opensearch|kafka|rabbitmq|sqs|kinesis|snowflake|bigquery|redshift|spark|airflow|dbt|etl|clickhouse|prisma|typeorm|sequelize|orm)\b/,
  },
  {
    label: /\btest|\bqa\b|quality/,
    terms: /\btest|\b(?:jest|mocha|chai|vitest|jasmine|cypress|playwright|selenium|puppeteer|pytest|junit|rspec|phpunit|tdd|bdd|pact)\b/,
  },
  {
    label: /front|\bui\b|\bweb\b|client/,
    terms: /\b(?:react|vue(?:\.js)?|angular|svelte|next\.?js|nuxt|css3?|html5?|sass|scss|tailwind|redux|webpack|vite|jquery|storybook)\b/,
  },
  {
    label: /back|server|\bapis?\b/,
    terms: /\b(?:node(?:\.?js)?|express|nest(?:js)?|rest(?:ful)?|graphql|grpc|oauth\s?2?|openid|jwt|json|xml|soap|openapi|swagger|spring|django|flask|fastapi|rails|laravel|symfony|asp\.net|microservices?|websockets?)\b/,
  },
  {
    label: /language|programming/,
    terms: /\b(?:javascript|typescript|python|java|golang|go|rust|kotlin|swift|ruby|php|scala|elixir|erlang|haskell|clojure|perl|bash)\b/,
  },
  { label: /mobile|\bios\b|android/, terms: /\b(?:ios|android|react native|flutter|swiftui|xamarin)\b/ },
  { label: /security|\bauth/, terms: /\b(?:oauth|saml|sso|jwt|owasp|iam|keycloak|openid)/ },
];
/** A label that names the term's family outweighs one term of that family on the line. */
const LABEL_POINTS = 2;
/** A line that ends on its separator runs on into the next: appending there would split the list. */
const RUNS_ON = /[,;|·•]\s*$/;

/**
 * The list a term with no hint belongs on: the one whose label names the term's
 * family, or whose terms share it. With none, the last line that names no
 * family of its own — the only list, an "Others" or "Tools" line, the
 * unlabelled lines of one long list — and else null: the term then goes on a
 * line of its own (appendSkills), never on a line it has nothing to do with.
 */
function nearestList(lines, lists, term) {
  const targets = lists.filter((l) => !RUNS_ON.test(lines[l.i]));
  const families = FAMILIES.filter((f) => f.terms.test(term.toLowerCase()));
  const labelOf = (l) => {
    const colon = lines[l.i].indexOf(':');
    return colon === -1 ? '' : lines[l.i].slice(0, colon).toLowerCase();
  };
  const score = (l) =>
    families.reduce(
      (n, f) =>
        n +
        (f.label.test(labelOf(l)) ? LABEL_POINTS : 0) +
        l.body.split(l.sep).filter((item) => f.terms.test(item.toLowerCase())).length,
      0,
    );
  let best = null;
  let bestScore = 0;
  for (const l of targets) {
    const s = score(l);
    if (s > bestScore) [best, bestScore] = [l, s];
  }
  return best ?? targets.filter((l) => !FAMILIES.some((f) => f.label.test(labelOf(l)))).at(-1) ?? null;
}

/**
 * Add `term` to a skills line. Only ever writes inside a skills section: a term
 * list somewhere else is not a skills list, and the first walk of this shipped
 * appending a keyword to the contact line, which split on ", " into four parts
 * and passed for one. Returns `no-skills-list` when there is nothing safe to
 * write to — the caller must then not offer the button at all rather than offer
 * one that writes nonsense — and `no-fitting-line` when no list is the term's
 * (addKeywords gives it a line of its own). A term already present is a no-op.
 */
export function insertIntoSkills(text, term, where) {
  const clean = String(term ?? '').trim();
  if (clean === '') return { error: 'no-term' };
  if (findTerm(text, clean).length > 0) return { error: 'already-present' };

  const lines = text.split('\n');
  const lists = [];
  let underHeading = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const list = termList(line);
    // A bare label ("Programming:") is no heading and leaves the section open —
    // every stored resume stacks its labels that way; a role's dates close it.
    if (isSectionHeading(line)) underHeading = SKILLS_HEADING.test(line);
    else if (DATE_RANGE.test(line)) underHeading = false;
    if (list && underHeading && !isContactLine(line)) lists.push({ i, ...list });
  }
  if (lists.length === 0) return { error: 'no-skills-list' };

  // The hint names a category ("Key Skills, Programming line"); prefer a list whose label says so.
  const hint = String(where ?? '').toLowerCase();
  const hintWords = hint.match(/[a-z]{4,}/g) ?? [];
  const label = (i) => lines[i].toLowerCase().slice(0, lines[i].indexOf(':') + 1 || HEADING_MAX);
  const target = lists.find((l) => hintWords.some((w) => label(l.i).includes(w))) ?? nearestList(lines, lists, clean);
  if (!target) return { error: 'no-fitting-line' };

  const line = lines[target.i];
  const kept = line.replace(/\s*$/, '');
  lines[target.i] = kept + target.sep + clean;
  const lineAt = lines.slice(0, target.i).reduce((n, l) => n + l.length + 1, 0);
  const start = lineAt + kept.length + target.sep.length;
  return {
    text: lines.join('\n'),
    span: { start, end: start + clean.length },
    change: { start: lineAt + kept.length, removed: line.slice(kept.length), inserted: target.sep + clean },
  };
}

/** A work-history heading: where a skills section goes when the resume has none. */
const WORK_HEADING = /^(?:#{1,6}\s*)?(?:professional\s+)?(?:experience|employment|work history|career)\b/i;
/** A short line that opens the work history — not a summary sentence that starts with "Experience". */
const isWorkHeading = (line) => line.trim().length < HEADING_MAX && WORK_HEADING.test(line.trim());

/**
 * Add terms a skills line could not take as a line of their own: after the
 * last line of the skills section when there is one ("Also: Kafka, Redis"),
 * else as a skills section of their own before the work history, else at the
 * end. The resume's skills are sometimes a column of labels with nothing to
 * append to — and adding eight keywords one by one by hand was the complaint.
 */
export function appendSkills(text, terms) {
  const clean = [...new Set((terms ?? []).map((t) => String(t).trim()).filter(Boolean))].filter(
    (t) => findTerm(text, t).length === 0,
  );
  if (clean.length === 0) return { error: 'already-present' };
  const lines = text.split('\n');
  const heading = lines.findIndex((l) => isSectionHeading(l) && SKILLS_HEADING.test(l));
  let at;
  let insert;
  if (heading >= 0) {
    // The section runs to the next short line that is neither a list nor a label.
    at = heading;
    for (let i = heading + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === '' || isWorkHeading(l) || DATE_RANGE.test(l)) break;
      const isLabel = l.trimEnd().endsWith(':');
      if (!termList(l) && !isLabel && l.length < HEADING_MAX && /\p{Lu}/u.test(l) && !/\p{Ll}/u.test(l.replace(/^#+\s*/, ''))) break;
      at = i;
    }
    insert = [`Also: ${clean.join(', ')}`];
  } else {
    const work = lines.findIndex(isWorkHeading);
    at = work > 0 ? work - 1 : lines.length - 1;
    // A section of its own, set off by a blank line on either side like the rest.
    insert = [...(lines[at].trim() === '' ? [] : ['']), 'SKILLS', clean.join(', '), ...(work > 0 ? [''] : [])];
  }
  const before = lines.slice(0, at + 1).join('\n');
  const added = '\n' + insert.join('\n');
  return {
    text: before + added + text.slice(before.length),
    span: { start: before.length + 1, end: before.length + added.length },
    change: { start: before.length, removed: '', inserted: added },
  };
}

/**
 * Add `wording` as the line after the one the model anchored it to
 * (`insert_after`, stage 3). The anchor is found the way Locate finds it; the
 * new line takes the anchor's bullet marker unless the wording brought its own,
 * so a bullet added under a bullet reads as one of the list.
 */
export function insertAfterLine(text, anchor, wording) {
  const loc = locateQuote(text, anchor);
  if (!loc) return { error: 'not-found' };
  if (typeof wording !== 'string' || wording.trim() === '') return { error: 'no-replacement' };
  const end = lineEnd(text, loc.end);
  const anchorLine = text.slice(lineStart(text, loc.start), lineEnd(text, loc.start));
  const marker = BULLET.exec(anchorLine)?.[1] ?? '';
  // Under a bullet the new line takes the resume's marker, whatever the wording brought.
  const line = marker ? marker + unmarked(wording) : wording.trim();
  return {
    text: text.slice(0, end) + '\n' + line + text.slice(end),
    span: { start: end + 1, end: end + 1 + line.length },
    change: { start: end, removed: '', inserted: '\n' + line },
  };
}

/**
 * The smallest edit that turns `before` into `after`: the common prefix and
 * suffix are untouched, everything between them changed. Undo stores this
 * rather than a copy of the whole resume — it is one sentence, it survives a
 * reload in localStorage, and it says exactly what to put back.
 */
export function inverseEdit(before, after) {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  return {
    start: head,
    removed: before.slice(head, before.length - tail),
    inserted: after.slice(head, after.length - tail),
  };
}

/** Characters of the unchanged text kept either side of an edit, so Undo can find it after the text moved. */
const UNDO_CONTEXT = 32;

/**
 * An inverse edit that remembers what stood around it in `after`. Apply all
 * makes a dozen edits in a row, and every one above a card shifts the offsets
 * below it: an edit that only knew its offset could no longer be undone on its
 * own — and a removal, whose `inserted` is empty, would have put its text back
 * at the old offset, inside some other sentence.
 */
export function withContext(after, edit) {
  const end = edit.start + edit.inserted.length;
  const lead = after.slice(Math.max(0, edit.start - UNDO_CONTEXT), edit.start);
  const trail = after.slice(end, end + UNDO_CONTEXT);
  return {
    ...edit,
    lead,
    trail,
    // Whether one side alone told the place apart when it was recorded: a
    // stack line two roles share is no anchor, even if one of them changes later.
    leadUnique: occurrences(after, lead + edit.inserted) === 1,
    trailUnique: occurrences(after, edit.inserted + trail) === 1,
  };
}

function occurrences(text, needle) {
  if (needle.length === 0) return 0;
  let n = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) n++;
  return n;
}

/**
 * Put `edit.removed` back where `edit.inserted` still stands. Refuses when the
 * text has moved on, so Undo can never silently overwrite later typing. An
 * edit carrying its context (`withContext`) is found again when other edits
 * moved it — only where exactly one place in the text still reads so.
 */
export function undoEdit(text, edit) {
  const at = locateEdit(text, edit);
  if (at === null) return { error: 'moved-on' };
  const next = text.slice(0, at) + edit.removed + text.slice(at + edit.inserted.length);
  return { text: next, span: { start: at, end: at + edit.removed.length } };
}

/** Shortest run of text a relocated edit is found by; under this a match proves nothing. */
const MIN_NEEDLE = 12;

/**
 * Where `edit.inserted` stands now. An edit stored before context existed
 * knows only its offset. One with context is found at its offset when either
 * side still reads the same, else by its context: both sides, then each alone
 * — the neighbour Apply all changed next to it spoils one side, rarely both —
 * and only where exactly one place in the text matches.
 */
function locateEdit(text, edit) {
  const ins = edit.inserted;
  const at = edit.start;
  const insertedAt = text.slice(at, at + ins.length) === ins;
  if (edit.lead === undefined) return insertedAt ? at : null;
  const { lead, trail } = edit;
  // An empty side confirms nothing: at the end of the text, trail is '' everywhere.
  const leadAt = lead.length > 0 && at >= lead.length && text.slice(at - lead.length, at) === lead;
  const trailAt = trail.length > 0 && text.slice(at + ins.length, at + ins.length + trail.length) === trail;
  if (insertedAt && (leadAt || trailAt || (lead.length === 0 && trail.length === 0))) return at;
  const sides = [[lead, trail]];
  if (edit.leadUnique !== false) sides.push([lead, '']);
  if (edit.trailUnique !== false) sides.push(['', trail]);
  for (const [before, after] of sides) {
    const needle = before + ins + after;
    if (needle.length < MIN_NEEDLE) continue;
    const first = text.indexOf(needle);
    if (first !== -1 && text.indexOf(needle, first + 1) === -1) return first + before.length;
  }
  // No trail means the edit ended the text, no lead that it opened it — the
  // ends of the text are anchors of their own, but only once the context found
  // nothing: two last lines cut in a row and undone out of order came back
  // swapped when the end was asked first (a removal inserts '', which every
  // text ends with).
  if (trail.length === 0 && text.endsWith(ins)) return text.length - ins.length;
  if (lead.length === 0 && text.startsWith(ins)) return 0;
  return null;
}
