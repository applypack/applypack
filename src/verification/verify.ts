import type { JobVerification, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { getAiRuntime } from '../ai-runtime';
import { buildVerifyPrompt, parseVerifyResponse, VERIFY_MAX_TOKENS, type VerifyJobInput } from './prompts';
import { runLivenessLadder, type LivenessJobInput, type LivenessResult } from './liveness';

// Web research through the CLI can take several minutes.
const VERIFY_TIMEOUT_MS = 10 * 60_000;
const PARSE_ATTEMPTS = 2;

/** Rungs 1-2 of the ladder (ADR 0016): free checks, verdict stored on the Job row. */
export async function checkLiveness(job: LivenessJobInput & { id: number }): Promise<LivenessResult> {
  const result = await runLivenessLadder(job);
  await prisma.job.update({
    where: { id: job.id },
    data: { liveness: result.liveness, livenessCode: result.code, livenessCheckedAt: new Date() },
  });
  logger.info({ jobId: job.id, ...result }, 'liveness: checked');
  return result;
}

/** Runs the ghost-job check with web tools and stores the verdict. Null on AI failure. */
export async function verifyJob(job: VerifyJobInput & { id: number }): Promise<JobVerification | null> {
  const prompt = buildVerifyPrompt(job);
  const ai = await getAiRuntime();
  for (let attempt = 0; attempt < PARSE_ATTEMPTS; attempt++) {
    const out = await ai.complete({
      ...prompt,
      maxTokens: VERIFY_MAX_TOKENS,
      label: 'job-verify',
      role: 'resume',
      timeoutMs: VERIFY_TIMEOUT_MS,
      webTools: true,
    });
    if (out === null) return null;
    const parsed = parseVerifyResponse(out.text);
    if (parsed.ok) {
      const r = parsed.data;
      const row = await prisma.jobVerification.create({
        data: {
          jobId: job.id,
          model: (out.model || out.providerId) + (out.viaFallback ? ' · fallback' : ''),
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
    logger.warn({ jobId: job.id, attempt, error: parsed.error, raw: out.text.slice(0, 500) }, 'verify: reply did not match schema');
  }
  return null;
}

export async function listVerificationsForJob(jobId: number): Promise<JobVerification[]> {
  return prisma.jobVerification.findMany({ where: { jobId }, orderBy: { createdAt: 'desc' } });
}
