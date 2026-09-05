import type { NotificationTarget } from '@prisma/client';
import { maskToken } from '../text-utils';
import { maskWebhook } from './discord';

export const KIND_LABEL = { TELEGRAM: 'Telegram', DISCORD: 'Discord' } as const;

/** Where a target delivers, its secret masked — the settings table's Destination column. Pure. */
export function describeDestination(t: Pick<NotificationTarget, 'kind' | 'botToken' | 'chatId' | 'webhookUrl'>): string {
  if (t.kind === 'DISCORD') return t.webhookUrl ? maskWebhook(t.webhookUrl) : '(no webhook)';
  return `${t.botToken ? maskToken(t.botToken) : '***'} · chat ${t.chatId ?? '?'}`;
}
