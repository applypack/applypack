/*
 * Demo wiring for the live score — used by /demo/ and, embedded, by the
 * landing page. Connects the vendored pure modules (score.mjs, target.mjs,
 * byte-identical to src/web/public/ and guarded by src/web/site-vendor.test.ts)
 * to the page. Mirrors the dashboard's target-page.mjs render path:
 * scoreKeywords → entriesFromLive → computeScore.
 */
import { scoreKeywords, highlightHtml, jobSpans, resumeSpans, orderKeywords, keywordRank, wantsLabel } from './target.mjs';
import { computeScore, entriesFromLive } from './score.mjs';

const editor = document.getElementById('editor');
const backdrop = document.getElementById('backdrop');
const jd = document.getElementById('jd');
const scoreValue = document.getElementById('score-value');
const scoreBar = document.getElementById('score-bar');
const scoreDetail = document.getElementById('score-detail');
const scoreDelta = document.getElementById('score-delta');
const scoreParts = document.getElementById('score-parts');
const chips = document.getElementById('chips');
const resetButton = document.getElementById('reset');
// A phone has no hover, so a chip's title never shows there: a tap says it in
// this line instead, and the idle line tells a touch screen to tap (style.css).
const chipDetail = document.createElement('p');
chipDetail.className = 'chip-detail';
chipDetail.setAttribute('aria-live', 'polite');
chips.after(chipDetail);
const TAP_HINT = 'Tap a word to see why the posting wants it.';

// AA-safe on white at 13px (the delta line) as well as at 40px.
const TONE = [
  [85, '#047857'],
  [70, '#1d4ed8'],
  [50, '#b45309'],
  [-1, '#d92d20'],
];
const toneColor = (score) => TONE.find(([min]) => score >= min)[1];
const MUTED = '#667085';

// The alignment part of the score is the AI's reading of the original resume.
// Once less than this share of its words is left, that reading describes a
// resume that is gone, and the page shows no number rather than a guess.
const KEPT_FLOOR = 0.6;
const STALE_NOTE = 'Too little is left of the resume the AI read to score this text. In the app, “Analyse my resume again” reads the new text in one AI call.';
const wordsOf = (text) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu));
function shareKept(original, text) {
  const now = wordsOf(text);
  let kept = 0;
  for (const word of original) if (now.has(word)) kept++;
  return kept / original.size;
}

/** What a chip's title says: how hard the posting wants the word, how often, where it would go. */
const chipWhy = (r) =>
  [wantsLabel(r), r.count > 1 ? '×' + r.count + ' in the posting' : null, r.where ? 'add in: ' + r.where : null, r.note]
    .filter(Boolean)
    .join(' · ');

function wire(data) {
  let picked = null;
  const original = wordsOf(data.resumeText);
  function render() {
    const text = editor.value;
    const scored = scoreKeywords(data.keywords, text);
    const stale = shareKept(original, text) < KEPT_FLOOR;

    let display = scored.score;
    let capNote = '';
    let maxNote = '';
    let parts = '';
    if (data.scoring) {
      const est = computeScore(
        entriesFromLive(scored.rows),
        data.scoring.alignment,
        data.scoring.redFlagCount,
        data.scoring.penalty ?? null,
      );
      display = est.score;
      if (est.cap !== null) capNote = ' · capped ' + est.cap + ' — primary ' + est.primaryPresent + '/' + est.primaryTotal;
      if (est.ceiling !== undefined) maxNote = ' · max ' + est.ceiling;
      // Alignment points are whole, so the rounded halves add up to the score unless a cap or a penalty applies.
      parts =
        'Keywords ' + Math.round(est.keywordPts) + '/' + est.keywordMax + ', read as you type · ' +
        'Title, summary, latest role ' + est.alignmentPts + '/' + est.alignmentMax + ', graded once by the AI';
    }

    const tone = stale ? MUTED : toneColor(display);
    scoreValue.textContent = stale ? '—' : String(display);
    scoreValue.style.color = tone;
    scoreBar.style.width = (stale ? 0 : display) + '%';
    scoreBar.style.background = tone;

    const counted = scored.rows.filter((r) => !r.excluded);
    const missing = counted.filter((r) => !r.found);
    const listed = counted.filter((r) => r.found && r.evidence === 'listed').length;
    scoreDetail.textContent =
      counted.filter((r) => r.found).length + ' of ' + counted.length + ' keywords present' +
      (listed > 0 ? ' · ' + listed + ' only in a list of terms' : '') +
      (stale ? '' : capNote + maxNote);
    scoreParts.textContent = stale ? STALE_NOTE : parts;

    // Delta appears once the text is edited — before that the stored AI number
    // is shown quietly (the live formula is an estimate, not a re-run).
    const dirty = text !== data.resumeText;
    if (stale) {
      scoreDelta.textContent = 'not scored';
      scoreDelta.style.color = MUTED;
    } else if (dirty) {
      const d = display - data.aiScore;
      scoreDelta.textContent = d === 0 ? 'same as the AI run' : (d > 0 ? '+' : '') + d + ' vs the AI run';
      scoreDelta.style.color = d > 0 ? TONE[0][1] : d < 0 ? TONE[3][1] : MUTED;
    } else {
      scoreDelta.textContent = 'AI run: ' + data.aiScore;
      scoreDelta.style.color = MUTED;
    }

    backdrop.innerHTML = highlightHtml(text, resumeSpans(data.keywords, data.actions, data.removals, text)) + '\n';
    jd.innerHTML = highlightHtml(data.jobText, jobSpans(data.keywords, data.jobText, scored));

    chips.innerHTML = '';
    // The dashboard's order and colour (target-page.mjs): the hardest
    // requirement first, then the words the posting keeps repeating; red for a
    // must the resume lacks, amber for a preferred, slate for a nice-to-have.
    for (const r of orderKeywords(missing, data.jobText)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip-missing kw-w' + keywordRank(r);
      chip.textContent = r.count > 1 ? r.term + ' ×' + r.count : r.term;
      chip.title = chipWhy(r);
      chip.setAttribute('aria-pressed', String(r.term === picked));
      chip.addEventListener('click', () => {
        picked = picked === r.term ? null : r.term;
        render();
      });
      chips.appendChild(chip);
    }
    if (missing.length === 0) chips.innerHTML = '<span class="chips-empty">Every countable keyword is present.</span>';
    // A word typed into the resume leaves the row, and its line goes with it.
    const shown = missing.find((r) => r.term === picked);
    if (!shown) picked = null;
    chipDetail.textContent = shown ? shown.term + ': ' + chipWhy(shown) : missing.length > 0 ? TAP_HINT : '';
    chipDetail.classList.toggle('idle', !shown);

    resetButton.hidden = !dirty;
  }

  editor.value = data.resumeText;
  editor.addEventListener('input', render);
  editor.addEventListener('scroll', () => {
    backdrop.scrollTop = editor.scrollTop;
    backdrop.scrollLeft = editor.scrollLeft;
  });
  resetButton.addEventListener('click', () => {
    editor.value = data.resumeText;
    render();
    editor.focus();
  });
  render();
}

// The fixture sits next to this module, whichever page embeds it.
try {
  const response = await fetch(new URL('fixture.json', import.meta.url));
  if (!response.ok) throw new Error('HTTP ' + response.status);
  wire(await response.json());
} catch {
  scoreDetail.textContent = 'The demo data did not load. Reload the page to try again.';
}
