import { logger } from './logger';
import type { AiCallRequest, AiRuntime } from './ai-runtime';
import type { ParseResult } from './text-utils';

// A reply that does not parse gets ONE more try — the model's output varies
// between calls, a second one usually fits the schema.
const PARSE_ATTEMPTS = 2;

export interface JsonAnswer<T> {
  data: T;
  /** Engine marker for the stored row: the model, plus " · fallback" when chain #1 did not answer. */
  model: string;
  chars: number;
  attempt: number;
  ms: number;
}

/**
 * One AI call whose reply is JSON: complete, parse, retry once on a reply
 * that did not parse. Null when no engine answered or both replies failed.
 *
 * A reply cut off inside the JSON is not retried: the budget ran out, not
 * the dice, and the identical call would be cut off identically — that was
 * two full-price calls per attempt before #159.
 */
export async function askForJson<T>(
  ai: Pick<AiRuntime, 'complete'>,
  req: AiCallRequest,
  parse: (text: string) => ParseResult<T>,
  context: Record<string, unknown> = {},
): Promise<JsonAnswer<T> | null> {
  for (let attempt = 0; attempt < PARSE_ATTEMPTS; attempt++) {
    const started = Date.now();
    const out = await ai.complete(req);
    if (out === null) return null;
    const parsed = parse(out.text);
    if (parsed.ok) {
      return {
        data: parsed.data,
        model: (out.model || out.providerId) + (out.viaFallback ? ' · fallback' : ''),
        chars: out.text.length,
        attempt,
        ms: Date.now() - started,
      };
    }
    logger.warn(
      { ...context, label: req.label, attempt, error: parsed.error, raw: out.text.slice(0, 500) },
      'ai: reply did not parse',
    );
    if (parsed.cutOff) return null;
  }
  return null;
}
