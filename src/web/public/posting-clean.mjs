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

/** Lines that are chrome wherever they appear. */
const NOISE_LINES = [
  /^skip to main content$/i,
  /^sign in$/i,
  /^join now$/i,
  /^(easy )?apply( now)?$/i,
  /^save$/i,
  /^saved?$/i,
  /^share$/i,
  /^report this job$/i,
  /^show (more|less)$/i,
  /^see (more|less)$/i,
  /^(home|my network|jobs|messaging|notifications|me|for business)$/i,
  /^\d[\d,.]* (applicants?|followers|employees|connections)$/i,
  /^promoted$/i,
  /^actively (hiring|reviewing applicants)$/i,
];

const MIN_KEEP_CHARS = 200;

export function cleanPostingText(raw) {
  const original = String(raw ?? '');
  let lines = original.replace(/\r\n/g, '\n').split('\n');

  const headIdx = lines.findIndex((l) => HEAD_MARKERS.some((re) => re.test(l.trim())));
  if (headIdx > 0) lines = lines.slice(headIdx);

  const tailIdx = lines.findIndex((l) => TAIL_MARKERS.some((re) => re.test(l.trim())));
  if (tailIdx > 0) lines = lines.slice(0, tailIdx);

  const kept = [];
  for (const line of lines) {
    const t = line.trim();
    if (NOISE_LINES.some((re) => re.test(t))) continue;
    if (t !== '' && kept.length > 0 && kept[kept.length - 1].trim() === t) continue; // consecutive duplicate
    kept.push(line);
  }

  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // Safety valve: a cleaner that ate the posting returns the original paste.
  // No ratio check on purpose — a heavy-chrome page IS mostly removable.
  return text.length < MIN_KEEP_CHARS ? original : text;
}
