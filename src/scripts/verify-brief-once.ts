/*
 * One-off check of the compare pipeline (ADR 0044) against a real row:
 *   npm run verify:compare -- <jobId> <resumeId> [fast|full]
 * Reads the posting brief (writing it if absent, reusing it if not), runs the
 * comparison, and prints what a user would see — the brief's own reading, the
 * grouped keyword frame, every action with its wording, every removal with its
 * quote. It spends AI and writes rows, so it is run by hand, never in CI.
 */
import { prisma } from '../db';
import { briefForPosting, briefLine } from '../resume/brief';
import { matchResumeToJob } from '../resume/match';
import { parseMatchMode } from '../resume/match-mode';
import { readActions, readKeywords, readRemovals } from '../resume/prompts';

async function main(): Promise<void> {
  const [jobArg, resumeArg, modeArg] = process.argv.slice(2);
  const jobId = Number(jobArg);
  const resumeId = Number(resumeArg);
  const mode = parseMatchMode(modeArg ?? 'full');

  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { id: true, title: true, location: true, description: true, company: { select: { name: true } } },
  });
  const resume = await prisma.resume.findUniqueOrThrow({
    where: { id: resumeId },
    select: { id: true, name: true, version: true, text: true },
  });
  const jobInput = { ...job, companyName: job.company.name };

  console.log(`posting: ${job.title} @ ${job.company.name}`);
  console.log(`resume:  ${resume.name} v${resume.version}\n`);

  const t0 = Date.now();
  const first = await briefForPosting(jobInput);
  console.log(`brief:   ${first ? (first.reused ? 'reused' : 'written') : 'FAILED'} in ${Date.now() - t0} ms`);
  if (!first) {
    console.log('brief failed — the comparison would fall back to deriving the frame itself');
  } else {
    const b = first.brief;
    console.log(`  line:  ${briefLine(b)}`);
    console.log(`  role:  ${b.role.posted_title} | ${b.role.family} | ${b.role.seniority ?? '-'} | from ${b.role.years_min ?? '-'} years`);
    console.log(`  focus: ${b.role.focus}`);
    console.log(`  firm:  ${b.company.industry ?? '-'} | ${b.company.product ?? '-'} | for ${b.company.audience ?? '-'} | ${b.company.stage ?? '-'}`);
    console.log(`  reader: ${b.screening.reader}`);
    for (const x of b.screening.scan_for) console.log(`  scans:  ${x}`);
    for (const x of b.screening.wow) console.log(`  wow:    ${x}`);
    for (const g of b.requirement_groups) console.log(`  group:  ${g.label} [${g.level}/${g.satisfy}] ${g.options.join(' / ')}`);

    const t1 = Date.now();
    const again = await briefForPosting(jobInput);
    console.log(`  second read: ${again?.reused ? 'reused' : 'REWRITTEN — cache miss'} in ${Date.now() - t1} ms\n`);
  }

  const t2 = Date.now();
  const row = await matchResumeToJob(resume, jobInput, { mode, brief: first });
  if (!row) {
    console.log('match failed');
    return;
  }
  const keywords = readKeywords(row.keywords);
  const actions = readActions(row.actions);
  const removals = readRemovals(row.removals);
  console.log(`match ${row.id}: ${row.matchScore}/100 in ${Date.now() - t2} ms (${row.model})`);
  console.log(`  ${row.summary}`);
  console.log(`  breakdown: ${JSON.stringify(row.breakdown)}`);
  console.log(`  keywords: ${keywords.length}, grouped: ${keywords.filter((k) => k.group).length}`);
  for (const k of keywords) {
    console.log(`   - ${k.term} | ${k.requirement}${k.primary ? '/primary' : ''} | ${k.status} | group=${k.group ?? '-'}`);
  }
  console.log(`\n  actions: ${actions.length}`);
  for (const a of actions) {
    console.log(`   [${a.priority}] ${a.section} — ${a.what}`);
    console.log(`        why: ${a.why}`);
    if (a.quote) console.log(`        quote: ${a.quote.slice(0, 120)}`);
    console.log(`        new:   ${a.replacement === null ? '(blocked or none)' : a.replacement?.slice(0, 200) ?? '(v6 row)'}`);
  }
  console.log(`\n  removals: ${removals.length}`);
  for (const r of removals) {
    console.log(`   ${r.section} — ${r.what}`);
    console.log(`        why: ${r.why}`);
    console.log(`        quote: ${r.quote ?? '(gated — nothing struck through)'}`);
  }
  console.log(`\n  strengths: ${row.strengths.length}, cautions: ${row.cautions.length}, red flags: ${row.redFlags.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
