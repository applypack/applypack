import { z } from 'zod';

/**
 * Shape of `claude -p --output-format json`. Only the fields we act on are
 * declared; everything else (usage, cost, session id) passes through
 * untouched. Kept SDK-free so the parser can be unit-tested.
 */
const ClaudeCodeResultSchema = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  api_error_status: z.number().nullable().optional(),
});

export interface ClaudeCodeOutcome {
  text: string | null;
  /** True for 429 / overloaded — the caller may retry later. */
  rateLimited: boolean;
  error: string | null;
}

const RATE_LIMIT_STATUS = 429;
const RATE_LIMIT_PATTERN = /rate.?limit|usage limit|overloaded/i;

export function parseClaudeCodeOutput(raw: string): ClaudeCodeOutcome {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { text: null, rateLimited: false, error: 'claude-code: output is not JSON' };
  }
  const parsed = ClaudeCodeResultSchema.safeParse(json);
  if (!parsed.success) {
    return { text: null, rateLimited: false, error: 'claude-code: unexpected result shape' };
  }
  const r = parsed.data;
  if (r.is_error || r.subtype !== 'success') {
    const message = r.result ?? r.subtype;
    const rateLimited =
      r.api_error_status === RATE_LIMIT_STATUS || RATE_LIMIT_PATTERN.test(message);
    return { text: null, rateLimited, error: `claude-code: ${message}` };
  }
  return { text: r.result ?? '', rateLimited: false, error: null };
}
