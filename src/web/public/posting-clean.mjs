/*
 * Deterministic cleaner for pasted postings. A Ctrl+A copy of a LinkedIn (or
 * similar) job page drags along navigation, buttons, counters and "similar
 * jobs" — noise that would pollute the stored description and the keyword
 * highlighter. Pure string → string, no DOM, no AI: conservative line filters
 * plus head/tail markers, with a safety valve that returns the original text
 * whenever cleaning looks too aggressive. Tested from src/web/target-start.test.ts.
 */

/** The posting body starts here on LinkedIn-style pages — everything before is chrome. */
const HEAD_MARKERS = [/^about the (job|role|position)$/i];

/** Everything from these lines on is page chrome, never posting content. */
const TAIL_MARKERS = [
  /^set alert for similar jobs$/i,
  /^similar jobs$/i,
  /^people also viewed$/i,
  /^more jobs like this$/i,
  /^looking for talent\?$/i,
  /^explore collaborative articles$/i,
];

/** Site navigation — chrome that also BOUNDS the job-header block above the body. */
const NAV_LINES = [
  /^skip to main content$/i,
  /^sign in$/i,
  /^join now$/i,
  /^(home|my network|jobs|messaging|notifications|me|for business)$/i,
];

/** Buttons and counters that appear INSIDE the header block — filtered, never bounding. */
const SOFT_NOISE = [
  /^(easy )?apply( now)?$/i,
  /^save$/i,
  /^saved?$/i,
  /^share$/i,
  /^report this job$/i,
  /^show (more|less)$/i,
  /^see (more|less)$/i,
  /^\d[\d,.]* (applicants?|followers|employees|connections)$/i,
  /^promoted$/i,
  /^actively (hiring|reviewing applicants)$/i,
];

const isNav = (t) => NAV_LINES.some((re) => re.test(t));
const isSoftNoise = (t) => SOFT_NOISE.some((re) => re.test(t));

const MIN_KEEP_CHARS = 200;

/** How far above "About the job" the job-header block may reach. */
const HEADER_LOOKBACK_LINES = 12;
const HEADER_KEEP = 6;

export function cleanPostingText(raw) {
  const original = String(raw ?? '');
  let lines = original.replace(/\r\n/g, '\n').split('\n');

  const headIdx = lines.findIndex((l) => HEAD_MARKERS.some((re) => re.test(l.trim())));
  if (headIdx > 0) {
    // Cut the page chrome above the body, but KEEP the job-header block that
    // sits right over the marker — title, company · location · salary live
    // there. Soft noise inside it is filtered below; the first NAV line (or
    // the window edge) bounds the block.
    let start = headIdx;
    let kept = 0;
    for (let i = headIdx - 1; i >= 0 && headIdx - i <= HEADER_LOOKBACK_LINES && kept < HEADER_KEEP; i--) {
      const t = lines[i].trim();
      if (isNav(t)) break;
      start = i;
      if (t !== '' && !isSoftNoise(t)) kept++;
    }
    lines = lines.slice(start);
  }

  const tailIdx = lines.findIndex((l) => TAIL_MARKERS.some((re) => re.test(l.trim())));
  if (tailIdx > 0) lines = lines.slice(0, tailIdx);

  const kept = [];
  for (const line of lines) {
    const t = line.trim();
    if (isNav(t) || isSoftNoise(t)) continue;
    if (t !== '' && kept.length > 0 && kept[kept.length - 1].trim() === t) continue; // consecutive duplicate
    kept.push(line);
  }

  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // Safety valve: a cleaner that ate the posting returns the original paste.
  // No ratio check on purpose — a heavy-chrome page IS mostly removable.
  return text.length < MIN_KEEP_CHARS ? original : text;
}
