import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CLI_PROVIDER_ENV_KEYS } from './ai-provider-parse';
import { ConfigSchema } from './config';
import { DATA_DIR_ENV } from './local/data-dir';

/*
 * `.env.example` is the one place a person reads which settings exist. These
 * tests keep it in step with the code: what `config.ts` parses, and every
 * variable read straight off `process.env`.
 */

const SRC = __dirname;
const EXAMPLE = readFileSync(join(SRC, '..', '.env.example'), 'utf8');

/** Documented in `.env.example`, read by something other than `config.ts`. */
const READ_ELSEWHERE: Record<string, string> = {
  GEMINI_API_KEY: "the gemini_cli child's environment (ai-provider-parse.ts)",
  CLAUDE_CODE_OAUTH_TOKEN: "the claude_code child's environment (ai-provider-parse.ts)",
  [DATA_DIR_ENV]: 'the launcher, which reads .env itself (local/data-dir.ts)',
  APPLYPACK_NO_OPEN: 'the launcher (local/launcher.ts)',
  APPLYPACK_SNAPSHOTS: 'the launcher (local/launcher.ts)',
  WITH_CLI_ENGINES: 'docker compose, as the image\'s build argument (docker-compose.yml)',
};

/** Read off `process.env` and deliberately not in `.env.example`, with the reason. */
const UNDOCUMENTED: Record<string, string> = {
  CI: 'set by the CI runner, never by a person',
  PATH: "the system's own; the login entry keeps it so the CLI engines are found at login (web/login-item-io.ts)",
};

/** `KEY=value` or `# KEY=value`: a setting shown, set or commented out. */
function exampleKeys(text: string): Set<string> {
  return new Set([...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!));
}

function sources(): string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !e.name.includes('.test.'))
    .map((e) => relative(SRC, join(e.parentPath, e.name)).split(sep).join('/'));
}

test('every variable config.ts parses is in .env.example', () => {
  const documented = exampleKeys(EXAMPLE);
  const missing = Object.keys(ConfigSchema.shape).filter((k) => !documented.has(k));
  assert.deepEqual(missing, [], `add to .env.example: ${missing.join(', ')}`);
});

test('every variable .env.example names is read by the code', () => {
  const parsed = new Set(Object.keys(ConfigSchema.shape));
  const stale = [...exampleKeys(EXAMPLE)].filter((k) => !parsed.has(k) && !(k in READ_ELSEWHERE));
  assert.deepEqual(stale, [], `nothing reads: ${stale.join(', ')} — delete it, or name its reader in READ_ELSEWHERE`);
});

test('every variable read off process.env is in .env.example or has a reason not to be', () => {
  // A CLI engine's own settings pass through to its child untouched; the
  // engine's setup guide names them, not ours (docs/ai-engines.md).
  const passThrough = new Set(Object.values(CLI_PROVIDER_ENV_KEYS).flat());
  const documented = exampleKeys(EXAMPLE);
  const undocumented = new Set<string>();
  for (const file of sources()) {
    const text = readFileSync(join(SRC, file), 'utf8');
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      const key = m[1]!;
      if (!documented.has(key) && !(key in UNDOCUMENTED) && !passThrough.has(key)) undocumented.add(`${key} (${file})`);
    }
  }
  assert.deepEqual([...undocumented], [], `document in .env.example, or give the reason in UNDOCUMENTED`);
});

test('the parser reads a set, an empty and a commented-out setting, and no prose', () => {
  assert.deepEqual([...exampleKeys('A_B=1\nEMPTY=\n# COMMENTED=2\n# Set it to 3 = more\n')], ['A_B', 'EMPTY', 'COMMENTED']);
});
