/*
 * The comparison, run over a matrix of real resumes and real postings, with
 * every invariant it is supposed to hold checked against the row it wrote:
 *
 *   npm run matrix:compare -- 2:2111 3:2108 4:2112 ...
 *   npm run matrix:compare            # the default matrix below
 *
 * Each pair is `resumeId:jobId`. Spends AI and writes rows, so it is a
 * hand-run check, never CI — the unit tests cover the pure halves and the gold
 * bench covers the prompt. What this catches is what only shows up on real
 * text: a keyword that is not a term, a removal that eats a wanted skill, a
 * status the matcher disagrees with, a cap that fires on nothing.
 */
import { prisma } from '../db';
import { briefForPosting } from '../resume/brief';
import { postingDepth } from '../resume/brief-depth';
import { evidenceFor } from '../resume/evidence';
import { loadKeywordMatcher } from '../resume/keyword-matcher';
// The editor locates a quote the way the browser does — exact, then
// whitespace- and punctuation-insensitive. Checking with `includes` reported
// every line-wrapped quote as broken when Apply works on all of them.
// @ts-expect-error — plain JS with no declaration file.
import { locateQuote } from '../web/public/target.mjs';
import { matchResumeToJob } from '../resume/match';
import { readActions, readHardRequirements, readKeywords, readRemovals } from '../resume/prompts';
import { primaryCap, readBreakdown } from '../resume/score';
import { hasContactDetail } from '../resume/parse-warnings';

/** resumeId:jobId — a spread of stacks, seniorities and occupations. */
const DEFAULT_MATRIX = [
  '2:2111', // PHP backend resume  × Principal Backend Engineer
  '2:2113', // PHP backend resume  × Backend Developer
  '2:2107', // PHP backend resume  × Growth Lead, Paid Media   (hard mismatch)
  '3:2108', // React frontend      × Full Stack (Java, React)  (sparse posting)
  '3:2115', // React frontend      × Web Developer
  '3:2110', // React frontend      × Lead Mobile Engineer      (adjacent)
  '4:2112', // Product manager     × Lead Generation Specialist (non-tech both sides)
  '4:2111', // Product manager     × Principal Backend Engineer (hard mismatch)
  '1:2117', // Senior SWE          × Software Engineer
  '1:2106', // Senior SWE          × TMF Lead                  (clinical trials, non-tech)
];

interface Issue {
  pair: string;
  rule: string;
  detail: string;
}

async function main(): Promise<void> {
  const pairs = process.argv.slice(2).filter((a) => /^\d+:\d+$/.test(a));
  const matrix = pairs.length > 0 ? pairs : DEFAULT_MATRIX;
  const matcher = await loadKeywordMatcher();
  const issues: Issue[] = [];
  const rows: string[] = [];

  for (const pair of matrix) {
    const [resumeId, jobId] = pair.split(':').map(Number) as [number, number];
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { company: { select: { name: true } } },
    });
    const resume = await prisma.resume.findUnique({ where: { id: resumeId } });
    if (!job || !resume) {
      issues.push({ pair, rule: 'fixture', detail: 'job or resume is gone' });
      continue;
    }
    const jobInput = {
      id: job.id,
      title: job.title,
      companyName: job.company.name,
      location: job.location,
      description: job.description,
    };
    const posting = `${job.title}\n${job.description}`;

    const briefed = await briefForPosting(jobInput);
    const depth = postingDepth(briefed?.brief);
    const started = Date.now();
    const row = await matchResumeToJob(resume, jobInput, { mode: 'full', brief: briefed });
    if (!row) {
      issues.push({ pair, rule: 'run', detail: 'the comparison failed' });
      continue;
    }
    const ms = Date.now() - started;

    const keywords = readKeywords(row.keywords);
    const actions = readActions(row.actions);
    const removals = readRemovals(row.removals);
    const gates = readHardRequirements(row.hardRequirements);
    const bd = readBreakdown(row.breakdown);
    const found = (text: string, term: string, aliases: string[]) => matcher.findTerm(text, term, aliases).length > 0;
    const at = (rule: string, detail: string) => issues.push({ pair, rule, detail });

    // ---- the keyword list is made of terms, anchored to the posting --------
    for (const k of keywords) {
      if (/\b\d+\s*\+?\s*(years?|yrs?)\b/i.test(k.term)) at('keyword-shape', `"${k.term}" is a years requirement`);
      if (/\b(degree|diploma|phd)\b/i.test(k.term)) at('keyword-shape', `"${k.term}" is an education requirement`);
      if (k.term.split(/\s+/).length > 5) at('keyword-shape', `"${k.term}" is longer than a term`);
      if (k.unanchored !== true && !found(posting, k.term, k.aliases)) {
        at('anchor-posting', `"${k.term}" is not in the posting and is not flagged unanchored`);
      }
      // present vs add is settled from the resume text, both ways.
      const written = found(row.resumeText, k.term, k.aliases);
      if (k.status === 'present' && !written) at('anchor-status', `"${k.term}" is present but not in the resume`);
      if (k.status === 'add' && written) at('anchor-status', `"${k.term}" is add but the word IS in the resume`);
      if (k.evidence === undefined) at('evidence', `"${k.term}" carries no evidence level`);
      else if (k.evidence !== evidenceFor(k, row.resumeText, matcher)) {
        at('evidence', `"${k.term}" evidence disagrees with the text`);
      }
      // A group label the brief did not write would fold two requirements into one.
      if (k.group && !(briefed?.brief.requirement_groups ?? []).some((g) => g.label.toLowerCase() === k.group?.toLowerCase())) {
        at('group', `"${k.term}" carries a group the brief never wrote: ${k.group}`);
      }
    }

    // ---- the score follows from what was stored ---------------------------
    if (bd) {
      if (bd.score < 0 || bd.score > 100) at('score', `out of range: ${bd.score}`);
      if (bd.cap !== primaryCap(bd.primaryPresent, bd.primaryTotal)) at('score', 'cap does not follow from the primary counts');
      if (bd.ceiling !== undefined && bd.ceiling < bd.score) at('score', 'ceiling below the score');
      if ((bd.primaryWritten ?? 0) > bd.primaryPresent) at('score', 'more primaries written than covered');
    } else {
      at('score', 'no readable breakdown');
    }

    // ---- what the page will do with one press -----------------------------
    for (const r of removals) {
      if (!r.quote) continue;
      if (!locateQuote(row.resumeText, r.quote)) at('removal-quote', `the editor cannot locate it: "${r.quote.slice(0, 60)}"`);
      if (hasContactDetail(r.quote)) at('removal-gate', 'a removal quote covers contact details');
      for (const k of keywords) {
        if ((k.status === 'present' || k.status === 'add') && found(r.quote, k.term, k.aliases)) {
          at('removal-gate', `a removal would delete "${k.term}", which this posting wants`);
        }
      }
    }
    for (const a of actions) {
      if (a.quote && !locateQuote(row.resumeText, a.quote)) {
        at('action-quote', `the editor cannot locate it: "${a.quote.slice(0, 60)}"`);
      }
      if (typeof a.replacement !== 'string') continue;
      for (const k of keywords) {
        if (k.status !== 'cannot_claim') continue;
        const introduced = !found(a.quote ?? '', k.term, k.aliases) && found(a.replacement, k.term, k.aliases);
        // The posted title on the headline is the one exemption (ADR 0044).
        const titleLine = (a.section === 'title' || a.section === 'summary') && k.priority === 2;
        if (introduced && !titleLine) at('action-gate', `a replacement claims "${k.term}", which the resume has no evidence for`);
      }
    }

    // ---- the advice has the floor the rules promise ------------------------
    // The floor only binds when the candidate has part of the core of the job —
    // the same test the prompt states. A product manager against a principal
    // engineer posting correctly gets no actions; a front-end resume with React
    // and TypeScript present, against a full-stack React posting, must not.
    const covered = keywords.filter((k) => k.status === 'present' || k.status === 'add');
    const hasCore =
      (bd?.primaryTotal ?? 0) > 0
        ? (bd?.primaryPresent ?? 0) > 0
        : covered.filter((k) => k.requirement === 'must').length >= 2;
    // And the advice has to be worth writing: when even perfect editing lands
    // below a score anyone would apply on, a retitle is theatre. The page says
    // so in the empty state rather than pretending there was nothing to find.
    const worthIt = (bd?.ceiling ?? 0) >= 50;
    const workable = hasCore && worthIt;
    const highIn = (section: string) => actions.some((a) => a.section === section && a.priority === 'high');
    if (bd?.alignment && workable) {
      if (bd.alignment.title !== 'strong' && !highIn('title')) at('floor', 'title is not strong and got no high-priority action');
      if (bd.alignment.summary !== 'strong' && !highIn('summary')) at('floor', 'summary is not strong and got no high-priority action');
    }

    rows.push(
      [
        pair.padEnd(9),
        `${row.matchScore}`.padStart(3),
        `${bd?.ceiling ?? '-'}`.padStart(4),
        `${bd?.cap ?? '-'}`.padStart(4),
        `${bd?.primaryPresent ?? '-'}/${bd?.primaryTotal ?? '-'}`.padStart(5),
        `${keywords.length}`.padStart(3),
        `${actions.length}`.padStart(3),
        `${removals.length}`.padStart(3),
        `${gates.filter((g) => g.status === 'fail').length}`.padStart(2),
        depth.depth.padEnd(6),
        `${Math.round(ms / 1000)}s`.padStart(4),
        `${job.title.slice(0, 34)} × ${(resume.name ?? '').slice(0, 26)}`,
      ].join(' '),
    );
    console.log(rows[rows.length - 1]);
  }

  console.log('\npair      scr ceil  cap  prim  kw act rem gf depth   time  posting × resume');
  for (const r of rows) console.log(r);

  console.log(`\n${issues.length} issue(s)`);
  const byRule = new Map<string, Issue[]>();
  for (const i of issues) byRule.set(i.rule, [...(byRule.get(i.rule) ?? []), i]);
  for (const [rule, list] of [...byRule.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n## ${rule} (${list.length})`);
    for (const i of list) console.log(`  ${i.pair}  ${i.detail}`);
  }
  process.exitCode = issues.length > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
