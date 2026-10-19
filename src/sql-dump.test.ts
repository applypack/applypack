import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importPlan, splitSql, truncateStatement } from './sql-dump';

// TASKS S7. The fixture is what pg_dump 16.15 wrote for `--data-only --inserts
// --column-inserts` of a scratch database seeded with text a naive split breaks.
const DUMP = readFileSync(join(__dirname, 'fixtures', 'pg-dump-data-only.sql'), 'utf8');

test("a real dump: the rows are read, psql's lines and the migration history are not", () => {
  const plan = importPlan(splitSql(DUMP));
  assert.ok(plan.ok);
  const { rows, statements } = plan.plan;
  assert.deepEqual(Object.fromEntries(rows), { app_settings: 1, company: 2, job: 1 });
  assert.ok(!statements.some((s) => s.includes('_prisma_migrations')));
  assert.ok(!statements.some((s) => s.startsWith('\\')));
  assert.ok(statements.some((s) => s.startsWith("SELECT pg_catalog.setval('public.company_id_seq', 2, true)")));
});

test('a string keeps what looks like SQL inside it', () => {
  const plan = importPlan(splitSql(DUMP));
  assert.ok(plan.ok);
  const job = plan.plan.statements.find((s) => s.startsWith('INSERT INTO public.job '))!;
  for (const piece of [
    "'Line one; with a semicolon.",
    "it''s a ''quote'' and a \\ backslash.",
    '/* not a comment */ -- nor this;',
    '$$ dollar $$ text',
    'Зарплата: 5000$; JSON {"a": [1, 2]}',
  ]) {
    assert.ok(job.includes(piece), piece);
  }
  const company = plan.plan.statements.find((s) => s.startsWith('INSERT INTO public.company ') && s.includes('VALUES (1,'))!;
  assert.ok(company.includes(`'O''Reilly; Sons -- "Ltd"'`));
});

test('the splitter: comments, meta-commands, E-strings, dollar quotes, quoted names', () => {
  assert.deepEqual(
    splitSql([
      '-- a comment; with a semicolon',
      '\\restrict abc',
      "INSERT INTO t VALUES (E'it\\'s; still one', 'a''b;c');",
      '/* block; */ SELECT 1;',
      'SELECT $tag$ a; b $tag$, "col;name" FROM x;',
      '\\unrestrict abc',
      '',
    ].join('\n')),
    ["INSERT INTO t VALUES (E'it\\'s; still one', 'a''b;c')", 'SELECT 1', 'SELECT $tag$ a; b $tag$, "col;name" FROM x'],
  );
  assert.deepEqual(splitSql('SELECT 1 -- trailing\n;'), ['SELECT 1']);
  assert.deepEqual(splitSql('   \n'), []);
});

test('a dump an import cannot run says why', () => {
  const refuse = (sql: string) => {
    const plan = importPlan(splitSql(sql));
    return plan.ok ? null : plan.reason;
  };
  assert.match(refuse('COPY public.job (id) FROM stdin;\n1\n\\.\n') ?? '', /--inserts/);
  assert.match(refuse('CREATE TABLE public.job (id int);') ?? '', /--data-only/);
  assert.match(refuse('SET x = 1;') ?? '', /no rows/);
  assert.match(refuse("INSERT INTO public.job (id) VALUES (1);\nVACUUM;") ?? '', /does not run/);
  assert.equal(refuse('ALTER TABLE public.job DISABLE TRIGGER ALL;\nINSERT INTO public.job (id) VALUES (1);\nALTER TABLE public.job ENABLE TRIGGER ALL;'), null);
});

test('the tables are emptied in one statement, and a database with none is not asked to (#550)', () => {
  assert.equal(truncateStatement([]), null);
  assert.equal(truncateStatement(['job', 'company']), 'TRUNCATE "public"."job", "public"."company" RESTART IDENTITY CASCADE');
});
