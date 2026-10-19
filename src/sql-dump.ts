/*
 * Reading a `pg_dump --data-only --inserts` file for `npm run db:import`
 * (TASKS S7): the built-in database ships no psql, so the dump is split into
 * statements here and each one is run through the app's own connection.
 * Pure — tested on a dump pg_dump 16 wrote.
 */

const IDENT_CHAR = /[A-Za-z0-9_$]/;
const DOLLAR_TAG = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;

/**
 * The statements of a SQL script, without its comments and psql
 * meta-commands (`\restrict`, `\connect` … — psql's, not SQL, and only ever
 * where a statement would start). A `;` inside a string, a quoted identifier
 * or a dollar-quoted body is text; `E'…'` strings take backslash escapes, the
 * rest double their quote.
 */
export function splitSql(text: string): string[] {
  const statements: string[] = [];
  let parts: string[] = [];
  let segStart = 0;
  let atStart = true;
  let i = 0;
  const skipComment = (): boolean => {
    if (text.startsWith('--', i)) {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end;
      return true;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      return true;
    }
    return false;
  };
  while (i < text.length) {
    const c = text[i]!;
    if (atStart) {
      if (/\s/.test(c)) {
        i++;
      } else if (c === '\\') {
        const end = text.indexOf('\n', i);
        i = end === -1 ? text.length : end + 1;
      } else if (!skipComment()) {
        atStart = false;
        segStart = i;
        continue;
      }
      segStart = i;
      continue;
    }
    if (c === '-' || c === '/') {
      const from = i;
      if (skipComment()) {
        parts.push(text.slice(segStart, from), ' ');
        segStart = i;
        continue;
      }
    }
    if (c === "'") {
      const before = i >= 2 ? text[i - 2]! : '';
      const escapes = (text[i - 1] === 'E' || text[i - 1] === 'e') && !IDENT_CHAR.test(before);
      i = endOfQuoted(text, i, "'", escapes);
      continue;
    }
    if (c === '"') {
      i = endOfQuoted(text, i, '"', false);
      continue;
    }
    if (c === '$' && (i === 0 || !IDENT_CHAR.test(text[i - 1]!))) {
      DOLLAR_TAG.lastIndex = i;
      const tag = DOLLAR_TAG.exec(text);
      if (tag) {
        const end = text.indexOf(tag[0], i + tag[0].length);
        i = end === -1 ? text.length : end + tag[0].length;
        continue;
      }
    }
    if (c === ';') {
      parts.push(text.slice(segStart, i));
      const statement = parts.join('').trim();
      if (statement) statements.push(statement);
      parts = [];
      i++;
      segStart = i;
      atStart = true;
      continue;
    }
    i++;
  }
  if (!atStart) parts.push(text.slice(segStart));
  const last = parts.join('').trim();
  if (last) statements.push(last);
  return statements;
}

/** The index just past a quoted run that opens at `start`. */
function endOfQuoted(text: string, start: number, quote: string, backslashEscapes: boolean): number {
  let j = start + 1;
  while (j < text.length) {
    const c = text[j];
    if (backslashEscapes && c === '\\') {
      j += 2;
      continue;
    }
    if (c === quote) {
      if (text[j + 1] === quote) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return text.length;
}

export interface ImportPlan {
  /** The inserts and the sequence positions, in the dump's order. */
  statements: string[];
  /** Rows per table, for the summary. */
  rows: Map<string, number>;
}

const INSERT = /^INSERT\s+INTO\s+(?:"?public"?\.)?"?([A-Za-z0-9_]+)"?/i;
const SETVAL = /^SELECT\s+pg_catalog\.setval\(/i;
/** Session settings and the trigger switches `--disable-triggers` writes: the importer does its own. */
const SKIP = /^(SET\s|SELECT\s+pg_catalog\.set_config\(|ALTER\s+TABLE\s+\S+\s+(DISABLE|ENABLE)\s+TRIGGER\s+ALL)/i;
const SCHEMA = /^(CREATE|ALTER|DROP|COMMENT|GRANT|REVOKE)\b/i;
/** Which migrations ran is this install's own history, never the dump's. */
const OWN_TABLES = new Set(['_prisma_migrations']);

/**
 * What an import runs, or why this file is not one it can: COPY needs psql,
 * a schema is ApplyPack's own to create, and an empty dump has nothing to give.
 */
export function importPlan(statements: readonly string[]): { ok: true; plan: ImportPlan } | { ok: false; reason: string } {
  const kept: string[] = [];
  const rows = new Map<string, number>();
  for (const statement of statements) {
    const insert = INSERT.exec(statement);
    if (insert) {
      const table = insert[1]!;
      if (OWN_TABLES.has(table)) continue;
      kept.push(statement);
      rows.set(table, (rows.get(table) ?? 0) + 1);
      continue;
    }
    if (SETVAL.test(statement)) {
      kept.push(statement);
      continue;
    }
    if (SKIP.test(statement)) continue;
    if (/^COPY\b/i.test(statement)) {
      return { ok: false, reason: 'this dump carries its rows as COPY, which needs psql — make it again with --inserts' };
    }
    if (SCHEMA.test(statement)) {
      return { ok: false, reason: 'this dump carries the tables too — make it again with --data-only, ApplyPack creates its own' };
    }
    return { ok: false, reason: `this dump holds a statement an import does not run: ${statement.slice(0, 60)}…` };
  }
  if (rows.size === 0) return { ok: false, reason: 'this dump holds no rows' };
  return { ok: true, plan: { statements: kept, rows } };
}

/** What empties the tables before the rows go in; null with no table, where `TRUNCATE` and an empty list is a syntax error (#550). */
export function truncateStatement(tables: readonly string[]): string | null {
  return tables.length === 0 ? null : `TRUNCATE ${tables.map((name) => `"public"."${name}"`).join(', ')} RESTART IDENTITY CASCADE`;
}
