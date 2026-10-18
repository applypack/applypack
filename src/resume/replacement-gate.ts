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
 *  - wording that is a note to the writer and not resume text is refused
 *    (`instructionIn`): the prompt sends "ask the candidate for the real
 *    number" to `why`, and the model still writes it, or a slot to fill in,
 *    into the wording itself — one press then put that sentence in the resume.
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

import { factCheck } from './fact-check';
import type { FactLike } from './facts';
import { effectiveRequirement } from './keyword-overrides';
import type { KeywordMatcher } from './keyword-matcher';
import { hasContactDetail } from './parse-warnings';
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

export function gateActions(actions: MatchAction[], sources: GateSources): GateReport {
  let blocked = 0;
  let warned = 0;
  const hits = (text: string, k: MatchKeyword) => sources.matcher.findTerm(text, k.term, k.aliases ?? []).length;
  const has = (text: string, k: MatchKeyword) => hits(text, k) > 0;
  /** Does this term still stand somewhere in the resume outside the span being rewritten? */
  const elsewhereInResume = (quote: string, k: MatchKeyword) => hits(sources.resumeText, k) > hits(quote, k);

  const gated = actions.map((action) => {
    if (typeof action.replacement !== 'string' || action.replacement.trim() === '') return action;
    const text = toPlainPunctuation(action.replacement);
    const quote = action.quote ?? '';
    const blocks: string[] = [];
    const warns: string[] = [];

    const check = factCheck({
      text,
      sources: [sources.resumeText, sources.posting, ...factLines(sources.facts)],
      facts: sources.facts,
    });
    // First on purpose: of the reasons a card can show, this one says the wording was never a line.
    const instruction = instructionIn(text, quote);
    if (instruction) blocks.push(`"${instruction}" is a note to the writer, not resume text`);

    if (check.verdict === 'block') blocks.push(...check.reasons);
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

    if (blocks.length > 0) {
      blocked++;
      return { ...action, replacement: null, why: `${action.why}${BLOCK_NOTE}${blocks[0]}` };
    }
    if (warns.length > 0) {
      warned++;
      return { ...action, replacement: text, why: `${action.why}${WARN_NOTE}${warns[0]}` };
    }
    return { ...action, replacement: text };
  });

  return { actions: gated, blocked, warned };
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
