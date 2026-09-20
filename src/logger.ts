import pino from 'pino';
import { config } from './config';

/**
 * A safety net, not the rule (H17). Nothing deliberately logs a secret —
 * `ai-provider-parse.ts` scrubs a CLI's stderr and the settings pages render
 * keys masked — but a log line is written by whoever is in a hurry, and
 * `logger.error({ err })` on a thrown object carries whatever that object
 * holds. These paths are redacted wherever they appear in a log line's
 * object, at any depth.
 *
 * `resumeText` is here for a different reason: not a secret, but a whole
 * resume in the log is personal data sitting in a file nobody remembers to
 * rotate. A bare `text` is deliberately NOT on the list — half the project's
 * log lines would say "[redacted]" and stop being useful.
 */
const REDACT_PATHS = [
  'apiKey',
  'api_key',
  'botToken',
  'webhookUrl',
  'client_secret',
  'clientSecret',
  'password',
  'authorization',
  'Authorization',
  'resumeText',
];

export const logger = pino({
  level: config.LOG_LEVEL,
  base: undefined,
  redact: {
    paths: REDACT_PATHS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname',
      singleLine: false,
    },
  },
});
