/**
 * What every Prisma CLI command ApplyPack runs is given on top of its own
 * environment (#524). Without it the CLI forks a child that reports the
 * command to checkpoint.prisma.io — its update check and usage telemetry — on
 * every start, and nothing is meant to leave the machine but the calls to the
 * AI engine and the user's own chats. The Dockerfile sets the same in every
 * stage (`prisma-env.test.ts`).
 */
export const PRISMA_CLI_ENV = { CHECKPOINT_DISABLE: '1' } as const;
