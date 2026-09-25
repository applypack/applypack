import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * CLAUDE.md, SPEC.md, ARCHITECTURE.md, the operator docs and the ADRs point
 * at the code by name: `src/filter.ts`, `settings.ts:getSourceKeys`. A
 * rename leaves the name behind (CLAUDE.md kept `onDigestHour`,
 * `structureStrings` and `TARGET_JS` for weeks after the code dropped them),
 * and every session that follows one goes looking for code that is not
 * there. So every backticked file must exist, and every `file:symbol` must
 * be declared in that file. Declared, not exported: CLAUDE.md names private
 * helpers such as `filter.ts:locationMatches` on purpose.
 */

const ROOT = join(__dirname, '..');
const ADR_DIR = join(ROOT, 'docs', 'adr');
/** What the code is today: every name in these must still be in the code. */
const CURRENT = [
  'CLAUDE.md',
  'SPEC.md',
  'ARCHITECTURE.md',
  'DESIGN.md',
  'README.md',
  'CONTRIBUTING.md',
  'docs/install.md',
  'docs/operations.md',
  'docs/ai-engines.md',
  'docs/employer-mode.md',
];
/** Decisions: their paths must exist, but their prose names the alternatives they turned down and other vendors' APIs. */
const ADRS = readdirSync(ADR_DIR)
  .filter((f) => /^\d{4}-.*\.md$/.test(f))
  .map((f) => `docs/adr/${f}`);


/*
 * Named in an ADR as history: the file is gone and the ADR, its addendum or
 * a later ADR says so. A new entry here is a decision, not a fix.
 */
const GONE: Record<string, string[]> = {
  // The funnel cards and their math, removed by ADR 0025 in v1.4.0.
  'docs/adr/0024-append-only-stage-ledger.md': ['src/web/stats.ts'],
  'docs/adr/0025-custom-work-stages.md': ['stats.ts', 'funnel-stats.tsx'],
};

/* What git tracks, not what the disk holds: a local, untracked file must not satisfy a reference that CI will then fail. */
const FILES: string[] = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

/** A doc's `src/x.ts` is that path; its `fetchers/index.ts` or `ui.tsx` is any file whose path ends so. */
function resolve(path: string): string[] {
  const p = path.replace(/^\.\//, '');
  return FILES.filter((f) => f === p || f.endsWith(`/${p}`));
}

/** `a/{b,c}-once.ts` → `a/b-once.ts`, `a/c-once.ts`. */
function expandBraces(token: string): string[] {
  const m = /\{([^{}]*)\}/.exec(token);
  if (!m) return [token];
  return m[1]!.split(',').flatMap((part) => expandBraces(token.replace(m[0], part)));
}

/** True when `name` is declared in the text: a function, class, const, type, enum or an export list entry. */
function declares(text: string, name: string): boolean {
  const n = name.replace(/\$/g, '\\$');
  return (
    new RegExp(
      String.raw`(?:^|[\s;{(,])(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+${n}\b`,
      'm',
    ).test(text) ||
    new RegExp(String.raw`export\s*\{[^}]*\b${n}\b[^}]*\}`).test(text) ||
    new RegExp(String.raw`(?:const|let)\s*\{[^}]*\b${n}\b[^}]*\}\s*=`).test(text)
  );
}

/** `model Profile { … residence … }` in the Prisma schema, read to the block's closing line (a `{}` default or comment inside must not end it). */
function schemaDeclares(text: string, name: string, member: string | undefined): boolean {
  const block = new RegExp(String.raw`^(?:model|enum)\s+${name}\s*\{([\s\S]*?)^\}`, 'm').exec(text);
  if (!block) return false;
  return member === undefined || new RegExp(String.raw`^\s*${member}\b`, 'm').test(block[1]!);
}

const CODE_EXT = 'ts|tsx|mjs|js|json|css|prisma|sql|md|yml';
/** A path (with or without a directory), then optionally `:symbol` or `:line`. A directory alone (`src/resume/`) is not read. */
const REF = new RegExp(
  String.raw`(?<![\w@./*>-])((?:[\w.@{},-]+/)*[\w.@{},-]+\.(?:${CODE_EXT}))(?::([A-Za-z_$][\w$]*(?:[./][A-Za-z_$][\w$]*)*|\d[\d-]*))?(?![\w-])`,
  'g',
);
/** A bare file name is too often a technology (`node.js`, `Next.js`); only these extensions are read without a directory. */
const BARE_EXT = /\.(ts|tsx|mjs|prisma)$/;
const NOT_OURS = /^(dist|node_modules|https?:)|:\/\//;

function problems(doc: string): string[] {
  const text = readFileSync(join(ROOT, doc), 'utf8');
  const gone = new Set(GONE[doc] ?? []);
  const out: string[] = [];
  for (const [, span = ''] of text.matchAll(/`([^`\n]+)`/g)) {
    for (const m of span.matchAll(REF)) {
      const [, rawPath = '', symbol] = m;
      if (NOT_OURS.test(rawPath) || rawPath.includes('*') || rawPath.includes('<')) continue;
      if (!rawPath.includes('/') && !BARE_EXT.test(rawPath)) continue;
      for (const path of expandBraces(rawPath)) {
        if (gone.has(path)) continue;
        const files = resolve(path);
        if (files.length === 0) {
          out.push(`${doc}: \`${path}\` does not exist`);
          continue;
        }
        if (symbol === undefined || /^\d/.test(symbol)) continue;
        for (const alternative of symbol.split('/')) {
          const [head = '', member] = alternative.split('.');
          const found = files.some((f) => {
            const source = readFileSync(join(ROOT, f), 'utf8');
            if (f.endsWith('.prisma')) return schemaDeclares(source, head, member);
            // `x.test.ts:name` points at the tests of `name`, which the file imports.
            if (/\.test\.[cm]?tsx?$/.test(f)) return new RegExp(String.raw`\b${head}\b`).test(source);
            return declares(source, head) && (member === undefined || new RegExp(String.raw`\b${member}\b`).test(source));
          });
          if (!found) out.push(`${doc}: \`${path}:${alternative}\` — no such declaration`);
        }
      }
    }
  }
  return out;
}

test('the reader finds paths and file:symbol pairs, and skips technologies and globs', () => {
  const refs = (s: string) => [...s.matchAll(REF)].map((m) => [m[1], m[2]]);
  assert.deepEqual(refs('fetchers/index.ts:runAllFetchers'), [['fetchers/index.ts', 'runAllFetchers']]);
  assert.deepEqual(refs('settings.ts:getSourceKeys/setSourceKey'), [['settings.ts', 'getSourceKeys/setSourceKey']]);
  assert.deepEqual(refs('store.ts:608-619'), [['store.ts', '608-619']]);
  assert.deepEqual(refs('prisma/schema.prisma:Profile.residence'), [['prisma/schema.prisma', 'Profile.residence']]);
  assert.deepEqual(expandBraces('src/scripts/{fetch,hn}-once.ts'), ['src/scripts/fetch-once.ts', 'src/scripts/hn-once.ts']);
  assert.ok(declares('export async function runAllFetchers(', 'runAllFetchers'));
  assert.ok(declares('function locationMatches(p) {', 'locationMatches'));
  assert.ok(declares('export const Empty: FC = () => null;', 'Empty'));
  assert.ok(!declares('runAllFetchers();', 'runAllFetchers'));
  assert.ok(schemaDeclares('model Profile {\n  id Int\n  residence String[]\n}', 'Profile', 'residence'));
  assert.ok(schemaDeclares('model Resume {\n  issues Json @default("{}")\n  structure Json?\n}', 'Resume', 'structure'));
});

test('every path and file:symbol the docs name exists', () => {
  const found = [...CURRENT, ...ADRS].flatMap(problems);
  assert.deepEqual(found, [], `\n${found.join('\n')}\n`);
});

/*
 * A bare name is checked more loosely: `onDigestHour` names no file, so the
 * test only asks that the word still occurs somewhere in the code. A
 * camelCase, PascalCase or UPPER_SNAKE word in backticks that the code no
 * longer contains is a rename the doc missed. Only a span that is one name
 * (or dotted names) is read, and a product name in backticks (`GitHub`,
 * `macOS`) would be taken for code: write it without backticks.
 */
const PLACEHOLDERS = new Set(['mapXFeed']);
const IDENT = /^(?:[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][A-Z0-9]*_[A-Z0-9_]+|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*)$/;

function codeWords(): Set<string> {
  const code = FILES.filter(
    (f) =>
      (/^(src|prisma|\.github)\//.test(f) || ['package.json', 'tailwind.config.js', '.env.example'].includes(f)) &&
      f !== 'src/docs-paths.test.ts' &&
      // An applied migration keeps the names it renamed away from.
      !f.startsWith('prisma/migrations/') &&
      !/\.(png|jpe?g|webp|gif|pdf|docx|woff2?|ttf|zip)$/.test(f),
  );
  return new Set(code.flatMap((f) => readFileSync(join(ROOT, f), 'utf8').match(/[A-Za-z_$][\w$]*/g) ?? []));
}

test('every code name the current docs mention is still in the code', () => {
  const words = codeWords();
  const missing = CURRENT.flatMap((doc) =>
    [...readFileSync(join(ROOT, doc), 'utf8').matchAll(/`([^`\n]+)`/g)].flatMap(([, span = '']) =>
      (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(span) ? span.split('.') : [])
        .filter((part) => IDENT.test(part) && !PLACEHOLDERS.has(part) && !words.has(part))
        .map((part) => `${doc}: \`${part}\``),
    ),
  );
  assert.deepEqual(missing, [], `\n${missing.join('\n')}\n`);
});

/*
 * The file tree and the diagrams sit in fenced blocks, which the backtick
 * reader never sees; ARCHITECTURE.md drew `sendTelegramAlert` and
 * `ClaudeCodeProvider` there long after both were gone. Every code-shaped
 * word in a fenced block must occur in the code too, except mermaid's own
 * keywords.
 */
const NOT_CODE = new Set(['sequenceDiagram', 'erDiagram', 'stateDiagram', 'classDiagram']);

function fencedBlocks(text: string): string[] {
  return [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map(([, body = '']) => body);
}

/* A diagram's own node ids (`apId["activeProfileId"]`, `participant TG as …`) name nothing in the code. */
function diagramIds(block: string): Set<string> {
  return new Set([
    ...[...block.matchAll(/^\s*(\w+)\s*[[({]/gm)].map(([, id = '']) => id),
    ...[...block.matchAll(/\b(?:participant|actor)\s+(\w+)/g)].map(([, id = '']) => id),
  ]);
}

test('every code name in the current docs\' fenced blocks is still in the code', () => {
  const words = codeWords();
  const missing = CURRENT.flatMap((doc) =>
    fencedBlocks(readFileSync(join(ROOT, doc), 'utf8')).flatMap((block) => {
      const ids = diagramIds(block);
      return [...new Set(block.match(/[A-Za-z_$][\w$]*/g) ?? [])]
        .filter((w) => IDENT.test(w) && !ids.has(w) && !NOT_CODE.has(w) && !PLACEHOLDERS.has(w) && !words.has(w))
        .map((w) => `${doc}: ${w} (fenced block)`);
    }),
  );
  assert.deepEqual(missing, [], `\n${missing.join('\n')}\n`);
});

/* An entity or a field in a mermaid ER diagram is a Prisma model or enum, and one of its fields. */
test('every ER diagram names the models and fields the schema has', () => {
  const schema = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
  const fields = new Map<string, Set<string>>();
  for (const [, name = '', body = ''] of schema.matchAll(/^(?:model|enum) (\w+) \{([\s\S]*?)^\}/gm)) {
    fields.set(name, new Set(body.split('\n').map((l) => l.trim().split(/\s+/)[0] ?? '').filter((w) => /^\w+$/.test(w))));
  }
  const wrong = CURRENT.flatMap((doc) =>
    fencedBlocks(readFileSync(join(ROOT, doc), 'utf8'))
      .filter((block) => /^\s*erDiagram/.test(block))
      .flatMap((block) => [
        ...[...block.matchAll(/^\s*(\w+)\s+[|}o][|o]--[|o][|{o]\s+(\w+)/gm)].flatMap(([, a = '', b = '']) =>
          [a, b].filter((m) => !fields.has(m)).map((m) => `${doc}: relation names ${m}, not a model`),
        ),
        ...[...block.matchAll(/^\s*(\w+)\s*\{([^}]*)\}/gm)].flatMap(([, entity = '', body = '']) => {
          const known = fields.get(entity);
          if (!known) return [`${doc}: entity ${entity} is not a model`];
          return body
            .split('\n')
            .map((l) => l.trim().split(/\s+/)[1])
            .filter((f): f is string => f !== undefined && !known.has(f))
            .map((f) => `${doc}: ${entity}.${f} is not a field`);
        }),
      ]),
  );
  assert.deepEqual(wrong, [], `\n${wrong.join('\n')}\n`);
});

/*
 * A route written as `POST /jobs/:id/match` must be one the dashboard
 * registers (`:param` names may differ). ARCHITECTURE.md listed
 * `POST /settings/reclassify` and `/settings/hn-run` after both had moved.
 */
/* Endpoints of other servers that the docs name in the same shape. */
const EXTERNAL_ROUTES = new Set(['POST /chat/completions']);

function routeKey(path: string): string {
  return path.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/:[A-Za-z_]\w*/g, ':p') || '/';
}

test('every route the current docs name is one the dashboard registers', () => {
  const registered = new Set(
    FILES.filter((f) => /^src\/web\/.*\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).flatMap((f) =>
      [...readFileSync(join(ROOT, f), 'utf8').matchAll(/\.(get|post|put|patch|delete|all)\(\s*['"`](\/[^'"`]*)['"`]/g)].map(
        ([, method = '', path = '']) => `${method.toUpperCase()} ${routeKey(path)}`,
      ),
    ),
  );
  assert.ok(registered.size > 50, `route parse looks wrong: ${registered.size}`);
  const unknown = CURRENT.flatMap((doc) =>
    [...readFileSync(join(ROOT, doc), 'utf8').matchAll(/\b(GET|POST|PUT|PATCH|DELETE) (\/[\w\-./:?=&]*)/g)]
      .map(([, method = '', path = '']) => `${method} ${routeKey(path.replace(/[.,;:]+$/, ''))}`)
      .filter(
        (key) =>
          !/ \/static(\/|$)/.test(key) &&
          !EXTERNAL_ROUTES.has(key) &&
          !registered.has(key) &&
          !registered.has(key.replace(/^\w+/, 'ALL')),
      )
      .map((key) => `${doc}: ${key}`),
  );
  assert.deepEqual([...new Set(unknown)], [], `\n${[...new Set(unknown)].join('\n')}\n`);
});

/*
 * The adr-writer skill carries its own copy of the register so a session
 * sees the standing decisions without opening the index. The copy is only
 * worth having while it lists the same ADRs with the same notes.
 */
test('the adr-writer skill lists the ADR register the index has', () => {
  const index = readFileSync(join(ADR_DIR, 'README.md'), 'utf8');
  const skill = readFileSync(join(ROOT, '.claude', 'skills', 'adr-writer', 'SKILL.md'), 'utf8');
  const fromIndex = [...index.matchAll(/^- \[(\d{4}) — (.*?)\]\([^)]*\)(.*)$/gm)].map(([, n, title, note]) =>
    `- ${n} ${title}${note?.trim() ? ` ${note.trim()}` : ''}`,
  );
  const fromSkill = skill.split('\n').filter((l) => /^- \d{4} /.test(l));
  assert.ok(fromIndex.length >= 54, `index parse looks wrong: ${fromIndex.length}`);
  assert.deepEqual(fromSkill, fromIndex, 'regenerate the "Standing register" in .claude/skills/adr-writer/SKILL.md from docs/adr/README.md');
});
