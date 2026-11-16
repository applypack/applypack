import fs from 'node:fs';
import os from 'node:os';
import pino from 'pino';
import { config } from './config';
import { underLauncher } from './local/child';
import { dataDirFor } from './local/data-dir';
import { logFilePath, MAX_LOG_BYTES } from './local/log-file';

/**
 * A safety net, not the rule. Nothing deliberately logs a secret —
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

const PRETTY = { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname', singleLine: false };

/**
 * Under `npm start` the log also goes to a file in the data folder (#769):
 * the terminal stays at warnings, and the file keeps `info`, so "the log has
 * the detail" is true of something a person can open. Rolled over once at a
 * start, when it has grown past `MAX_LOG_BYTES`.
 */
function localLogFile(): string | null {
  // 'silent' is a person asking for no log at all.
  if (!underLauncher() || config.LOG_LEVEL === 'silent') return null;
  const file = logFilePath(dataDirFor(process.platform, process.env, os.homedir()));
  try {
    if (fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    // No file yet, or one that cannot be moved: the log is appended to as it is.
  }
  return file;
}

const file = localLogFile();
const fileLevel = pino.levels.values[config.LOG_LEVEL]! < pino.levels.values.info! ? config.LOG_LEVEL : 'info';

export const logger = pino({
  level: file ? fileLevel : config.LOG_LEVEL,
  base: undefined,
  redact: {
    paths: REDACT_PATHS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // JSON in production (Docker); readable lines for a person at a terminal.
  transport: file
    ? {
        targets: [
          { target: 'pino-pretty', level: config.LOG_LEVEL, options: { ...PRETTY, colorize: true } },
          {
            target: 'pino-pretty',
            level: fileLevel,
            options: { ...PRETTY, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss', singleLine: true, colorize: false, destination: file, mkdir: true },
          },
        ],
      }
    : config.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { ...PRETTY, colorize: true } },
});
