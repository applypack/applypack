/*
 * The two rows a search profile points at — its resume and its alert
 * target — are picked from dropdowns rendered when the page loaded. Either
 * can be deleted in another tab before the form is submitted, and handing a
 * dead id to Prisma answers with a raw foreign-key error: a 500 page with a
 * constraint name on it, and the whole edit lost (issue #73).
 *
 * Pure: the route looks the ids up, this decides what to say.
 */

export interface ProfileLinks {
  /** True when the form named a resume that no longer exists. */
  resumeGone: boolean;
  /** True when the form named an alert target that no longer exists. */
  notificationTargetGone: boolean;
}

/**
 * The flash for a save that cannot go through, or null when both links are
 * fine. Names what went and what to do, because the dropdown the user is
 * sent back to will no longer contain it.
 */
export function missingLinkMessage(links: ProfileLinks): string | null {
  if (links.resumeGone && links.notificationTargetGone) {
    return 'That resume and that alert target no longer exist — reload the page and pick again. Nothing was saved.';
  }
  if (links.resumeGone) {
    return 'That resume no longer exists — reload the page and pick another one. Nothing was saved.';
  }
  if (links.notificationTargetGone) {
    return 'That alert target no longer exists — reload the page and pick another one. Nothing was saved.';
  }
  return null;
}
