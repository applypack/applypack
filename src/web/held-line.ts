import type { HeldReason } from '../jobs/held-alerts';

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
  const waiting = `${count} ${count === 1 ? 'match is' : 'matches are'} waiting`;
  switch (reason) {
    case 'alerts-off':
      return { text: `${waiting}: Alerts are switched off`, href: NOTIFICATIONS_HREF, action: 'switch them on' };
    case 'no-targets':
      return { text: `${waiting} for a chat to send ${count === 1 ? 'it' : 'them'} to`, href: NOTIFICATIONS_HREF, action: 'add one' };
    case 'next-check':
      return { text: `${waiting} to be sent at the next hourly check`, href: NOTIFICATIONS_HREF, action: 'see the chats' };
    case 'window':
      return { text: `${waiting} for the alert window to open`, href: SCHEDULE_HREF, action: 'change when alerts arrive' };
  }
}
