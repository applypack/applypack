// `prisma <args>` for the npm scripts, `npm install`'s postinstall among them,
// with CHECKPOINT_DISABLE=1 (#610): without it the CLI forks a child that
// reports the command to checkpoint.prisma.io. `src/prisma-env.ts` gives every
// other Prisma command ApplyPack runs the same switch. An npm script cannot set
// a variable on Windows and Unix alike, hence this file; the CLI is started as
// its own `bin` with this Node, as `npx prisma` would start it, with no shell.
const { spawnSync } = require('node:child_process');
const { dirname, join } = require('node:path');

const manifest = require.resolve('prisma/package.json');
const cli = join(dirname(manifest), require(manifest).bin.prisma);
const run = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, CHECKPOINT_DISABLE: '1' },
});
if (run.error) throw run.error;
process.exit(run.status ?? 1);
