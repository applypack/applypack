/*
 * DOM wiring for the Resume match page (/jobs/:id/target). Served as a static
 * ES module; the page boots it with the JSON blob it embeds. All pure logic
 * lives in ./target.mjs and ./score.mjs — this file only connects it to the
 * elements, so importing it under node:test touches no DOM.
 */

import { scoreKeywords, highlightHtml, jobSpans, resumeSpans, locateQuote } from './target.mjs';
import { computeScore, entriesFromLive } from './score.mjs';

// Full literal class names — the Tailwind CDN JIT only generates what it can
// see verbatim in the document, composed strings would come out unstyled.
const TONE_TEXT = { ok: 'text-ok', info: 'text-info', warn: 'text-warn', danger: 'text-danger' };
const TONE_BG = { ok: 'bg-ok', info: 'bg-info', warn: 'bg-warn', danger: 'bg-danger' };

function tone(score) {
  return score >= 85 ? 'ok' : score >= 70 ? 'info' : score >= 50 ? 'warn' : 'danger';
}

export function init(data) {
  const editor = document.getElementById('editor');
  const backdrop = document.getElementById('backdrop');
  const jd = document.getElementById('jd');
  const scoreBar = document.getElementById('score-bar');
  const scoreValue = document.getElementById('score-value');
  const scoreDetail = document.getElementById('score-detail');
  const chips = document.getElementById('missing-chips');
  const saveButton = document.getElementById('save-button');
  const aiStale = document.getElementById('ai-stale');
  const liveEst = document.getElementById('live-est');
  const liveDelta = document.getElementById('live-delta');
  const dirtyBar = document.getElementById('dirty-bar');
  const panes = document.getElementById('panes');
  const storageKey = 'target-draft:' + data.matchId;

  function load() {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  }
  function store(text) {
    try {
      if (text === data.resumeText) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, text);
    } catch {}
  }

  function render() {
    const text = editor.value;
    const scored = scoreKeywords(data.keywords, text);
    // Live number: full score formula when the match carries a breakdown
    // (alignment fixed from the last AI run, keywords + cap live), else the
    // plain coverage percentage for pre-ADR-0012 matches.
    let display = scored.score;
    let capNote = '';
    let maxNote = '';
    if (data.scoring) {
      const est = computeScore(entriesFromLive(scored.rows), data.scoring.alignment, data.scoring.redFlagCount);
      display = est.score;
      if (est.cap !== null) capNote = ' · capped ' + est.cap + ' — primary ' + est.primaryPresent + '/' + est.primaryTotal;
      if (est.ceiling !== undefined) maxNote = ' · max ' + est.ceiling;
    }
    scoreValue.textContent = String(display);
    scoreValue.className = 'text-lg font-semibold tabular-nums ' + TONE_TEXT[tone(display)];
    scoreBar.style.width = display + '%';
    scoreBar.className = 'block h-full rounded-full transition-[width] duration-300 ' + TONE_BG[tone(display)];
    if (data.scoring) {
      const d = display - data.aiScore;
      liveDelta.textContent = d === 0 ? 'same as AI' : (d > 0 ? '+' : '') + d + ' vs AI';
      liveDelta.className = 'text-xs font-medium ' + (d > 0 ? 'text-ok' : d < 0 ? 'text-danger' : 'text-ink-faint');
    }
    const counted = scored.rows.filter((r) => !r.excluded);
    const missing = counted.filter((r) => !r.found);
    const missingNames = missing
      .slice(0, 3)
      .map((r) => (r.term.length > 26 ? r.term.slice(0, 24) + '…' : r.term))
      .join(', ');
    scoreDetail.textContent = counted.filter((r) => r.found).length + ' of ' + counted.length + ' keywords present'
      + (missing.length ? ' · missing: ' + missingNames + (missing.length > 3 ? ' +' + (missing.length - 3) : '') : '')
      + capNote + maxNote;

    backdrop.innerHTML = highlightHtml(text, resumeSpans(data.keywords, data.actions, data.removals, text)) + '\n';
    jd.innerHTML = highlightHtml(data.jobText, jobSpans(data.keywords, data.jobText, scored));

    chips.innerHTML = '';
    for (const r of scored.rows.filter((r) => !r.found && !r.excluded).sort((a, b) => a.priority - b.priority)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset bg-warn/10 text-warn ring-warn/25';
      b.textContent = r.term + ' · P' + r.priority;
      b.title = (r.where ? 'Add in: ' + r.where + '. ' : '') + (r.note || '');
      b.addEventListener('click', () => jumpToSection(r.where));
      chips.appendChild(b);
    }
    if (chips.children.length === 0) chips.innerHTML = '<span class="text-xs text-ink-faint">Every countable keyword is present.</span>';

    const dirty = text !== data.resumeText;
    aiStale.hidden = !dirty;
    liveEst.hidden = !dirty;
    dirtyBar.hidden = !dirty;
    if (saveButton) saveButton.disabled = !dirty;
    const saveText = document.getElementById('save-text');
    if (saveText) saveText.value = text;
    document.getElementById('reanalyze-text').value = dirty ? text : '';
    store(text);
  }

  function jumpToSection(where) {
    if (!where) return;
    const hint = where.toLowerCase();
    const sections = ['summary', 'skills', 'experience', 'education', 'title'];
    const wanted = sections.find((s) => hint.includes(s));
    const lines = editor.value.split('\n');
    let offset = 0;
    for (const line of lines) {
      if (wanted && line.toLowerCase().includes(wanted) && line.length < 60) { select(offset, offset + line.length); return; }
      offset += line.length + 1;
    }
  }

  function select(start, end) {
    editor.focus();
    editor.setSelectionRange(start, end);
    // Scroll the caret into view: estimate the line's offset from the top.
    const before = editor.value.slice(0, start);
    const lineIndex = before.split('\n').length - 1;
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 22;
    editor.scrollTop = Math.max(0, lineIndex * lineHeight - editor.clientHeight / 3);
    backdrop.scrollTop = editor.scrollTop;
  }

  function resetEdits() {
    editor.value = data.resumeText;
    render();
  }

  let timer = null;
  editor.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 120); });
  editor.addEventListener('scroll', () => { backdrop.scrollTop = editor.scrollTop; backdrop.scrollLeft = editor.scrollLeft; });
  document.getElementById('show-matched').addEventListener('change', (e) => {
    panes.classList.toggle('show-matched', e.target.checked);
  });
  document.getElementById('reset-edits').addEventListener('click', resetEdits);
  document.getElementById('bar-discard').addEventListener('click', resetEdits);

  for (const tab of document.querySelectorAll('[role=tab]')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('[role=tab]')) t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      panes.dataset.view = tab.dataset.tab;
      if (tab.dataset.tab !== 'changes') render();
    });
  }

  for (const btn of document.querySelectorAll('[data-goto-tab]')) {
    btn.addEventListener('click', () => {
      const target = document.querySelector('[role=tab][data-tab="' + btn.dataset.gotoTab + '"]');
      if (target) target.click();
    });
  }

  for (const item of document.querySelectorAll('[data-quote]')) {
    item.addEventListener('click', () => {
      const loc = locateQuote(editor.value, item.dataset.quote);
      if (!loc) { item.classList.add('flash-target'); setTimeout(() => item.classList.remove('flash-target'), 1200); return; }
      document.querySelector('[role=tab][data-tab=both]').click();
      select(loc.start, loc.end);
    });
  }

  editor.value = load() ?? data.resumeText;
  render();
}
