/**
 * Dry-run script: shows which existing jobs would be matched by the
 * active profile's priorityRules under the current matching logic.
 * Read-only — never updates the database. Used in smoke tests after
 * tweaking ruleMatches semantics.
 *
 *   npm run priority:dryrun    (locally)
 *   docker compose exec app node dist/scripts/priority-rules-dryrun.js
 */
import { prisma } from '../db';
import { getActiveProfile } from '../profiles';
import {
  evaluatePriorityRules,
  parsePriorityRules,
} from '../priority-rules';

async function main(): Promise<void> {
  const profile = await getActiveProfile();
  if (!profile) {
    console.error('no active profile');
    process.exit(1);
  }
  const rules = parsePriorityRules(profile.priorityRules);
  if (rules.length === 0) {
    console.log('profile has no priorityRules — nothing to dry-run');
    return;
  }
  console.log(`active profile: ${profile.name}`);
  console.log(`priority rules (${rules.length}):`);
  for (const r of rules) {
    console.log(`  - ${r.label}`);
    console.log(`      techsAny:   [${r.techsAny.join(', ')}]`);
    console.log(`      regionsAny: [${r.regionsAny.join(', ')}]`);
    console.log(`      minFitFloor: ${r.minFitFloor}`);
  }
  console.log('');

  const jobs = await prisma.job.findMany({
    select: {
      id: true,
      title: true,
      location: true,
      description: true,
      fitScore: true,
      status: true,
      priorityRulesApplied: true,
    },
  });

  const matches: {
    id: number;
    title: string;
    location: string;
    fitScore: number | null;
    status: string;
    appliedLabels: string[];
    floor: number;
  }[] = [];
  for (const j of jobs) {
    const out = evaluatePriorityRules(rules, j);
    if (out.applied.length > 0) {
      matches.push({
        id: j.id,
        title: j.title,
        location: j.location,
        fitScore: j.fitScore,
        status: j.status,
        appliedLabels: out.applied.map((r) => r.label),
        floor: out.fitScoreFloor,
      });
    }
  }

  console.log(`scanned ${jobs.length} jobs, ${matches.length} would match.`);
  for (const m of matches.slice(0, 30)) {
    console.log(
      `  job#${m.id.toString().padStart(4, ' ')} fit=${
        m.fitScore ?? '—'
      } floor=${m.floor} status=${m.status}`,
    );
    console.log(`             title: ${m.title}`);
    console.log(`          location: ${m.location}`);
    console.log(`             rules: ${m.appliedLabels.join(', ')}`);
  }
  if (matches.length > 30) {
    console.log(`  ... and ${matches.length - 30} more`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
