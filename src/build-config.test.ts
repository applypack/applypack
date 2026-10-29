import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/*
 * `npm run build` compiles tsconfig.build.json into dist/, which `npm start`
 * runs and the Docker image ships. It leaves out the tests and the tools that
 * only make sense in a checkout: before #656 every image carried 335 compiled
 * tests. The list goes wrong three ways, and each is read here: a script a
 * doc tells someone to run from dist/ is left out, a tool left out has no
 * other way to run, or a file the build keeps imports one it leaves out — tsc
 * then compiles that one anyway, and the line in the list does nothing.
 */

const ROOT = join(__dirname, '..');
const TESTS = 'src/**/*.test.ts';

interface BuildConfig {
  extends?: string;
  exclude?: string[];
}

/** tsconfig.build.json, its `//` comment lines dropped (tsc reads them; JSON.parse does not). */
function buildConfig(): BuildConfig {
  const text = readFileSync(join(ROOT, 'tsconfig.build.json'), 'utf8');
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, '')) as BuildConfig;
}

function packageScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  return pkg.scripts ?? {};
}

/** The scripts the build leaves out, by name: `src/scripts/pack-dry-once.ts` → `pack-dry-once`. */
function excludedScripts(): string[] {
  return (buildConfig().exclude ?? []).flatMap((entry) => {
    const m = /^src\/scripts\/([a-z0-9-]+)\.ts$/.exec(entry);
    return m ? [m[1]!] : [];
  });
}

/** Every `.ts` / `.tsx` under src/, as `src/…` paths. */
function sourceFiles(): string[] {
  return readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => `src/${f.split('\\').join('/')}`);
}

/* Named without the literal, so this file does not read as one of the docs. */
const DIST_SCRIPT = new RegExp(String.raw`\bdist/scripts/([a-z0-9-]+)\.js\b`, 'g');

/** Every script a tracked file says to run from dist/ — docs, compose, package.json, a script's own usage line. The changelog is history. */
function scriptsRunFromDist(): Map<string, string> {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(md|ya?ml|json|tsx?)$|(^|\/)Dockerfile$/.test(f))
    .filter((f) => f !== 'CHANGELOG.md' && f !== 'package-lock.json' && f !== 'src/build-config.test.ts');
  const named = new Map<string, string>();
  for (const file of files) {
    for (const m of readFileSync(join(ROOT, file), 'utf8').matchAll(DIST_SCRIPT)) {
      if (!named.has(m[1]!)) named.set(m[1]!, file);
    }
  }
  return named;
}

test('the build compiles tsconfig.build.json, which leaves the tests out and checks everything else', () => {
  const config = buildConfig();
  assert.equal(config.extends, './tsconfig.json');
  const scripts = packageScripts();
  assert.match(scripts.build ?? '', /^tsc -p tsconfig\.build\.json && /);
  assert.match(scripts['build:watch'] ?? '', /^tsc -p tsconfig\.build\.json /);
  // The type check still reads every file, the tests and the tools included.
  assert.equal(scripts['lint:types'], 'tsc --noEmit');
  const exclude = config.exclude ?? [];
  assert.ok(exclude.includes(TESTS), `tsconfig.build.json does not exclude ${TESTS}`);
  // `exclude` replaces the base's list, so it says these two again.
  assert.ok(exclude.includes('node_modules') && exclude.includes('dist'));
  // The reading below knows these shapes only; a new glob is a new rule to read.
  const unknown = exclude.filter((e) => !['node_modules', 'dist', TESTS].includes(e) && !/^src\/scripts\/[a-z0-9-]+\.ts$/.test(e));
  assert.deepEqual(unknown, []);
});

test('a script a doc says to run from dist/ is built', () => {
  const named = scriptsRunFromDist();
  assert.ok(named.has('route-smoke') && named.has('health-check'), 'the doc scan found nothing to check');
  const excluded = new Set(excludedScripts());
  for (const [name, file] of named) {
    assert.ok(existsSync(join(ROOT, 'src', 'scripts', `${name}.ts`)), `${file} names dist/scripts/${name}.js, and src/scripts has no ${name}.ts`);
    assert.ok(!excluded.has(name), `${file} says to run dist/scripts/${name}.js, and tsconfig.build.json leaves it out`);
  }
});

test('every tool the build leaves out runs from source through npm run', () => {
  const excluded = excludedScripts();
  assert.ok(excluded.length > 0);
  const commands = Object.values(packageScripts());
  for (const name of excluded) {
    assert.ok(existsSync(join(ROOT, 'src', 'scripts', `${name}.ts`)), `tsconfig.build.json leaves out src/scripts/${name}.ts, which does not exist`);
    assert.ok(
      commands.some((c) => c.includes(`tsx src/scripts/${name}.ts`)),
      `src/scripts/${name}.ts is left out of the build and no npm script runs it from source`,
    );
  }
});

/** What a relative specifier in `from` names: `./x`, `./x.js` or `./x/` → the `.ts`, `.tsx` or `index.ts` behind it. */
function resolveImport(from: string, specifier: string): string | null {
  const base = join(dirname(from), specifier.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(join(ROOT, candidate))) return candidate.split('\\').join('/');
  }
  return null;
}

/** `from './x'`, a bare `import './x'`, `import('./x')` and `require('./x')`. */
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g;

test('nothing the build keeps imports a file it leaves out', () => {
  const excluded = new Set(excludedScripts().map((name) => `src/scripts/${name}.ts`));
  const leftOut = (file: string): boolean => file.endsWith('.test.ts') || excluded.has(file);
  const kept = sourceFiles().filter((f) => !leftOut(f));
  assert.ok(kept.includes('src/web/server.ts') && kept.includes('src/local/launcher.ts'));
  const pulledIn: string[] = [];
  for (const file of kept) {
    for (const m of readFileSync(join(ROOT, file), 'utf8').matchAll(RELATIVE_IMPORT)) {
      const target = resolveImport(file, m[1]!);
      if (target && leftOut(target)) pulledIn.push(`${file} → ${target}`);
    }
  }
  assert.deepEqual(pulledIn, []);
});
