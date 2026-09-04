/*
 * DOM wiring for the Resume match page (/jobs/:id/target). Served as a static
 * ES module; the page boots it with the JSON blob it embeds. All pure logic
 * lives in ./target.mjs and ./score.mjs — this file only connects it to the
 * elements, so importing it under node:test touches no DOM.
 */

import {
  scoreKeywords,
  highlightHtml,
  jobSpans,
  resumeSpans,
  locateQuote,
  keywordRank,
  orderKeywords,
  wantsLabel,
} from './target.mjs';
import { computeScore, entriesFromLive } from './score.mjs';
import { formatEditSheet } from './change-sheet.mjs';
import { wireCopy, copyFrom, announce } from './copy.mjs';
import { applyReplacement, removeSpan, insertIntoSkills, inverseEdit, undoEdit } from './text-edits.mjs';

// Full literal class names — the Tailwind CDN JIT only generates what it can
// see verbatim in the document, composed strings would come out unstyled.
const TONE_TEXT = { ok: 'text-ok', info: 'text-info', warn: 'text-warn', danger: 'text-danger' };
const TONE_BG = { ok: 'bg-ok', info: 'bg-info', warn: 'bg-warn', danger: 'bg-danger' };

// A missing chip carries the same weight the pane marks do (target-plan.md §5):
// a primary-stack must shouts, a nice-to-have whispers.
const CHIP_BASE = 'chip inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset';
// The add control beside a missing chip: an action, so it reads as the accent, not the warning.
const CHIP_ADD = 'border border-accent/40 bg-accent/5 text-accent-strong hover:bg-accent/10';
const CHIP_WEIGHT = {
  4: 'bg-warn/25 text-warn ring-warn/60 font-semibold',
  3: 'bg-warn/15 text-warn ring-warn/40',
  2: 'bg-warn/10 text-warn ring-warn/25',
  1: 'bg-warn/5 text-ink-muted ring-line',
  0: 'bg-warn/5 text-ink-muted ring-line',
};

function tone(score) {
  return score >= 85 ? 'ok' : score >= 70 ? 'info' : score >= 50 ? 'warn' : 'danger';
}

/** Why an edit did not happen — every error the text operations can return. */
const REASON = {
  'not-found': "Couldn't find this text in the editor, it may already be edited",
  'no-replacement': 'This suggestion has no wording to apply — copy it and write your own',
  protected: 'That line carries your email or phone — edit it by hand',
  'no-term': 'Nothing to add',
  'already-present': 'Already in your resume',
  'no-skills-list': 'Your skills section is a column of labels, not a list — add it by hand',
  'moved-on': 'The text moved on since you applied this — undo it by hand',
};

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
  const barScore = document.getElementById('bar-score');
  const barDelta = document.getElementById('bar-delta');
  const panes = document.getElementById('panes');
  const storageKey = 'target-draft:' + data.matchId;
  const editsKey = 'target-edits:' + data.matchId;
  // The span Locate is pointing at, or null. Cleared on every edit, because an
  // offset into text the user has since changed points at the wrong words.
  let located = null;
  // What each card did, so it can be undone and so the marks survive a reload.
  // applied holds the inverse edit (one sentence), never a copy of the resume.
  let edits = { applied: {}, skipped: [] };

  function loadEdits() {
    try {
      const raw = JSON.parse(localStorage.getItem(editsKey) ?? 'null');
      if (raw && typeof raw === 'object') edits = { applied: raw.applied ?? {}, skipped: raw.skipped ?? [] };
    } catch {}
  }
  function storeEdits() {
    try {
      if (Object.keys(edits.applied).length === 0 && edits.skipped.length === 0) localStorage.removeItem(editsKey);
      else localStorage.setItem(editsKey, JSON.stringify(edits));
    } catch {}
  }

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
      const est = computeScore(entriesFromLive(scored.rows), data.scoring.alignment, data.scoring.redFlagCount, data.scoring.penalty ?? null);
      display = est.score;
      if (est.cap !== null) capNote = ' · capped ' + est.cap + ' — primary ' + est.primaryPresent + '/' + est.primaryTotal;
      if (est.ceiling !== undefined) maxNote = ' · max ' + est.ceiling;
    }
    scoreValue.textContent = String(display);
    scoreValue.className = 'text-lg font-semibold tabular-nums ' + TONE_TEXT[tone(display)];
    scoreBar.style.width = display + '%';
    scoreBar.className = 'block h-full rounded-full transition-[width] duration-300 ' + TONE_BG[tone(display)];
    barScore.textContent = String(display);
    if (data.scoring) {
      const d = display - data.aiScore;
      const deltaText = d === 0 ? 'same as AI' : (d > 0 ? '+' : '') + d + ' vs AI';
      const deltaTone = d > 0 ? 'text-ok' : d < 0 ? 'text-danger' : 'text-ink-faint';
      liveDelta.textContent = deltaText;
      liveDelta.className = 'text-xs font-medium ' + deltaTone;
      barDelta.textContent = deltaText;
      barDelta.className = 'ml-1 text-xs font-medium ' + deltaTone;
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

    const spans = resumeSpans(data.keywords, data.actions, data.removals, text);
    if (located) {
      // The quote usually already carries an edit mark; add the outline to that
      // span rather than pushing a rival one, which highlightHtml would drop.
      const same = spans.find((s) => s.start === located.start && s.end === located.end);
      if (same) same.cls += ' located';
      else spans.push({ ...located, cls: 'located' });
    }
    backdrop.innerHTML = highlightHtml(text, spans) + '\n';
    jd.innerHTML = highlightHtml(data.jobText, jobSpans(data.keywords, data.jobText, scored));

    chips.innerHTML = '';
    // Hardest requirement first, then the words the posting keeps repeating.
    for (const r of orderKeywords(scored.rows.filter((r) => !r.found && !r.excluded), data.jobText)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = CHIP_BASE + ' ' + (CHIP_WEIGHT[keywordRank(r)] ?? CHIP_WEIGHT[2]);
      b.textContent = r.count > 1 ? r.term + ' ×' + r.count : r.term;
      b.title = [
        wantsLabel(r),
        r.count > 1 ? '×' + r.count + ' in the posting' : null,
        r.where ? 'add in: ' + r.where : null,
        r.note,
      ].filter(Boolean).join(' · ');
      b.addEventListener('click', () => jumpToSection(r.where));
      chips.appendChild(b);
      // "Add to Skills" only where it can honestly work: the model (or a fact the
      // user confirmed — applyFacts flips confirmed to `add` before this page
      // renders) says the term is addable, AND the resume has a line shaped like
      // a term list to put it on. cannot_claim never gets one.
      if (r.status !== 'add') continue;
      const probe = insertIntoSkills(editor.value, r.term, r.where);
      if (probe.error) continue;
      const add = document.createElement('button');
      add.type = 'button';
      add.className = CHIP_BASE + ' ' + CHIP_ADD;
      add.textContent = '+ add';
      add.title = 'Add "' + r.term + '" to your skills line';
      add.addEventListener('click', () => {
        const before = editor.value;
        const result = insertIntoSkills(before, r.term, r.where);
        if (result.error) { announce(REASON[result.error] ?? 'Could not add it'); return; }
        editor.value = result.text;
        located = result.span;
        render();
        scrollEditorTo(result.span.start);
        announce('Added ' + r.term + ' to your skills');
      });
      chips.appendChild(add);
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
    // Nothing to carry out until the text differs from what the AI judged.
    const copyEdits = document.getElementById('copy-edits');
    if (copyEdits) copyEdits.disabled = !dirty;
    paintCards();
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

  /** Scroll THE EDITOR so the offset sits in its upper third. The page never moves. */
  function scrollEditorTo(start) {
    const lineIndex = editor.value.slice(0, start).split('\n').length - 1;
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 22;
    editor.scrollTop = Math.max(0, lineIndex * lineHeight - editor.clientHeight / 3);
    backdrop.scrollTop = editor.scrollTop;
  }

  function select(start, end) {
    editor.focus();
    editor.setSelectionRange(start, end);
    scrollEditorTo(start);
  }

  function resetEdits() {
    editor.value = data.resumeText;
    // The outline was an offset into the text being discarded, and so were the
    // applied/skipped marks — they describe edits that no longer exist.
    located = null;
    edits = { applied: {}, skipped: [] };
    storeEdits();
    render();
  }

  let timer = null;
  editor.addEventListener('input', () => {
    located = null;
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  });
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
      render();
    });
  }

  for (const btn of document.querySelectorAll('[data-goto-tab]')) {
    btn.addEventListener('click', () => {
      const target = document.querySelector('[role=tab][data-tab="' + btn.dataset.gotoTab + '"]');
      if (target) target.click();
    });
  }

  // Light dismiss for the action menus: a click outside or Escape closes them.
  // Scoped to data-menu so content disclosures (older runs, matched keywords)
  // keep their sticky open state.
  document.addEventListener('click', (e) => {
    for (const d of document.querySelectorAll('details[data-menu][open]')) {
      if (!d.contains(e.target)) d.open = false;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const d of document.querySelectorAll('details[data-menu][open]')) {
      d.open = false;
      const s = d.querySelector('summary');
      if (s) s.focus();
    }
  });

  /** Dim a card that has been dealt with, and offer Undo only where it can work. */
  function paintCards() {
    for (const card of document.querySelectorAll('[data-card]')) {
      const key = card.dataset.card;
      const applied = edits.applied[key];
      const skipped = edits.skipped.includes(key);
      card.classList.toggle('card-done', Boolean(applied) || skipped);
      const undo = card.querySelector('[data-undo]');
      if (undo) undo.hidden = !applied && !skipped;
      for (const b of card.querySelectorAll('[data-apply], [data-remove], [data-skip], [data-edit-apply]')) {
        b.disabled = Boolean(applied) || skipped;
      }
      const status = card.querySelector('[data-card-status]');
      if (status && !status.dataset.sticky) status.textContent = applied ? 'Applied' : skipped ? 'Skipped' : '';
    }
  }

  /** Say what happened on this card, and to a screen reader once. */
  function say(card, message, sticky) {
    const status = card.querySelector('[data-card-status]');
    if (!status) return;
    status.textContent = message;
    if (sticky) status.dataset.sticky = '1';
    else delete status.dataset.sticky;
    announce(message);
  }

  /**
   * Run one text operation for a card: write the result, remember the inverse
   * so Undo is exact, and outline what changed. A refusal never touches the text.
   */
  function runEdit(card, operation) {
    const before = editor.value;
    const result = operation(before);
    if (result.error) {
      say(card, REASON[result.error] ?? 'That edit could not be made', true);
      return false;
    }
    editor.value = result.text;
    edits.applied[card.dataset.card] = inverseEdit(before, result.text);
    edits.skipped = edits.skipped.filter((k) => k !== card.dataset.card);
    storeEdits();
    located = result.span;
    render();
    scrollEditorTo(result.span.start);
    say(card, 'Applied', false);
    return true;
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-apply], [data-remove], [data-skip], [data-undo], [data-edit-apply], [data-edit-save], [data-edit-cancel]');
    const card = button?.closest('[data-card]');
    if (!button || !card) return;
    const box = card.querySelector('[data-edit-box]');
    if (button.hasAttribute('data-apply')) {
      runEdit(card, (t) => applyReplacement(t, button.dataset.quote, button.dataset.apply));
    } else if (button.hasAttribute('data-remove')) {
      runEdit(card, (t) => removeSpan(t, button.dataset.remove));
    } else if (button.hasAttribute('data-edit-apply')) {
      if (box) box.hidden = false;
      box?.querySelector('[data-edit-text]')?.focus();
    } else if (button.hasAttribute('data-edit-cancel')) {
      if (box) box.hidden = true;
    } else if (button.hasAttribute('data-edit-save')) {
      const apply = card.querySelector('[data-apply]');
      const wording = box?.querySelector('[data-edit-text]')?.value ?? '';
      if (runEdit(card, (t) => applyReplacement(t, apply?.dataset.quote, wording)) && box) box.hidden = true;
    } else if (button.hasAttribute('data-skip')) {
      if (!edits.skipped.includes(card.dataset.card)) edits.skipped.push(card.dataset.card);
      storeEdits();
      paintCards();
      say(card, 'Skipped', false);
    } else if (button.hasAttribute('data-undo')) {
      const key = card.dataset.card;
      const entry = edits.applied[key];
      if (entry) {
        const back = undoEdit(editor.value, entry);
        if (back.error) { say(card, REASON[back.error], true); return; }
        editor.value = back.text;
        located = back.span;
      }
      delete edits.applied[key];
      edits.skipped = edits.skipped.filter((k) => k !== key);
      storeEdits();
      render();
      say(card, 'Undone', false);
    }
  });

  // Copy works the same on every page; Locate only exists where this editor does.
  wireCopy(document);

  // Locate: outline the quote in the editor and scroll THE EDITOR to it. The
  // page does not move — losing the card you just read was the whole complaint.
  for (const button of document.querySelectorAll('[data-locate]')) {
    const status = button.parentElement?.querySelector('[data-locate-status]');
    button.addEventListener('click', () => {
      const loc = locateQuote(editor.value, button.dataset.locate);
      if (!loc) {
        located = null;
        render();
        if (status) status.textContent = "Couldn't find this text in the editor, it may already be edited";
        return;
      }
      located = loc;
      render();
      const line = editor.value.slice(0, loc.start).split('\n').length;
      // The outline is not the only signal: the line number is readable and announced.
      if (status) status.textContent = 'Line ' + line;
      scrollEditorTo(loc.start);
      // Focus moves the caret, which on a phone opens the keyboard over the text.
      if (window.matchMedia('(min-width: 1024px)').matches) {
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(loc.start, loc.end);
      }
    });
  }

  // "Copy my changes": the diff of the analysed text against what is on screen.
  const copyEdits = document.getElementById('copy-edits');
  if (copyEdits) {
    copyEdits.addEventListener('click', () => {
      const sheet = formatEditSheet(data.sheet, data.resumeText, editor.value);
      if (sheet) copyFrom(copyEdits, sheet);
    });
  }

  const expand = document.getElementById('expand-editor');
  if (expand) {
    expand.addEventListener('click', () => {
      const tall = panes.classList.toggle('editor-tall');
      expand.textContent = tall ? 'shrink editor' : 'expand editor';
      expand.setAttribute('aria-expanded', String(tall));
    });
  }

  // The keyword table is the longest block on the page; on a phone it starts
  // folded, on a desktop it is simply open. Media queries cannot set `open`.
  const fold = document.querySelector('details.kw-fold');
  if (fold) fold.open = window.matchMedia('(min-width: 1024px)').matches;

  // An instant check hands over its parsed upload: it becomes this tab's draft
  // in place of whatever the tab held, and lives in localStorage from here on.
  editor.value = typeof data.draftText === 'string' ? data.draftText : (load() ?? data.resumeText);
  // An instant check replaces the tab's text, so its marks no longer describe it.
  if (typeof data.draftText === 'string') storeEdits();
  else loadEdits();
  render();
}
