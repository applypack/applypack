import type { JobVerification, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { getAiProvider } from '../ai-provider';
import { buildVerifyPrompt, parseVerifyResponse, VERIFY_MAX_TOKENS, type VerifyJobInput } from './prompts';

// Web research through the CLI can take several minutes.
const VERIFY_TIMEOUT_MS = 10 * 60_000;
const PARSE_ATTEMPTS = 2;

/** Runs the ghost-job check with web tools and stores the verdict. Null on AI failure. */
export async function verifyJob(job: VerifyJobInput & { id: number }): Promise<JobVerification | null> {
  const prompt = buildVerifyPrompt(job);
  const provider = getAiProvider();
  const model = config.CLAUDE_MODEL_RESUME;
  for (let attempt = 0; attempt < PARSE_ATTEMPTS; attempt++) {
    const text = await provider.complete({
      ...prompt,
      maxTokens: VERIFY_MAX_TOKENS,
      label: 'job-verify',
      model,
      timeoutMs: VERIFY_TIMEOUT_MS,
      webTools: true,
    });
    if (text === null) return null;
    const parsed = parseVerifyResponse(text);
    if (parsed.ok) {
      const r = parsed.data;
      const row = await prisma.jobVerification.create({
        data: {
          jobId: job.id,
          model,
          verdict: r.verdict,
          recommendation: r.recommendation,
          confidence: r.confidence,
          summary: r.summary,
          evidence: r.evidence as Prisma.InputJsonValue,
          redFlags: r.red_flags,
          companySnapshot: r.company_snapshot,
        },
      });
      logger.info({ jobId: job.id, verdict: r.verdict, recommendation: r.recommendation }, 'verify: done');
      return row;
    }
    logger.warn({ jobId: job.id, attempt, error: parsed.error, raw: text.slice(0, 500) }, 'verify: reply did not match schema');
  }
  return null;
}

export async function listVerificationsForJob(jobId: number): Promise<JobVerification[]> {
  return prisma.jobVerification.findMany({ where: { jobId }, orderBy: { createdAt: 'desc' } });
}
