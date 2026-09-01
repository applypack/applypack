/*
 * Demo wiring for /demo/ — connects the vendored pure modules (score.mjs,
 * target.mjs — byte-identical to src/web/public/, guarded by
 * src/web/site-vendor.test.ts) to the page. Mirrors the dashboard's
 * target-page.mjs render path: scoreKeywords → entriesFromLive → computeScore.
 */
import { scoreKeywords, highlightHtml, jobSpans, resumeSpans } from './target.mjs';
import { computeScore, entriesFromLive } from './score.mjs';

const data = await fetch('fixture.json').then((r) => r.json());

const editor = document.getElementById('editor');
const backdrop = document.getElementById('backdrop');
const jd = document.getElementById('jd');
const scoreValue = document.getElementById('score-value');
const scoreBar = document.getElementById('score-bar');
const scoreDetail = document.getElementById('score-detail');
const scoreDelta = document.getElementById('score-delta');
const chips = document.getElementById('chips');
const resetButton = document.getElementById('reset');

const TONE = [
  [85, '#059669'],
  [70, '#2563eb'],
  [50, '#d97706'],
  [-1, '#dc2626'],
];
const toneColor = (score) => TONE.find(([min]) => score >= min)[1];

function render() {
  const text = editor.value;
  const scored = scoreKeywords(data.keywords, text);

  let display = scored.score;
  let capNote = '';
  let maxNote = '';
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
  }

  scoreValue.textContent = String(display);
  scoreValue.style.color = toneColor(display);
  scoreBar.style.width = display + '%';
  scoreBar.style.background = toneColor(display);

  const counted = scored.rows.filter((r) => !r.excluded);
  const missing = counted.filter((r) => !r.found);
  scoreDetail.textContent =
    counted.filter((r) => r.found).length + ' of ' + counted.length + ' keywords present' + capNote + maxNote;

  // Delta appears once the text is edited — before that the stored AI number
  // is shown quietly (the live formula is an estimate, not a re-run).
  const dirty = text !== data.resumeText;
  if (dirty) {
    const d = display - data.aiScore;
    scoreDelta.textContent = d === 0 ? 'same as the AI run' : (d > 0 ? '+' : '') + d + ' vs the AI run';
    scoreDelta.style.color = d > 0 ? '#059669' : d < 0 ? '#dc2626' : '#64748b';
  } else {
    scoreDelta.textContent = 'AI run: ' + data.aiScore;
    scoreDelta.style.color = '#64748b';
  }

  backdrop.innerHTML = highlightHtml(text, resumeSpans(data.keywords, data.actions, data.removals, text)) + '\n';
  jd.innerHTML = highlightHtml(data.jobText, jobSpans(data.keywords, data.jobText, scored));

  chips.innerHTML = '';
  for (const r of missing.sort((a, b) => a.priority - b.priority)) {
    const chip = document.createElement('span');
    chip.className = 'chip-missing';
    chip.textContent = r.term + ' · P' + r.priority;
    if (r.where || r.note) chip.title = (r.where ? 'Add in: ' + r.where + '. ' : '') + (r.note || '');
    chips.appendChild(chip);
  }
  if (missing.length === 0) chips.innerHTML = '<span class="chips-empty">Every countable keyword is present.</span>';

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
