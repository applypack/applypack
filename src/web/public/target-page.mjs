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
  gapLabel,
} from './target.mjs';
import { computeScore, entriesFromLive } from './score.mjs';
import { formatEditSheet } from './change-sheet.mjs';
import { wireCopy, copyFrom, announce } from './copy.mjs';
import { applyReplacement, insertAfterLine, removeSpan, insertIntoSkills, inverseEdit, undoEdit } from './text-edits.mjs';

// Full literal class names — the Tailwind CDN JIT only generates what it can
// see verbatim in the document, composed strings would come out unstyled.
//
// A missing chip wears the colour its mark wears in the posting (target.mjs):
// red for a must, amber for a preferred, slate for a nice-to-have. Keyed by
// keywordRank — 4 a primary-stack must … 0 context.
const CHIP_BASE = 'chip inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset';
// The add control beside a missing chip: an action, so it reads as the accent, not the warning.
const CHIP_ADD = 'border border-accent/40 bg-accent/5 text-accent-strong hover:bg-accent/10';
const CHIP_LEVEL = {
  4: 'bg-danger/20 text-danger ring-danger/60 font-semibold',
  3: 'bg-danger/10 text-danger ring-danger/40 font-semibold',
  2: 'bg-warn/10 text-warn ring-warn/40',
  1: 'bg-surface-overlay text-ink-muted ring-line',
  0: 'bg-surface-overlay text-ink-muted ring-line',
};

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
  const chips = document.getElementById('missing-chips');
  const saveButtons = document.querySelectorAll('[data-save-button]');
  const aiFresh = document.getElementById('ai-fresh');
  const aiStale = document.getElementById('ai-stale');
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
    // The live number, for the sticky bar alone: the full score formula when
    // the match carries a breakdown (alignment fixed from the last AI run,
    // keywords + cap live), else the plain coverage percentage for
    // pre-ADR-0012 matches. The ring above keeps the AI's own verdict — a
    // keyword edit re-scores it server-side, a text edit marks it stale.
    let display = scored.score;
    if (data.scoring) {
      display = computeScore(entriesFromLive(scored.rows), data.scoring.alignment, data.scoring.redFlagCount, data.scoring.penalty ?? null).score;
    }
    barScore.textContent = String(display);
    if (data.scoring) {
      const d = display - data.aiScore;
      barDelta.textContent = d === 0 ? 'same as the last analysis' : (d > 0 ? '+' : '') + d + ' vs the last analysis';
      barDelta.className = 'ml-1 text-xs font-medium ' + (d > 0 ? 'text-ok' : d < 0 ? 'text-danger' : 'text-ink-faint');
    }

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
      b.className = CHIP_BASE + ' ' + (CHIP_LEVEL[keywordRank(r)] ?? CHIP_LEVEL[2]);
      b.textContent = r.count > 1 ? r.term + ' ×' + r.count : r.term;
      b.title = [
        wantsLabel(r),
        gapLabel(r, false),
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
    // One line under the ring, two things it can say: how old the number is,
    // or that the text moved on since it was made.
    aiFresh.hidden = dirty;
    aiStale.hidden = !dirty;
    dirtyBar.hidden = !dirty;
    for (const b of saveButtons) b.disabled = !dirty;
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
    // A refusal ("couldn't find this text") describes the text as it was; once
    // the user types, it may no longer be true, so it stops being sticky.
    for (const st of document.querySelectorAll('[data-card-status][data-sticky]')) delete st.dataset.sticky;
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
    for (const box of document.querySelectorAll('[data-edit-box]:not([hidden])')) {
      box.hidden = true;
      box.closest('[data-card]')?.querySelector('[data-edit-apply]')?.focus();
    }
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
      // Hidden rather than disabled: a row of five dead buttons is louder than
      // the card it belongs to. Copy and Locate stay — both still make sense.
      const done = Boolean(applied) || skipped;
      for (const b of card.querySelectorAll('[data-apply], [data-remove], [data-skip], [data-edit-apply]')) {
        b.hidden = done;
      }
      const box = card.querySelector('[data-edit-box]');
      if (box && done) box.hidden = true;
      const status = card.querySelector('[data-card-status]');
      if (status && !status.dataset.sticky) {
        status.textContent = applied ? (applied.inserted === '' ? 'Removed' : 'Applied') : skipped ? 'Skipped' : '';
      }
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

  /** A change goes over its quote; an addition goes after its anchor line (ADR 0037). `at` carries one or the other. */
  function place(text, at, wording) {
    return at?.dataset.anchor
      ? insertAfterLine(text, at.dataset.anchor, wording)
      : applyReplacement(text, at?.dataset.quote, wording);
  }

  /**
   * Run one text operation for a card: write the result, remember the inverse
   * so Undo is exact, and outline what changed. A refusal never touches the text.
   */
  function runEdit(card, operation, verb) {
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
    say(card, verb, false);
    return true;
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-apply], [data-remove], [data-skip], [data-undo], [data-edit-apply], [data-edit-save], [data-edit-cancel]');
    const card = button?.closest('[data-card]');
    if (!button || !card) return;
    const box = card.querySelector('[data-edit-box]');
    if (button.hasAttribute('data-apply')) {
      runEdit(card, (t) => place(t, box, button.dataset.apply), 'Applied');
    } else if (button.hasAttribute('data-remove')) {
      runEdit(card, (t) => removeSpan(t, button.dataset.remove), 'Removed');
    } else if (button.hasAttribute('data-edit-apply')) {
      if (box) box.hidden = false;
      box?.querySelector('[data-edit-text]')?.focus();
    } else if (button.hasAttribute('data-edit-cancel')) {
      if (box) box.hidden = true;
    } else if (button.hasAttribute('data-edit-save')) {
      // The box carries the target itself: a card whose wording the gate refused has no Apply button.
      const wording = box?.querySelector('[data-edit-text]')?.value ?? '';
      if (runEdit(card, (t) => place(t, box, wording), 'Applied') && box) box.hidden = true;
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
    const card = button.closest('[data-card]');
    button.addEventListener('click', () => {
      const loc = locateQuote(editor.value, button.dataset.locate);
      if (!loc) {
        located = null;
        render();
        if (card) say(card, REASON['not-found'], true);
        return;
      }
      located = loc;
      render();
      const line = editor.value.slice(0, loc.start).split('\n').length;
      // The outline is not the only signal: the line number is readable and announced.
      if (card) say(card, 'Line ' + line, true);
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

  editor.value = load() ?? data.resumeText;
  loadEdits();
  render();
}
