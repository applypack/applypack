import type { NotificationTarget } from '@prisma/client';
import { t } from '../i18n/t';
import { maskToken } from '../text-utils';
import { maskWebhook } from './discord';

export const KIND_LABEL = { TELEGRAM: 'Telegram', DISCORD: 'Discord' } as const;

/** Where a target delivers, its secret masked — the settings table's Destination column. Pure. */
export function describeDestination(target: Pick<NotificationTarget, 'kind' | 'botToken' | 'chatId' | 'webhookUrl'>): string {
  if (target.kind === 'DISCORD') return target.webhookUrl ? maskWebhook(target.webhookUrl) : t('settings.destination.noWebhook');
  return t('settings.destination.telegram', { token: target.botToken ? maskToken(target.botToken) : '***', chat: target.chatId ?? '?' });
}
