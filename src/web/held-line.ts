import type { HeldReason } from '../jobs/held-alerts';
import { t } from '../i18n/t';

/**
 * The waiting line on Overview and on the Schedule card: how many matches
 * are held, what holds them, and the one place to change it. Pure.
 */
export interface HeldLine {
  text: string;
  href: string;
  action: string;
}

/** Where the alert window is set — the Schedule card, which therefore links nowhere. */
export const SCHEDULE_HREF = '/settings?tab=general';
const NOTIFICATIONS_HREF = '/settings?tab=notifications';

export function heldLine(count: number, reason: HeldReason): HeldLine {
  // One whole sentence per reason: "is waiting" and "it" both follow the count, and not only in English.
  const n = { n: count };
  switch (reason) {
    case 'alerts-off':
      return { text: t('held.alertsOff', n), href: NOTIFICATIONS_HREF, action: t('held.alertsOff.action') };
    case 'no-targets':
      return { text: t('held.noTargets', n), href: NOTIFICATIONS_HREF, action: t('held.noTargets.action') };
    case 'next-check':
      return { text: t('held.nextCheck', n), href: NOTIFICATIONS_HREF, action: t('held.nextCheck.action') };
    case 'window':
      return { text: t('held.window', n), href: SCHEDULE_HREF, action: t('held.window.action') };
  }
}
