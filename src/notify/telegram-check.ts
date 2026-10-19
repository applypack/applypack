import { z } from 'zod';

/*
 * What the Bot API's answer to a connection test means for the person typing
 * the form (#561): which field was wrong, in words, never the JSON. Pure.
 */

/** What a failed connection test was refused for: the bot token, the chat, or Telegram itself. */
export type TelegramFailure = 'token' | 'chat' | 'telegram';

/**
 * Which part a failed Bot API call says was wrong, by its status: Telegram
 * answers a revoked token with 401 and a malformed one with 404, and a chat
 * the bot cannot write to — unknown, or one that never started the bot — with
 * 400 or 403 on sending. Anything else (a 429, a 5xx) is Telegram's.
 */
export function telegramFailure(call: 'getMe' | 'sendMessage', status: number): TelegramFailure {
  if (status === 401 || status === 404) return 'token';
  if (call === 'sendMessage' && (status === 400 || status === 403)) return 'chat';
  return 'telegram';
}

const TelegramErrorSchema = z.object({ description: z.string().min(1) });

/** "429 Too Many Requests": Telegram's own words beside the status, never the JSON they came in. */
export function telegramReason(status: number, body: string): string {
  try {
    return `${status} ${TelegramErrorSchema.parse(JSON.parse(body)).description}`;
  } catch {
    return `HTTP ${status}`;
  }
}
