import { prisma } from '../db';
import { withTableAliases } from '../resume/keyword-aliases';
import { loadKeywordMatcher } from '../resume/keyword-matcher';
import { readKeywords } from '../resume/prompts';

/*
 * Read-only audit of the keyword matcher over every stored comparison: runs
 * findTerm(term + aliases) — the function the /target page highlights with —
 * against the posting and the judged resume text, and lists every keyword row
 * that highlights nowhere — with the aliases as stored, and again with the
 * alias table applied on top (what the target page does at read time).
 * Before/after numbers for matcher changes (TASKS §13 block 2) without an AI
 * call. Never writes.
 *
 *   npm run keywords:audit                       (locally)
 *   docker compose exec web node dist/scripts/keyword-audit.js
 */

interface Totals {
  matches: number;
  rows: number;
  postingMiss: number;
  postingMissTable: number;
  titleOnly: number;
  present: number;
  resumeMiss: number;
  resumeMissTable: number;
  noResumeText: number;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

async function main(): Promise<void> {
  const { findTerm } = await loadKeywordMatcher();
  const matches = await prisma.resumeMatch.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      jobId: true,
      resumeId: true,
      resumeVersion: true,
      keywords: true,
      resumeText: true,
      job: { select: { title: true, description: true } },
    },
  });

  const t: Totals = { matches: matches.length, rows: 0, postingMiss: 0, postingMissTable: 0, titleOnly: 0, present: 0, resumeMiss: 0, resumeMissTable: 0, noResumeText: 0 };
  for (const m of matches) {
    const keywords = readKeywords(m.keywords);
    const hasResume = m.resumeText.length > 0;
    if (!hasResume) t.noResumeText++;
    console.log(`match#${m.id} job#${m.jobId} resume#${m.resumeId} v${m.resumeVersion} — ${keywords.length} keywords, posting ${m.job.description.length} chars${hasResume ? '' : ', NO resume snapshot'}`);
    for (const k of keywords) {
      t.rows++;
      const tabled = withTableAliases(k);
      const label = `"${k.term}"${k.aliases.length > 0 ? ` aliases=[${k.aliases.join(', ')}]` : ''} · ${k.requirement} · ${k.status}${k.unanchored ? ' · UNANCHORED' : ''}`;
      if (findTerm(m.job.description, k.term, k.aliases).length === 0) {
        t.postingMiss++;
        const inTitle = findTerm(m.job.title, k.term, k.aliases).length > 0;
        if (inTitle) t.titleOnly++;
        const rescued = findTerm(m.job.description, tabled.term, tabled.aliases).length > 0;
        if (!rescued) t.postingMissTable++;
        console.log(`    posting miss${inTitle ? ' (title only)' : ''}${rescued ? ' (table rescues)' : ''}: ${label}`);
      }
      if (k.status !== 'present' || !hasResume) continue;
      t.present++;
      if (findTerm(m.resumeText, k.term, k.aliases).length === 0) {
        t.resumeMiss++;
        const rescued = findTerm(m.resumeText, tabled.term, tabled.aliases).length > 0;
        if (!rescued) t.resumeMissTable++;
        console.log(`    resume miss${rescued ? ' (table rescues)' : ''}: ${label} · where: ${k.where ?? '—'}`);
      }
    }
  }

  console.log('');
  console.log(`matches: ${t.matches} (${t.noResumeText} without a resume snapshot)`);
  console.log(`keyword rows: ${t.rows}`);
  console.log(`  0 spans in the posting: ${t.postingMiss} (${pct(t.postingMiss, t.rows)}) as stored, ${t.postingMissTable} with the alias table; found in the title only: ${t.titleOnly}`);
  console.log(`status=present rows with a resume snapshot: ${t.present}`);
  console.log(`  0 spans in the resume: ${t.resumeMiss} (${pct(t.resumeMiss, t.present)}) as stored, ${t.resumeMissTable} with the alias table`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
