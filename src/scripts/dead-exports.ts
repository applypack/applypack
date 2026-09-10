/*
 * Which exported symbols nobody imports. Reads src/ (tests and scripts count
 * as readers, never as owners) and prints three lists: dead — no use
 * anywhere, not even in its own file; over-exported — used only inside its
 * own file, so the `export` is noise; tests-only — a seam a test reaches
 * for, which is fine and stays. Types and interfaces are left alone: an
 * unused type costs nothing at runtime.
 *
 *   npx tsx src/scripts/dead-exports.ts
 *
 * Hand-run: the answer is a list to read, not a gate (audit 2026-09-10,
 * DEAD-1 found 10 dead and 84 over-exported this way).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const texts = new Map(files.map((f) => [f, readFileSync(f, 'utf8')] as const));
const EXPORT_RE = /^export\s+(?:async\s+)?(function|const|let|class|enum)\s+([A-Za-z_$][\w$]*)/gm;
const isTest = (f: string) => /\.test\.ts$/.test(f);
const isScript = (f: string) => /\/scripts\//.test(f);

const dead: string[] = [];
const overExported: string[] = [];
const testsOnly: string[] = [];
for (const [f, t] of texts) {
  if (isTest(f) || isScript(f)) continue;
  for (const m of t.matchAll(EXPORT_RE)) {
    const name = m[2]!;
    const word = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g');
    const inFile = (t.match(word) ?? []).length - 1;
    let refs = 0;
    let tests = 0;
    for (const [g, u] of texts) {
      if (g === f) continue;
      if (word.test(u)) isTest(g) ? tests++ : refs++;
      word.lastIndex = 0;
    }
    const row = `${relative(ROOT, f)}: ${name}`;
    if (refs === 0 && tests === 0 && inFile === 0) dead.push(row);
    else if (refs === 0 && tests === 0) overExported.push(`${row} (used ${inFile}× in its file)`);
    else if (refs === 0 && inFile === 0) testsOnly.push(row);
  }
}

const section = (title: string, rows: string[]) => `${title} (${rows.length})\n${rows.map((r) => `  ${r}`).join('\n') || '  none'}`;
console.log(section('DEAD — no use anywhere', dead));
console.log(section('OVER-EXPORTED — used only in its own file', overExported));
console.log(section('TESTS-ONLY — a seam a test reaches for; stays', testsOnly));
