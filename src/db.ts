import { PrismaClient } from '@prisma/client';
import { config } from './config';

export const prisma = new PrismaClient({
  // From config rather than the schema's env(): the built-in database's URL
  // comes from db.json when .env has none (ADR 0054).
  datasourceUrl: config.DATABASE_URL,
  log: ['warn', 'error'],
});
