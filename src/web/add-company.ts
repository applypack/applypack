import { extractAtsToken, type DiscoverableAtsType } from '../text-utils';

/*
 * What "Add one company" reads off its token field (#534). Pure — tested in
 * add-company.test.ts. People paste what they copy, a board's link, and the
 * route probed the link as if it were a slug: "HTTP 404 — token likely
 * invalid" for job-boards.greenhouse.io/netlify.
 */

/** The vendors whose token is a slug, and whose board links `extractAtsToken` reads; every one of them, or this does not compile. */
const SLUG_VENDORS: Record<DiscoverableAtsType, true> = {
  GREENHOUSE: true,
  LEVER: true,
  ASHBY: true,
  WORKABLE: true,
  SMARTRECRUITERS: true,
  RECRUITEE: true,
  BREEZY: true,
  BAMBOOHR: true,
  PINPOINT: true,
  RIPPLING: true,
  PERSONIO: true,
  TEAMTAILOR: true,
};

export type BoardInput<T extends string> =
  | {
      ok: true;
      atsType: T | DiscoverableAtsType;
      atsToken: string;
      /** The ATS the select said, when the link named another: the link wins, and the flash says so. */
      picked: T | null;
    }
  /** A link to no board, for a vendor whose token is a slug: a careers page, which the watchlist reads instead. */
  | { ok: false };

/**
 * A link to a board is the board it names, whatever the select says; a
 * feed's or a careers page's token is a link by design and is kept as typed,
 * and so is a slug or a query.
 */
export function readBoardInput<T extends string>(atsType: T, typed: string): BoardInput<T> {
  const token = typed.trim();
  const board = extractAtsToken(token);
  if (board) return { ok: true, atsType: board.atsType, atsToken: board.atsToken, picked: board.atsType === atsType ? null : atsType };
  if (Object.hasOwn(SLUG_VENDORS, atsType) && /^https?:\/\//i.test(token)) return { ok: false };
  return { ok: true, atsType, atsToken: token, picked: null };
}
