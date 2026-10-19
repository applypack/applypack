import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * What a phone shows first (#570). Layout is not unit-testable here (gotcha
 * 2), so the classes that decide the order are held in the source, as
 * layout-frame.test.ts holds the frame's.
 */
const source = (page: string): string => readFileSync(join(__dirname, 'pages', page), 'utf8');

test('below xl the job page shows its status actions, then the open tab, then the rest of the rail', () => {
  const page = source('job-detail.tsx');
  // The rail is no box of its own below xl, so its two cards take their places among the tab's.
  assert.match(page, /<div class="contents xl:block xl:space-y-4">\s*<JobActions [^>]*\/>\s*<JobRail /);
  assert.match(page, /const JobActions[\s\S]*?<Card class="order-first min-w-0">/);
  // On the posting tab its own words lead and the classifier follows.
  assert.match(page, /<Card variant="flat" class="order-first [^"]*xl:order-none[^"]*">\s*<SectionTitle>\{t\('job\.description'\)\}/);
  assert.match(page, /<div class="order-last [^"]*xl:order-none[^"]*">\s*<ClassifierCard /);
});

test('on a phone the Overview puts its four cards two to a row and the latest matches before the chart', () => {
  const page = source('overview.tsx');
  assert.match(page, /aria-label=\{t\('overview\.jobsByStatus'\)\} class="grid grid-cols-2 /);
  assert.match(page, /<MatchesChart [^>]*\/>\s*<div class="order-first sm:order-none">\s*<RecentMatches /);
});
