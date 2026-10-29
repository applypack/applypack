/*
 * The gate between the model's replacement wording and the Apply button
 * (ADR 0037). The model proposes; this decides, at persist time and in code,
 * whether a proposal may be applied with one press or has to stay a question.
 * Pure — the sources arrive as arguments, match.ts and suggestions.ts load them.
 *
 * Three checks, each measured on the 108 wordings the model had written before
 * the field existed (branch pre-work note):
 *  - factCheck, exactly as the cover letter runs it — resume, posting and
 *    confirmed facts as sources. The posting is a source on purpose: without it
 *    "B2B SaaS" and "East Coast hours" block as invented employers, and with it
 *    no metric from the posting became supported (0 of 108).
 *  - a replacement may not INTRODUCE a keyword marked cannot_claim for this
 *    posting. factCheck reads tool claims only against CandidateFacts, so a
 *    PHP resume proposing "Node.js services" passes it; this is the honest rule
 *    for that case. One exemption, added with ADR 0044: the posted job title
 *    (priority 2) on the resume's own title line, which names the role being
 *    applied for rather than one already held — blocking it made the single
 *    highest-leverage edit unreachable on every retitle.
 *  - KEEP WANTED KEYWORDS in code: a replacement that loses a must-have or
 *    primary keyword the quote had is blocked (the score reads exactly those);
 *    a lost nice-to-have or a paraphrased phrase keeps the wording and gets a
 *    note, because 11 of the 21 as-specified drops were wrong. A term the
 *    resume still carries OUTSIDE the quoted span is not lost at all and only
 *    warns — the rule as written blocked a good rewrite of a bullet whose one
 *    "SQL" was the phrase "SQL injection".
 *
 *  - a rewrite of the contact line keeps every email, phone and profile link
 *    as written, as a removal may not touch them (gotcha 11): a title action
 *    once quoted the whole line, and a replacement that loses one is refused.
 *
 *  - wording that is a note to the writer and not resume text is refused
 *    (`instructionIn`): the prompt sends "ask the candidate for the real
 *    number" to `why`, and the model still writes it, or a slot to fill in,
 *    into the wording itself — one press then put that sentence in the resume.
 *
 *  - a true figure told about other work is refused (#632): factCheck proves
 *    the number is in the resume, `detachedFigures` that the wording keeps it
 *    with the work its own line names. A summary that "ran on-call for systems
 *    serving 1.8M requests/day" took the figure of the dispatch API bullet and
 *    the words of the runbooks one, and the letter written next repeated it.
 *
 *  - keyword stuffing is refused (#633). One comparison wrote JavaScript, SQL
 *    and JSON onto the skills line and then into four bullets ("a PostgreSQL
 *    SQL database", "Node.js, TypeScript, and JavaScript"), and Apply all took
 *    every one. So a bullet rewrite that writes in a term the resume never
 *    writes (an `add` the candidate did not confirm: implied by the line, as
 *    the model's own note says) is refused when it changes nothing else, or
 *    lists the term beside another name — that term goes on the skills line,
 *    or into a bullet whose new words describe the work that used it. The
 *    live check's "Node.js, JavaScript, and TypeScript, exchanging JSON …
 *    with p95 latency" had one word of its own and passed the first test
 *    alone. And a term the resume does not yet show in a
 *    sentence goes into ONE bullet per report: the score reads its best line,
 *    so a second bullet earns nothing and reads as stuffing.
 *
 * A blocked action keeps everything but its replacement, which becomes an
 * explicit null — proposalOf reads that as "judged, do not parse `what`".
 *
 * `gateRemovals` is the same idea over the delete list, and it exists because
 * the prompt rule alone did not hold: gotcha 11's second lesson was paid for
 * once with prompt text ("PROTECTED contact line", "KEEP WANTED KEYWORDS"),
 * and the model broke it again — a skills line quoted whole to advise dropping
 * three of its six frameworks, with React (must, primary) and Vue.js (must)
 * inside the struck-through span. A removal quote is what the editor deletes
 * with one press, so the two rules are code now:
 *  - the quote may not carry the contact line's email or phone;
 *  - the quote may not carry a keyword this posting wants and this resume has
 *    — a must or primary one blocks, anything lighter warns, exactly as a
 *    replacement that drops the same keyword does;
 *  - nor may it take a whole labelled line that is what SHOWS such a keyword
 *    without spelling it: eleven tools under "AI / LLM Automation" are the
 *    evidence for "AI tooling", and one press deleted them while the term
 *    was written onto another line with nothing behind it (#350).
 * A blocked removal keeps its advice and loses its `quote`: nothing is
 * highlighted, nothing is deletable in one press, and `why` says why.
 */

import { factCheck, workWords } from './fact-check';
import type { FactLike } from './facts';
import { effectiveRequirement } from './keyword-overrides';
import type { KeywordMatcher } from './keyword-matcher';
import { contactDetails, hasContactDetail } from './parse-warnings';
import { toPlainPunctuation, type MatchAction, type MatchKeyword, type MatchRemoval } from './prompts';

export interface GateSources {
  resumeText: string;
  /** Title + description: vocabulary the candidate is entitled to use. */
  posting: string;
  /** Every CandidateFact — confirmed ones support a claim, denied ones contradict it. */
  facts: FactLike[];
  /** This comparison's keywords, with their statuses and levels. */
  keywords: MatchKeyword[];
  matcher: Pick<KeywordMatcher, 'findTerm'>;
}

export interface GateReport {
  actions: MatchAction[];
  blocked: number;
  warned: number;
}

export interface GateOptions {
  /** The rest of the report, already gated: the terms its wordings write in are taken (rewrite.ts). */
  alongside?: MatchAction[];
}

export interface RemovalGateReport {
  removals: MatchRemoval[];
  /** Quotes nulled: the advice stayed, the one-press delete did not. */
  blocked: number;
  warned: number;
}

const BLOCK_NOTE = ' · not applied — ';
const WARN_NOTE = ' · check: ';

/**
 * A refused wording's reason, read back off `why`: the gate writes it there and
 * nowhere else, so a stored row carries it too. `refusal` is null when the
 * action was not refused, and `why` is then returned whole.
 */
export function splitRefusal(action: Pick<MatchAction, 'why' | 'replacement'>): { why: string; refusal: string | null } {
  const at = action.why.indexOf(BLOCK_NOTE);
  if (action.replacement !== null || at < 0) return { why: action.why, refusal: null };
  return { why: action.why.slice(0, at), refusal: action.why.slice(at + BLOCK_NOTE.length) };
}

/**
 * Whether the gate let this wording through with a note for the person to
 * check (" · check: …" on `why`). On the Tailor page they read it on the card
 * before pressing Apply; anything that applies with nobody reading asks here.
 * Only the first note is written, so one about a dropped term can stand in
 * front of one about a skill nobody confirmed: every note counts.
 */
export function hasCheckNote(item: { why: string }): boolean {
  return item.why.includes(WARN_NOTE);
}

/** Whether the gate refused the item: its wording, or a removal's span — the reason is on `why`. */
export function wasRefused(item: { why: string }): boolean {
  return item.why.includes(BLOCK_NOTE);
}

/**
 * What gives a note to the writer away. Each is something a resume line does
 * not say: a request to the candidate, a slot left to fill in, a question.
 * Kept narrow on purpose — "N+1 queries", "(check processing)", "(insert,
 * update, delete)" and "add-on" are resume text.
 */
const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bask(?:ing)? (?:the |your )?(?:candidate|applicant|user)\b/gi,
  /\b(?:confirm|check|verify) with (?:the )?(?:candidate|applicant|user)\b/gi,
  /\b(?:candidate|applicant) (?:to|should|must|needs to) (?:confirm|provide|supply|add|fill|specify|verify)\b/gi,
  /\bif (?:yes|so|true|applicable),? (?:add|include|mention|describe)\b/gi,
  // A parenthesis that opens with an order: "(confirm which role used JIRA)", "(add your real number)".
  /\((?:ask\b|(?:confirm|verify|specify|check) (?:the|which|whether|if|your|with|this|that)\b|fill in\b|add (?:your|the real|a real|real|actual)\b|replace with\b)[^)]*\)?/gi,
  // A slot: "[add your real number]", "[X]", "[company]".
  /\[[^[\]\n]+\]/g,
  /\b(?:TBD|TODO)\b/g,
  // Placeholder figures: "XX%", "$XXk", "from Xs to Ys" (the brief's own shapes use these letters).
  /\bX{1,3}\s?%|[$€£]X+\w?\b|\bXX+\b|\bN\s?%|\bfrom X\w{0,2} to Y\w{0,2}\b/g,
];
/** A resume line never asks. Not the "?" of an address: that one has no space after it. */
const QUESTION_MARK = /\?(?=\s|$)/g;

/**
 * The span that makes a wording a note to the writer instead of resume text,
 * or null. A span the quoted line already carried is the candidate's own text
 * and is never held against the rewrite.
 */
export function instructionIn(wording: string, quote = ''): string | null {
  for (const pattern of INSTRUCTION_PATTERNS) {
    for (const [found] of wording.matchAll(pattern)) {
      if (!quote.includes(found)) return found.trim();
    }
  }
  for (const { index } of wording.matchAll(QUESTION_MARK)) {
    const from = Math.max(wording.lastIndexOf('. ', index), wording.lastIndexOf('\n', index)) + 1;
    const question = wording.slice(from, index + 1).trim();
    if (!quote.includes(question)) return question;
  }
  return null;
}

/** Confirmed facts as lines the fact check can index — the same shape the cover letter feeds it. */
function factLines(facts: FactLike[]): string[] {
  return facts
    .filter((f) => f.status === 'confirmed')
    .map((f) => (f.note ? `${f.term} — ${f.note}` : f.term));
}

/**
 * Words a rewrite adds to wedge a term in, saying nothing new about the work:
 * "serving JSON over a PostgreSQL SQL database", "SQL-backed PostgreSQL storage".
 */
const WEDGE_WORDS = new Set([
  'database', 'storage', 'store', 'backed', 'based', 'powered', 'driven', 'data', 'format', 'payload',
  'layer', 'backend', 'back-end', 'exchanging', 'exchange', 'consuming', 'leveraging', 'involving',
  'including', 'featuring', 'environment', 'technology', 'tooling', 'framework', 'language', 'skill',
  'endpoint', 'modern', 'robust', 'scalable', 'efficient', 'reliable',
]);

/** A term the resume does not yet show in a sentence: one bullet per report may write it in. */
const unwritten = (k: MatchKeyword) => k.status === 'add' || (k.status === 'present' && k.evidence === 'listed');
/** An `add` the candidate never confirmed: the model read it off the text as implied ("PostgreSQL work demonstrates SQL"). */
const impliedOnly = (k: MatchKeyword) => k.status === 'add' && !k.note?.startsWith('user-confirmed');

const PRIORITY_RANK: Record<MatchAction['priority'], number> = { high: 0, medium: 1, low: 2 };
/** Where an implied term belongs instead, said on both refusals. */
const IMPLIED_HOME = 'a term the resume implies but never names goes on the skills line, or into a bullet whose own words show the work that used it';

/** A name by its shape alone: "PostgreSQL", "Node.js", "AWS", "C#" — a capital inside it, a dot, plus or hash, or capitals throughout. */
const NAME_SHAPE = /^(?:\p{L}+\p{Lu}[\p{L}\p{N}.+#-]*|[\p{L}\p{N}]*[.+#][\p{L}\p{N}.+#]*|\p{Lu}{2,}[\p{L}\p{N}-]*)$/u;
/** A capitalised word is a name too, unless it opens the sentence ("Wrote SQL schema…"). */
const CAPITALISED = /^\p{Lu}/u;
/** What stands between two names in a list: "Node.js, TypeScript, and JavaScript". */
const LIST_JOINERS = new Set(['and', 'or', 'a', 'an', 'the']);

/**
 * The name a term is listed beside, or null: the nearest word on either side,
 * past list punctuation, the joiners and the wedge words ("SQL-backed
 * PostgreSQL storage"), when it is a name too. A term beside the name that
 * implies it ("a PostgreSQL SQL database") is that name said twice.
 */
function listedBeside(text: string, k: MatchKeyword, matcher: GateSources['matcher']): string | null {
  const words = [...text.matchAll(/[^\s,;/&+()]+/g)].map((m) => ({ word: m[0].replace(/^-+|-+$/g, ''), at: m.index }));
  const opensSentence = (at: number) => {
    const head = text.slice(0, at).trimEnd();
    return head === '' || /[.!?:]$/.test(head);
  };
  const nearest = (side: typeof words): string | null => {
    for (const { word, at } of side) {
      const lower = word.toLowerCase();
      if (word === '' || LIST_JOINERS.has(lower) || WEDGE_WORDS.has(lower) || WEDGE_WORDS.has(lower.replace(/s$/, ''))) continue;
      return NAME_SHAPE.test(word) || (CAPITALISED.test(word) && !opensSentence(at)) ? word : null;
    }
    return null;
  };
  for (const span of matcher.findTerm(text, k.term, k.aliases ?? [])) {
    const before = words.filter((w) => w.at + w.word.length <= span.start).reverse();
    const after = words.filter((w) => w.at >= span.end);
    const name = nearest(before) ?? nearest(after);
    if (name !== null) return name;
  }
  return null;
}

/** With every term it writes in taken out, does the rewrite say only what the quoted line said? */
function onlyWritesIn(quote: string, text: string, terms: MatchKeyword[], matcher: GateSources['matcher']): boolean {
  const spans = terms.flatMap((k) => matcher.findTerm(text, k.term, k.aliases ?? [])).sort((a, b) => b.start - a.start);
  let rest = text;
  let floor = Infinity;
  for (const span of spans) {
    if (span.end > floor) continue;
    rest = `${rest.slice(0, span.start)} ${rest.slice(span.end)}`;
    floor = span.start;
  }
  const had = workWords(quote);
  return [...workWords(rest).keys()].every((w) => had.has(w) || WEDGE_WORDS.has(w));
}

export function gateActions(actions: MatchAction[], sources: GateSources, options: GateOptions = {}): GateReport {
  const hits = (text: string, k: MatchKeyword) => sources.matcher.findTerm(text, k.term, k.aliases ?? []).length;
  const has = (text: string, k: MatchKeyword) => hits(text, k) > 0;
  /** Does this term still stand somewhere in the resume outside the span being rewritten? */
  const elsewhereInResume = (quote: string, k: MatchKeyword) => hits(sources.resumeText, k) > hits(quote, k);

  const judged = actions.map((action): { action: MatchAction; verdict: 'pass' | 'warn' | 'block' } => {
    if (typeof action.replacement !== 'string' || action.replacement.trim() === '') return { action, verdict: 'pass' };
    const text = toPlainPunctuation(action.replacement);
    const quote = action.quote ?? '';
    const blocks: string[] = [];
    const warns: string[] = [];

    const check = factCheck({
      text,
      sources: [sources.resumeText, sources.posting, ...factLines(sources.facts)],
      facts: sources.facts,
      resume: sources.resumeText,
      replacing: quote,
    });
    // First on purpose: of the reasons a card can show, this one says the wording was never a line.
    const instruction = instructionIn(text, quote);
    if (instruction) blocks.push(`"${instruction}" is a note to the writer, not resume text`);
    // PROTECTED, as for a removal (gotcha 11): a rewrite of the contact line
    // carries every email, phone and profile link over as written. Only the
    // separators between them may change.
    const lost = contactDetails(quote).find((detail) => !text.includes(detail));
    if (lost) blocks.push(`it changes or drops "${lost}" — keep the contact details exactly as they are`);

    if (check.verdict === 'block') blocks.push(...check.reasons);
    // A true figure on other work is no invention, but one press would put the claim in the resume.
    else if (check.detached.length > 0) blocks.push(check.detached[0]!.reason);
    else if (check.verdict === 'warn') warns.push(...check.reasons);

    for (const k of sources.keywords) {
      const introduced = !has(quote, k) && has(text, k);
      // The posted job title (priority 2) on the resume's OWN title line or in
      // its summary is the role being applied for, not a claim of having held
      // it — and the retitle is the single highest-leverage edit there is. In a
      // bullet ("Web Developer at Acme") it would be a claim, so the exemption
      // stops at those two sections; every other keyword blocks everywhere.
      const targetTitle = (action.section === 'title' || action.section === 'summary') && k.priority === 2;
      if (introduced && k.status === 'cannot_claim' && !targetTitle) blocks.push(`claims "${k.term}", which this resume has no evidence for`);
      else if (introduced && k.status === 'ask_user' && !targetTitle) warns.push(`says "${k.term}" — confirm you have it first`);
      // KEEP WANTED KEYWORDS: only a change can lose a keyword; an addition
      // replaces nothing. And a term the resume still carries somewhere else is
      // not lost — blocking on that killed a good rewrite of a bullet whose
      // only "SQL" was the phrase "SQL injection".
      if (quote && k.status === 'present' && has(quote, k) && !has(text, k)) {
        if (elsewhereInResume(quote, k)) warns.push(`drops "${k.term}" from this line; the resume still has it elsewhere`);
        else if (k.primary || effectiveRequirement(k) === 'must') blocks.push(`drops "${k.term}", a must-have this posting wants`);
        else warns.push(`drops "${k.term}"`);
      }
    }

    // Stuffing (#633): a bullet rewrite that writes in a term the line implies,
    // as its only news or listed beside a name the line already gives.
    if (action.section === 'experience' && quote) {
      const writtenIn = sources.keywords.filter((k) => !has(quote, k) && has(text, k));
      const implied = writtenIn.filter(impliedOnly);
      const beside = implied.map((k) => [k, listedBeside(text, k, sources.matcher)] as const).find(([, name]) => name !== null);
      if (beside) blocks.push(`it lists "${beside[0].term}" beside "${beside[1]}" — ${IMPLIED_HOME}`);
      else if (implied.length > 0 && onlyWritesIn(quote, text, writtenIn, sources.matcher)) {
        blocks.push(`it only writes "${implied[0]!.term}" into the line — ${IMPLIED_HOME}`);
      }
    }

    if (blocks.length > 0) return { action: { ...action, replacement: null, why: `${action.why}${BLOCK_NOTE}${blocks[0]}` }, verdict: 'block' };
    if (warns.length > 0) return { action: { ...action, replacement: text, why: `${action.why}${WARN_NOTE}${warns[0]}` }, verdict: 'warn' };
    return { action: { ...action, replacement: text }, verdict: 'pass' };
  });

  // One bullet per term (#633): the score reads a term's best line, so a second
  // bullet that writes the same unwritten term in earns nothing and reads as
  // stuffing. The first in priority order keeps it.
  const termsOf = (a: MatchAction): string[] =>
    a.section === 'experience' && typeof a.replacement === 'string'
      ? sources.keywords.filter((k) => unwritten(k) && !has(a.quote ?? '', k) && has(a.replacement!, k)).map((k) => k.term)
      : [];
  const taken = new Set((options.alongside ?? []).flatMap(termsOf));
  const order = judged.map((_, i) => i).sort((i, j) => PRIORITY_RANK[actions[i]!.priority] - PRIORITY_RANK[actions[j]!.priority] || i - j);
  for (const i of order) {
    const terms = termsOf(judged[i]!.action);
    const again = terms.find((t) => taken.has(t));
    if (again === undefined) {
      for (const t of terms) taken.add(t);
      continue;
    }
    const why = `${actions[i]!.why}${BLOCK_NOTE}writes "${again}" into one more bullet — another edit here already writes it in, and once is enough`;
    judged[i] = { action: { ...judged[i]!.action, replacement: null, why }, verdict: 'block' };
  }

  return {
    actions: judged.map((j) => j.action),
    blocked: judged.filter((j) => j.verdict === 'block').length,
    warned: judged.filter((j) => j.verdict === 'warn').length,
  };
}

/** Letters and digits alone, so "AI / LLM Automation" and "AI/LLM Automation" are one name. */
const lettersOf = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
/** A name shorter than this is in every sentence: "CI" proves nothing by standing in a keyword's note. */
const MIN_NAME_LETTERS = 4;
/** A quote this much of a line's terms takes the line; less leaves a line that still shows what it showed. */
const WHOLE_LINE = 0.8;
/** Words a place is described with that name no place: "Key Skills, AI / LLM Automation line" is the "AI / LLM Automation" one. */
const PLACE_FILLER = new Set(['key', 'core', 'technical', 'skills', 'skill', 'section', 'line', 'lines', 'row', 'list', 'category', 'group', 'the', 'of', 'in']);

/**
 * The names a keyword's `where` may know the line by, when a removal takes
 * that line whole; none when the quote is only part of its line.
 *  - The label the line carries: "AI / LLM Automation" of "AI / LLM
 *    Automation: OpenAI, Claude, …", or of the same row out of a .docx table,
 *    where the reader writes " | " between the cells (gotcha 18).
 *  - For a skills line, what the removal itself calls it. A PDF's skills
 *    table reaches us as a stack of labels and a stack of value lines, so the
 *    line that goes has no label on it — but the same reply that wrote the
 *    keyword's note named the line it wants cut.
 */
function namesOfLineTaken(resumeText: string, removal: MatchRemoval, quote: string): string[] {
  const squeeze = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const first = squeeze(quote.split('\n')[0] ?? '');
  const line = first === '' ? undefined : resumeText.split('\n').map(squeeze).find((l) => l.includes(first));
  if (!line) return [];
  const cut = line.search(/: | \| /);
  const terms = cut > 0 ? line.slice(cut) : line;
  if (lettersOf(quote).length < lettersOf(terms).length * WHOLE_LINE) return [];
  const named = removal.where.split(/[^\p{L}\p{N}]+/u).filter((w) => !PLACE_FILLER.has(w.toLowerCase())).join('');
  const names = [cut > 0 ? line.slice(0, cut) : '', removal.section === 'skills' ? named : ''];
  return names.map(lettersOf).filter((n) => n.length >= MIN_NAME_LETTERS);
}

/**
 * The same judgment over the delete list. A removal has no wording to check,
 * so only the span rules apply — and they are about what the quote covers,
 * never about whether the advice is good.
 */
export function gateRemovals(removals: MatchRemoval[], sources: GateSources): RemovalGateReport {
  let blocked = 0;
  let warned = 0;
  const has = (text: string, k: MatchKeyword) => sources.matcher.findTerm(text, k.term, k.aliases ?? []).length > 0;

  const gated = removals.map((removal) => {
    const quote = removal.quote?.trim() ?? '';
    if (quote === '') return removal;
    const blocks: string[] = [];
    const warns: string[] = [];

    // PROTECTED: a quote that reaches the email or the phone is never applied,
    // whatever it was aiming at (gotcha 11 — a ZIP code took the email with it).
    if (hasContactDetail(quote)) blocks.push('the span covers contact details — keep the email and phone');

    // KEEP WANTED KEYWORDS: deleting the span deletes the evidence with it —
    // the keyword it spells, or the one its whole line is the evidence for.
    // The comparison says which line that is: the keyword's own `where`.
    const names = namesOfLineTaken(sources.resumeText, removal, quote);
    for (const k of sources.keywords) {
      if (k.status !== 'present' && k.status !== 'add') continue;
      const spelled = has(quote, k);
      const noted = lettersOf(k.where ?? '');
      const shown = !spelled && names.some((name) => noted.includes(name));
      if (!spelled && !shown) continue;
      const what = spelled ? `the span covers "${k.term}"` : `this line is what shows "${k.term}"`;
      if (k.primary || effectiveRequirement(k) === 'must') blocks.push(`${what}, a must-have this posting wants`);
      else warns.push(`${what}, which this posting asks for`);
    }

    if (blocks.length > 0) {
      blocked++;
      return { ...removal, quote: null, why: `${removal.why}${BLOCK_NOTE}${blocks[0]}` };
    }
    if (warns.length > 0) {
      warned++;
      return { ...removal, why: `${removal.why}${WARN_NOTE}${warns[0]}` };
    }
    return removal;
  });

  return { removals: gated, blocked, warned };
}

/** A word that makes a line a job title. Only a headline that has one is rewritten in place. */
const ROLE_WORD =
  /\b(?:engineer|developer|programmer|architect|manager|designer|analyst|scientist|lead|consultant|specialist|administrator|director|officer|tester|devops|sre|head|founder|cto|researcher|writer|editor|marketer|recruiter|accountant|technician|coordinator|strategist)\b/i;
/** A title is a few words; a longer line under the name is a sentence. */
const TITLE_MAX_WORDS = 10;

/**
 * A title action that adds a headline to a resume that already has one becomes
 * the rewrite of that headline (#591). Where the title opens the contact line
 * ("Senior Backend Engineer · Austin, TX · …") the model reads the line as
 * contact details, inserts its headline after the name, and Apply all left two
 * titles one over the other. `headline` is the title structure-from-text.ts
 * reads — the line under the name, or the part that opens the contact line —
 * and it is used only when the text carries it verbatim and it reads as a title.
 * Runs before gateActions, so the gate judges the wording against what it replaces.
 */
export function titleOverHeadline(actions: MatchAction[], resumeText: string, headline: string | null): MatchAction[] {
  const title = headline?.trim() ?? '';
  const isTitle =
    title !== '' && ROLE_WORD.test(title) && title.split(/\s+/).length <= TITLE_MAX_WORDS && !hasContactDetail(title);
  if (!isTitle || !resumeText.includes(title)) return actions;
  return actions.map((a) =>
    a.section === 'title' && !a.quote && typeof a.replacement === 'string' && a.replacement.trim() !== ''
      ? { ...a, quote: title, insert_after: null }
      : a,
  );
}

/** "Keep the refunds bullet as is": an edit that says to change nothing. */
const KEEP_AS_IS = /^\s*(?:keep|leave|retain)\b[^.;]*\b(?:as[ -]is|unchanged|alone|untouched)\b/i;
/** "No further change — JavaScript already implied by TypeScript" (#672): an edit that opens by saying there is none. */
const NO_CHANGE = /^\s*(?:no (?:further |other |more )?(?:change|edit)s?|nothing (?:more |else )?to (?:change|edit|add))\b/i;
/** A removal that says there is nothing to remove. */
const NOTHING_TO_REMOVE =
  /\bnothing (?:to|worth) (?:remove|cut|delete|trim|drop)\b|\bno (?:removal|cut|deletion)s? (?:is |are )?(?:needed|required|necessary)\b/i;
/** An order to take something out. */
const TAKE_OUT = /\b(?:remove|drop|delete|cut|strip|take out)\b/i;
/** A keep that moves the line is a reorder, and a reorder changes something. */
const MOVES = /\b(?:move|reorder|swap|lead|open|first|top|above|below|before|after|up)\b/i;

/*
 * The prompt's own words for its verdicts, as they reach a "why" the candidate
 * reads, and plain ones for them. Measured on prompt v18, which asks for plain
 * words: "title graded partial", "SQL is a must-have keyword marked add" still
 * came back. Only this vocabulary is touched — it means one thing here.
 */
const PLAIN_WHY: [RegExp, string][] = [
  [/\brecent_role\b/gi, 'recent role'],
  [/\bgraded (?:as )?partial\b/gi, 'only partly matches the posting'],
  [/\bgraded (?:as )?off\b/gi, 'does not match the posting'],
  [/\bmarked (?:as )?["']?add\b["']?/gi, 'not written in the resume yet'],
  [/\bmarked (?:as )?["']?cannot_claim["']?/gi, 'with nothing in the resume behind it'],
  [/\bmarked (?:as )?["']?ask_user["']?/gi, 'still to confirm'],
  [/\bcannot_claim\b/gi, 'unsupported'],
  [/\bask_user\b/gi, 'to confirm'],
  [/\bpresent\/add\b/gi, 'the resume can claim'],
  [/\badd-status\b/gi, 'not yet written'],
  [/\bmust-level\b/gi, 'must-have'],
  [/\b(?:the )?screening block\b/gi, "the posting's screening points"],
];

function plainWhy<T extends { why: string }>(item: T): T {
  return { ...item, why: PLAIN_WHY.reduce((why, [re, words]) => why.replace(re, words), item.why) };
}

export interface FinishedEdits {
  actions: MatchAction[];
  removals: MatchRemoval[];
  /** How many cards asked for nothing. */
  dropped: number;
}

/**
 * The edits as they reach the page, after the gates (#577). Those that ask for
 * nothing are taken out: a rewording identical to the text it replaces, a
 * "keep … as is" with no wording, a removal that says there is nothing to
 * remove, an order to take out terms the text does not carry ("remove React"
 * where React is nowhere). The prompt already says every action earns its
 * place; these still came back, and a card that can only be read and skipped
 * makes the count on the page a lie. Every "why" left is put in plain words.
 */
export function finishEdits(
  actions: MatchAction[],
  removals: MatchRemoval[],
  sources: Pick<GateSources, 'resumeText' | 'keywords' | 'matcher'>,
): FinishedEdits {
  const has = (text: string, k: MatchKeyword) => sources.matcher.findTerm(text, k.term, k.aliases ?? []).length > 0;
  /** An order to take out terms none of which the resume carries. */
  const takesOutAbsent = (what: string) => {
    if (!TAKE_OUT.test(what)) return false;
    const named = sources.keywords.filter((k) => has(what, k));
    return named.length > 0 && named.every((k) => !has(sources.resumeText, k));
  };
  const noWording = (a: MatchAction) => (a.replacement ?? '').trim() === '' && !a.insert_after;
  const actionAsksNothing = (a: MatchAction) =>
    (Boolean(a.quote) && Boolean(a.replacement) && toPlainPunctuation(a.quote ?? '') === toPlainPunctuation(a.replacement ?? '')) ||
    (noWording(a) && (KEEP_AS_IS.test(a.what) || NO_CHANGE.test(a.what)) && !MOVES.test(a.what)) ||
    (noWording(a) && !a.quote && takesOutAbsent(a.what));
  const removalAsksNothing = (r: MatchRemoval) =>
    NOTHING_TO_REMOVE.test(r.what) || KEEP_AS_IS.test(r.what) || (!r.quote && takesOutAbsent(r.what));
  const keptActions = actions.filter((a) => !actionAsksNothing(a));
  const keptRemovals = removals.filter((r) => !removalAsksNothing(r));
  return {
    actions: keptActions.map(plainWhy),
    removals: keptRemovals.map(plainWhy),
    dropped: actions.length - keptActions.length + removals.length - keptRemovals.length,
  };
}
