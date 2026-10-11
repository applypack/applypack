import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../db';
import { importPlan, splitSql } from '../sql-dump';
import { dataDirFor, localPaths } from '../local/data-dir';
import { NO_ANSWER, firstLinePid } from '../local/postgres-setup';
import { commandLineOf, pidAlive } from '../local/postgres';

/*
 * `npm run db:import -- <file> [--yes]` (TASKS S7): the rows of a Docker
 * install, dumped with `pg_dump --data-only --inserts --column-inserts`, into
 * this install's database — whatever was in it replaced, in one transaction,
 * so a dump that fails half-way leaves the database as it was. Run with only
 * the database up (`npm run db`): a worker ticking beside it would write into
 * the tables while they are replaced.
 */

/** The import runs one statement at a time; a big install is tens of thousands of rows. */
const IMPORT_TIMEOUT_MS = 30 * 60_000;
const PROGRESS_EVERY = 2_000;

const say = (line = '') => process.stdout.write(`${line}\n`);

function fail(message: string): never {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

/** A launcher running `start` (a worker beside the database) holds the data folder's lock. */
async function workerRunning(): Promise<boolean> {
  const paths = localPaths(dataDirFor(process.platform, process.env, os.homedir()));
  const pid = fs.existsSync(paths.lock) ? firstLinePid(fs.readFileSync(paths.lock, 'utf8')) : null;
  if (pid === null) return false;
  const command = await commandLineOf(pid);
  // No answer in time about a process that is there: an import must not run beside a worker it could not rule out.
  if (command === NO_ANSWER) return pidAlive(pid);
  return command !== null && /launcher\.js(\s+start)?\s*$/.test(command);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    fail(
      'Usage: npm run db:import -- <dump.sql> --yes\n' +
        'Make the dump on the Docker install with:\n' +
        '  docker compose exec -T postgres pg_dump -U jobhunter --data-only --inserts --column-inserts jobhunter > applypack-data.sql',
    );
  }
  const planned = importPlan(splitSql(fs.readFileSync(path.resolve(file), 'utf8')));
  if (!planned.ok) fail(`Nothing imported: ${planned.reason}.`);
  const { statements, rows } = planned.plan;
  const total = [...rows.values()].reduce((a, b) => a + b, 0);
  say(`${total.toLocaleString('en-US')} rows in ${rows.size} tables, from ${file}.`);
  if (!args.includes('--yes')) {
    fail('This replaces everything in this ApplyPack\'s database with the dump. Run it again with --yes to go ahead.');
  }
  if (await workerRunning()) {
    fail('ApplyPack is running, and its worker would write while the tables are replaced. Stop it (npm run stop), start only the database (npm run db), then import.');
  }
  const started = Date.now();
  await prisma.$transaction(
    async (tx) => {
      // The built-in database's user is its superuser: foreign keys wait for the whole import, not row by row.
      const [role] = await tx.$queryRawUnsafe<{ rolsuper: boolean }[]>('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
      if (role?.rolsuper) await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      const tables = await tx.$queryRawUnsafe<{ tablename: string }[]>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
      );
      await tx.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
      for (const [i, statement] of statements.entries()) {
        await tx.$executeRawUnsafe(statement);
        if ((i + 1) % PROGRESS_EVERY === 0) say(`  ${(i + 1).toLocaleString('en-US')} of ${statements.length.toLocaleString('en-US')}…`);
      }
    },
    { timeout: IMPORT_TIMEOUT_MS, maxWait: 30_000 },
  );
  say(`Imported in ${Math.round((Date.now() - started) / 1000)} s:`);
  for (const [table, count] of [...rows].sort((a, b) => b[1] - a[1])) say(`  ${table}: ${count.toLocaleString('en-US')}`);
  say('Start ApplyPack as usual (npm run stop, then npm start).');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err: unknown) => {
    await prisma.$disconnect();
    const message = err instanceof Error ? err.message : String(err);
    // A dump from a newer ApplyPack names a column this one does not have yet.
    fail(
      /Can't reach database server|ECONNREFUSED/.test(message)
        ? 'The database is not running. Start it in another terminal with npm run db, then run this again.'
        : `The import stopped and nothing was changed: ${message.split('\n').find((l) => l.trim()) ?? message}`,
    );
  });
