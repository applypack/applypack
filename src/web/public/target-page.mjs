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
import { applyReplacement, insertAfterLine, removeSpan, insertIntoSkills, inverseEdit, undoEdit, withContext } from './text-edits.mjs';
import { applyAll, applyAllSummary, addKeywords } from './apply-all.mjs';
import { mountDocPane, fileNameFrom } from './doc-pane.mjs';
import { t } from './i18n.mjs';

// Full literal class names — the Tailwind CDN JIT only generates what it can
// see verbatim in the document, composed strings would come out unstyled.

// The ring's stroke, by score. Same four steps and the same cut-offs as the
// server's format.ts:fitTone, so the colour does not change under the user
// when an analysis lands on a score the live count already showed.
const RING_TONE = { ok: 'text-ok', info: 'text-info', warn: 'text-warn', neutral: 'text-ink-faint' };

export function ringTone(score) {
  return score >= 85 ? 'ok' : score >= 70 ? 'info' : score >= 50 ? 'warn' : 'neutral';
}

// A missing chip wears the colour its mark wears in the posting (target.mjs):
// red for a must, amber for a preferred, slate for a nice-to-have. Keyed by
// keywordRank — 4 a primary-stack must … 0 context.
const CHIP_BASE = 'chip inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-meta font-medium ring-1 ring-inset';
// The add control beside a missing chip: an action, so it reads as the accent, not the warning.
const CHIP_ADD = 'border border-accent/40 bg-accent/5 text-accent-strong hover:bg-accent/10';
const CHIP_LEVEL = {
  4: 'bg-danger/20 text-danger ring-danger/60 font-semibold',
  3: 'bg-danger/10 text-danger ring-danger/40 font-semibold',
  2: 'bg-warn/10 text-warn ring-warn/40',
  1: 'bg-surface-overlay text-ink-muted ring-line',
  0: 'bg-surface-overlay text-ink-muted ring-line',
};

/**
 * What stands between this resume and a higher score, for the chips above the
 * editor: every weighted term the text does not spell. Two kinds, coloured
 * alike by level and told apart by the dash — a term the resume evidences but
 * does not say (type it and the score moves), and one nothing in the resume
 * backs yet, which typing moves too (ADR 0045) and confirming is the other
 * way into. A weight-0 context term is no gap at all, and neither is a word
 * the text already carries, whatever the last analysis called it — the row
 * once kept those, and offered a "yes" for a word the user had just typed.
 */
export function keywordGaps(rows) {
  return rows.filter((r) => r.weight > 0 && !r.found);
}

/** Letters and digits only, in one case: "Sr. Software Engineer II" is "sr software engineer ii". */
const wordsOf = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The gaps a skills line can take: every one but the posting's own title. The
 * brief carries the title as a must-level keyword so the title line can take
 * it (ADR 0044) — it stays a gap, a chip and a part of the score, and its own
 * card offers it where it belongs. On a skills line it is nonsense: measured
 * over 17 comparisons, three of the seven `add` keywords were the title
 * ("Frameworks/Libraries: …, Senior Software Engineer, Backend").
 */
export function skillGaps(gaps, jobTitle) {
  const title = wordsOf(jobTitle);
  return title === '' ? gaps : gaps.filter((r) => wordsOf(r.term) !== title);
}

/** Why an edit did not happen — every error the text operations can return, as the key that words it. */
const REASON = {
  'not-found': 'browser.edit.notFound',
  'no-replacement': 'browser.edit.noReplacement',
  protected: 'browser.edit.protected',
  'no-term': 'browser.edit.noTerm',
  'already-present': 'browser.edit.alreadyPresent',
  'no-skills-list': 'browser.edit.noSkillsList',
  'moved-on': 'browser.edit.movedOn',
};

/** The sentence for a refused edit; `fallback` names an error no table row knows. */
function reason(error, fallback = 'browser.edit.failed') {
  return t(REASON[error] ?? fallback);
}

/** The key an added keyword is remembered under — cards own the plain keys. */
const keywordKey = (term) => 'kw:' + term;

export function init(data) {
  const editor = document.getElementById('editor');
  const backdrop = document.getElementById('backdrop');
  const jd = document.getElementById('jd');
  const chips = document.getElementById('missing-chips');
  const saveButtons = document.querySelectorAll('[data-save-button]');
  const dirtyBar = document.getElementById('dirty-bar');
  const dirtyLive = document.getElementById('dirty-live');
  const ringButton = document.getElementById('score-ring');
  const ringArc = document.getElementById('score-arc');
  const ringNumber = document.getElementById('score-number');
  const scoreLive = document.getElementById('score-live');
  let announcedScore = null;
  // 2πr, straight off the element the server drew, so the two cannot drift.
  const ringLength = Number(ringArc.getAttribute('stroke-dasharray'));
  const panes = document.getElementById('panes');
  const storageKey = 'target-draft:' + data.matchId;
  const editsKey = 'target-edits:' + data.matchId;
  // The span Locate is pointing at, or null. Cleared on every edit, because an
  // offset into text the user has since changed points at the wrong words.
  let located = null;
  // What each card did, so it can be undone and so the marks survive a reload.
  // applied holds the inverse edit (one sentence), never a copy of the resume;
  // order is the sequence they were made in, which Undo all walks backwards.
  // A keyword added to the skills line is kept under keywordKey(term).
  let edits = { applied: {}, skipped: [], order: [] };
  // The missing keywords the resume backs — Apply all adds them — refreshed by render().
  let addable = [];

  function loadEdits() {
    try {
      const raw = JSON.parse(localStorage.getItem(editsKey) ?? 'null');
      if (raw && typeof raw === 'object') {
        const applied = raw.applied ?? {};
        edits = { applied, skipped: raw.skipped ?? [], order: raw.order ?? Object.keys(applied) };
      }
    } catch {}
  }
  function storeEdits() {
    try {
      if (Object.keys(edits.applied).length === 0 && edits.skipped.length === 0) localStorage.removeItem(editsKey);
      else localStorage.setItem(editsKey, JSON.stringify(edits));
    } catch {}
  }

  /** Remember an applied edit under `key`, context included so it can be undone out of order. */
  function remember(key, before, result) {
    edits.applied[key] = withContext(result.text, result.change ?? inverseEdit(before, result.text));
    edits.order = [...edits.order.filter((k) => k !== key), key];
    edits.skipped = edits.skipped.filter((k) => k !== key);
  }
  function forget(key) {
    delete edits.applied[key];
    edits.order = edits.order.filter((k) => k !== key);
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

  /** The ring: the number, the arc and the label a screen reader reads. */
  function paintRing(score) {
    ringNumber.textContent = String(score);
    ringArc.style.strokeDashoffset = String(ringLength - (ringLength * score) / 100);
    ringArc.setAttribute(
      'class',
      'transition-[stroke-dashoffset] duration-300 ' + RING_TONE[ringTone(score)],
    );
    ringButton.setAttribute('aria-label', t('browser.score.aria', { score }));
    // Announced only when the number moves — every keystroke repaints, few change it.
    if (scoreLive && announcedScore !== score) {
      scoreLive.textContent = t('browser.score.live', { score });
      announcedScore = score;
    }
  }

  function render() {
    const text = editor.value;
    const scored = scoreKeywords(data.keywords, text);
    // The number in the ring, recomputed on every keystroke and on every page
    // render — which is what a keyword override produces. The full score
    // formula when the match carries a breakdown (alignment and the red-flag
    // penalty held at what the last analysis judged, keywords and the
    // primary-stack cap live), else the plain coverage percentage for
    // pre-ADR-0012 matches.
    //
    // The same arithmetic the server runs (score.mjs mirrors score.ts), so
    // this is the score, not a second opinion about it: only the parts a word
    // search cannot read wait for the next analysis.
    let display = scored.score;
    if (data.scoring) {
      display = computeScore(entriesFromLive(scored.rows), data.scoring.alignment, data.scoring.redFlagCount, data.scoring.penalty ?? null).score;
    }
    paintRing(display);

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
    const gaps = orderKeywords(keywordGaps(scored.rows), data.jobText);
    const skills = skillGaps(gaps, data.sheet.jobTitle);
    // Every term the resume backs, whether or not a skills line can take it:
    // what no line takes gets a line of its own (apply-all.mjs:addKeywords).
    addable = skills.filter((r) => r.status === 'add').map((r) => ({ term: r.term, where: r.where }));
    paintBulk(bulkRows(skills));
    // Hardest requirement first, then the words the posting keeps repeating.
    for (const r of gaps) {
      const unproven = r.status === 'cannot_claim';
      // The user's own "I don't" or "Not sure" is a cannot_claim too, carrying
      // the note the answer left. Still a gap, so still a chip — but not an
      // offer to confirm: the card stopped asking about it.
      const answer = !unproven
        ? null
        : r.note === data.deniedNote
          ? t('browser.chips.saidNo')
          : r.note === data.unsureNote
            ? t('browser.chips.saidUnsure')
            : null;
      const b = document.createElement('button');
      b.type = 'button';
      b.className =
        CHIP_BASE + ' ' + (CHIP_LEVEL[keywordRank(r)] ?? CHIP_LEVEL[2]) + (unproven ? ' chip-unproven' : '');
      b.textContent = r.count > 1 ? r.term + ' ×' + r.count : r.term;
      b.title = [
        wantsLabel(r),
        gapLabel(r, false),
        r.count > 1 ? t('browser.keyword.inPosting', { n: r.count }) : null,
        answer ?? (unproven ? t('browser.chips.typeOrConfirm') : r.where ? t('browser.chips.addIn', { where: r.where }) : null),
        answer ? null : r.note,
      ].filter(Boolean).join(' · ');
      // A dashed chip has no section to send you to — the resume never mentions
      // the word. It opens the confirm card, the other way to make it count.
      b.addEventListener('click', () => (unproven && !answer ? openConfirm() : jumpToSection(r.where)));
      chips.appendChild(b);
      // "Add to Skills" only where it can honestly work: the model (or a fact the
      // user confirmed — applyFacts flips confirmed to `add` before this page
      // renders) says the term is addable, AND the resume has a line shaped like
      // a term list to put it on. cannot_claim never gets one, and neither does
      // the posting's title.
      if (r.status !== 'add' || !skills.includes(r)) continue;
      const probe = insertIntoSkills(editor.value, r.term, r.where);
      if (probe.error) continue;
      const add = document.createElement('button');
      add.type = 'button';
      add.className = CHIP_BASE + ' ' + CHIP_ADD;
      add.textContent = t('browser.chips.add');
      add.title = t('browser.chips.addTitle', { term: r.term });
      add.addEventListener('click', () => {
        const before = editor.value;
        const result = insertIntoSkills(before, r.term, r.where);
        if (result.error) { announce(reason(result.error, 'browser.edit.couldNotAdd')); return; }
        editor.value = result.text;
        remember(keywordKey(r.term), before, result);
        storeEdits();
        located = result.span;
        render();
        scrollEditorTo(result.span.start);
        announce(t('browser.chips.added', { term: r.term }));
      });
      chips.appendChild(add);
    }
    if (chips.children.length === 0) {
      const none = document.createElement('span');
      none.className = 'text-meta text-ink-faint';
      none.textContent = t('browser.chips.allPresent');
      chips.appendChild(none);
    }

    // Nothing marks the ring as stale: the sticky bar says it in full while
    // the text is dirty — the estimate, the delta and the button to re-run.
    const dirty = text !== data.resumeText;
    dirtyBar.hidden = !dirty;
    if (dirtyLive) {
      const said = dirty ? t('browser.editor.unsaved') : '';
      if (dirtyLive.textContent !== said) dirtyLive.textContent = said;
    }
    for (const b of saveButtons) b.disabled = !dirty;
    const saveText = document.getElementById('save-text');
    if (saveText) saveText.value = text;
    document.getElementById('reanalyze-text').value = dirty ? text : '';
    // Nothing to carry out until the text differs from what the AI judged.
    const copyEdits = document.getElementById('copy-edits');
    if (copyEdits) copyEdits.disabled = !dirty;
    paintCards();
    paintBatch();
    store(text);
    if (resumeView === 'doc') docPane?.schedule();
  }

  /** Open the "no evidence" tier of the confirm card and bring it into view. */
  function openConfirm() {
    const box = document.getElementById('confirm-unproven');
    if (!box) return;
    box.open = true;
    box.scrollIntoView({ block: 'center' });
    // Focus follows the disclosure, as it does when the summary itself is pressed.
    box.querySelector('summary')?.focus({ preventScroll: true });
    box.classList.remove('flash-target');
    void box.offsetWidth; // restart the animation when clicked twice
    box.classList.add('flash-target');
  }

  function jumpToSection(where) {
    if (!where) return;
    const hint = where.toLowerCase();
    const sections = ['summary', 'skills', 'experience', 'education', 'title'];
    const wanted = sections.find((s) => hint.includes(s));
    const lines = editor.value.split('\n');
    let offset = 0;
    for (const line of lines) {
      if (wanted && line.toLowerCase().includes(wanted) && line.length < 60) {
        // The document is the default view, and the textarea behind it is hidden:
        // outline the heading there, or open the text where the caret can land.
        if (resumeView === 'doc' && docPane?.locate(line.trim())) return;
        select(offset, offset + line.length);
        return;
      }
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
    if (resumeView !== 'text') showView('text');
    editor.focus();
    editor.setSelectionRange(start, end);
    scrollEditorTo(start);
  }

  function resetEdits() {
    editor.value = data.resumeText;
    // The outline was an offset into the text being discarded, and so were the
    // applied/skipped marks — they describe edits that no longer exist.
    located = null;
    edits = { applied: {}, skipped: [], order: [] };
    storeEdits();
    setBatchStatus('');
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

  // One panel, three views of it (TASKS U11): the selected tab names the panel,
  // takes the only tab stop, and the arrow keys move between the three.
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const selectTab = (tab) => {
    for (const t of tabs) {
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      t.tabIndex = t === tab ? 0 : -1;
    }
    panes.dataset.view = tab.dataset.tab;
    panes.setAttribute('aria-labelledby', tab.id);
    render();
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (e) => {
      const at = tabs.indexOf(tab);
      const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      const to = tabs[(next + tabs.length) % tabs.length];
      to.focus();
      selectTab(to);
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
        status.textContent = applied ? t(applied.inserted === '' ? 'browser.card.removed' : 'browser.card.applied') : skipped ? t('browser.card.skipped') : '';
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
      say(card, reason(result.error), true);
      return false;
    }
    editor.value = result.text;
    remember(card.dataset.card, before, result);
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
      runEdit(card, (text) => place(text, box, button.dataset.apply), t('browser.card.applied'));
    } else if (button.hasAttribute('data-remove')) {
      runEdit(card, (text) => removeSpan(text, button.dataset.remove), t('browser.card.removed'));
    } else if (button.hasAttribute('data-edit-apply')) {
      if (box) box.hidden = false;
      box?.querySelector('[data-edit-text]')?.focus();
    } else if (button.hasAttribute('data-edit-cancel')) {
      if (box) box.hidden = true;
    } else if (button.hasAttribute('data-edit-save')) {
      // The box carries the target itself: a card whose wording the gate refused has no Apply button.
      const wording = box?.querySelector('[data-edit-text]')?.value ?? '';
      if (runEdit(card, (text) => place(text, box, wording), t('browser.card.applied')) && box) box.hidden = true;
    } else if (button.hasAttribute('data-skip')) {
      if (!edits.skipped.includes(card.dataset.card)) edits.skipped.push(card.dataset.card);
      storeEdits();
      paintCards();
      say(card, t('browser.card.skipped'), false);
    } else if (button.hasAttribute('data-undo')) {
      const key = card.dataset.card;
      const entry = edits.applied[key];
      if (entry) {
        const back = undoEdit(editor.value, entry);
        if (back.error) { say(card, reason(back.error), true); return; }
        editor.value = back.text;
        located = back.span;
      }
      forget(key);
      edits.skipped = edits.skipped.filter((k) => k !== key);
      storeEdits();
      render();
      say(card, t('browser.card.undone'), false);
    }
  });

  /* ---------- Apply all / Undo all ---------- */

  const removalsBox = document.getElementById('apply-all-removals');
  const batchStatus = document.getElementById('apply-all-status');
  const undoAll = document.getElementById('undo-all');

  function setBatchStatus(message) {
    if (batchStatus) batchStatus.textContent = message;
  }

  /**
   * Every suggestion still open on the page, in the order the cards stand:
   * the changes and additions the gate let through, then the removals (unless
   * the box is unticked), then the keywords a skills line can take.
   */
  function collectOperations() {
    const ops = [];
    const withRemovals = !removalsBox || removalsBox.checked;
    // Two additions with the same section and place share a key: one edit
    // under it, or the second would overwrite the first one's Undo.
    const queued = new Set();
    for (const card of document.querySelectorAll('[data-card]')) {
      const key = card.dataset.card;
      if (edits.applied[key] || edits.skipped.includes(key) || queued.has(key)) continue;
      queued.add(key);
      const apply = card.querySelector('[data-apply]');
      const box = card.querySelector('[data-edit-box]');
      if (apply && box?.dataset.anchor) ops.push({ key, kind: 'add', anchor: box.dataset.anchor, wording: apply.dataset.apply });
      else if (apply && box?.dataset.quote) ops.push({ key, kind: 'change', quote: box.dataset.quote, wording: apply.dataset.apply });
      const remove = card.querySelector('[data-remove]');
      if (remove && withRemovals) ops.push({ key, kind: 'remove', quote: remove.dataset.remove });
    }
    return ops;
  }

  /** The count on the buttons, and Undo all only while something is applied. */
  function paintBatch() {
    const open = collectOperations().length + addable.length;
    for (const b of document.querySelectorAll('[data-apply-all]')) {
      b.hidden = false;
      b.disabled = open === 0;
      const count = b.querySelector('[data-apply-all-count]');
      if (count) count.textContent = String(open);
    }
    if (undoAll) undoAll.hidden = edits.order.length === 0;
  }

  function applyEverything() {
    const before = editor.value;
    const ops = collectOperations();
    if (ops.length === 0 && addable.length === 0) return;
    const cards = applyAll(before, ops);
    // The keywords last, onto the text the cards left: a rewritten bullet may already carry one.
    const words = addKeywords(cards.text, addable);
    const result = { text: words.text, done: [...cards.done, ...words.done], failed: [...cards.failed, ...words.failed] };
    editor.value = result.text;
    keep(result.done);
    located = null;
    render();
    // A card that could not be placed says why on itself, as its own Apply would.
    for (const f of result.failed) {
      const card = document.querySelector('[data-card="' + CSS.escape(f.key) + '"]');
      if (card) say(card, reason(f.error), true);
    }
    const summary = applyAllSummary(result);
    setBatchStatus(summary);
    announce(summary);
    if (resumeView === 'doc') docPane?.refresh();
  }

  /** Remember a batch's edits, each under its own key, in the order they were made. */
  function keep(done) {
    for (const d of done) {
      edits.applied[d.key] = d.edit;
      edits.order = [...edits.order.filter((k) => k !== d.key), d.key];
    }
    storeEdits();
  }

  /* ---------- every missing keyword at once ---------- */

  const bulkBox = document.getElementById('kw-bulk');
  const bulkList = document.getElementById('kw-bulk-list');
  const bulkAdd = document.getElementById('kw-bulk-add');
  const bulkStatus = document.getElementById('kw-bulk-status');
  // Ticks the user changed survive a redraw; a term's first tick is whether the resume backs it.
  const bulkTicked = new Map();
  let bulkKey = null;

  /**
   * The list of every keyword the resume does not spell, rebuilt only when the
   * set changes — render() runs on every keystroke, and a rebuild would close
   * the list and lose its ticks. A term the user said they do not have is not
   * offered at all.
   */
  function paintBulk(rows) {
    if (!bulkBox) return;
    bulkBox.hidden = rows.length === 0;
    const key = rows.map((r) => r.term).join('\u0001');
    if (key !== bulkKey) {
      bulkKey = key;
      bulkList.replaceChildren(...rows.map(bulkRow));
    }
    const ticked = bulkList.querySelectorAll('input:checked').length;
    for (const el of document.querySelectorAll('[data-kw-bulk-count]')) el.textContent = String(rows.length);
    bulkAdd.disabled = ticked === 0;
    bulkAdd.textContent = t('browser.bulk.add', { n: ticked });
  }

  function bulkRow(r) {
    const backed = r.status === 'add' || r.status === 'present';
    if (!bulkTicked.has(r.term)) bulkTicked.set(r.term, backed);
    const li = document.createElement('li');
    const label = document.createElement('label');
    label.className = 'flex cursor-pointer items-start gap-2 text-note leading-5';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent';
    box.checked = bulkTicked.get(r.term);
    box.dataset.term = r.term;
    box.dataset.where = r.where ?? '';
    box.addEventListener('change', () => {
      bulkTicked.set(r.term, box.checked);
      paintBulk(currentBulkRows());
    });
    const term = document.createElement('span');
    term.className = 'font-medium text-ink';
    term.textContent = r.term;
    const note = document.createElement('span');
    note.className = backed ? 'text-ink-faint' : 'text-warn';
    note.textContent = ' · ' + wantsLabel(r) + ' · ' + t(backed ? 'browser.bulk.backed' : 'browser.bulk.notBacked');
    const words = document.createElement('span');
    words.append(term, note);
    label.append(box, words);
    li.append(label);
    return li;
  }

  /** What the list offers of the skill gaps: a term the user answered "I don't" or "Not sure" to is left out. */
  function bulkRows(skills) {
    return skills.filter((r) => r.note !== data.deniedNote && r.note !== data.unsureNote);
  }

  function currentBulkRows() {
    const scored = scoreKeywords(data.keywords, editor.value);
    return bulkRows(skillGaps(orderKeywords(keywordGaps(scored.rows), data.jobText), data.sheet.jobTitle));
  }

  bulkAdd?.addEventListener('click', () => {
    const terms = [...bulkList.querySelectorAll('input:checked')].map((b) => ({ term: b.dataset.term, where: b.dataset.where }));
    if (terms.length === 0) return;
    const result = addKeywords(editor.value, terms);
    editor.value = result.text;
    keep(result.done);
    located = null;
    render();
    const summary = applyAllSummary(result, 'added');
    if (bulkStatus) bulkStatus.textContent = summary;
    announce(summary);
    if (resumeView === 'doc') docPane?.refresh();
  });

  /** Every applied edit undone, newest first; one the text has since moved past stays. */
  function undoEverything() {
    let undone = 0;
    let stuck = 0;
    for (const key of [...edits.order].reverse()) {
      const entry = edits.applied[key];
      if (!entry) { forget(key); continue; }
      const back = undoEdit(editor.value, entry);
      if (back.error) { stuck++; continue; }
      editor.value = back.text;
      forget(key);
      undone++;
    }
    storeEdits();
    located = null;
    render();
    const summary = t('browser.undo.undid', { n: undone }) + (stuck > 0 ? ' ' + t('browser.undo.stuck', { n: stuck }) : '');
    setBatchStatus(summary);
    announce(summary);
  }

  for (const b of document.querySelectorAll('[data-apply-all]')) b.addEventListener('click', applyEverything);
  undoAll?.addEventListener('click', undoEverything);
  removalsBox?.addEventListener('change', paintBatch);

  /* ---------- the document view ---------- */

  const docView = document.getElementById('doc-view');
  const textView = document.getElementById('text-view');
  const views = document.getElementById('resume-views');
  const docStatus = document.getElementById('doc-status');
  const viewKey = 'target-view';
  let resumeView = 'text';
  // Without ResizeObserver or fetch there is no pane, and the plain text is the whole page, as before.
  const docPane =
    docView && typeof ResizeObserver === 'function' && typeof fetch === 'function'
      ? mountDocPane({
          pane: document.getElementById('doc-pane'),
          notice: document.getElementById('doc-notice'),
          resumeId: data.resumeId,
          name: data.documentName,
          baseText: data.resumeText,
          getText: () => editor.value,
          setText: (text) => {
            editor.value = text;
            located = null;
            render();
          },
          say: (message) => {
            if (docStatus) docStatus.textContent = message;
          },
        })
      : null;

  function showView(view) {
    resumeView = docPane ? view : 'text';
    if (docView) docView.hidden = resumeView !== 'doc';
    if (textView) textView.hidden = resumeView !== 'text';
    for (const b of document.querySelectorAll('[data-resume-view]')) b.setAttribute('aria-pressed', String(b.dataset.resumeView === resumeView));
    for (const el of document.querySelectorAll('[data-text-only]')) el.hidden = resumeView !== 'text';
    for (const el of document.querySelectorAll('[data-doc-only]')) el.hidden = resumeView !== 'doc';
    try { localStorage.setItem(viewKey, resumeView); } catch {}
    if (resumeView === 'doc') docPane.refresh();
  }
  if (docPane && views) {
    views.hidden = false;
    for (const b of views.querySelectorAll('[data-resume-view]')) b.addEventListener('click', () => showView(b.dataset.resumeView));
  }

  /** A download of the document as drawn: the file the route answers, saved under the name it gives. */
  async function download(format, button) {
    if (!docPane) return;
    if (format === 'pdf' && docPane.last?.pdf === 'print') { docPane.print(data.documentName); return; }
    button.disabled = true;
    try {
      const res = await fetch(`/resumes/${data.resumeId}/document`, {
        method: 'POST',
        body: new URLSearchParams({ text: editor.value, baseText: data.resumeText, name: data.documentName, as: format }),
      });
      // The user's own .docx is printed as drawn: no renderer of ours re-sets it.
      if (res.status === 409) { docPane.print(data.documentName); return; }
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? t('browser.server.answered', { status: res.status }));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = fileNameFrom(res.headers.get('Content-Disposition')) ?? `resume.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (docStatus) docStatus.textContent = t('browser.download.done', { name: a.download });
    } catch (err) {
      if (docStatus) docStatus.textContent = t('browser.download.failed', { reason: err.message });
    } finally {
      button.disabled = false;
    }
  }
  for (const b of document.querySelectorAll('[data-download]')) b.addEventListener('click', () => download(b.dataset.download, b));

  // Copy works the same on every page; Locate only exists where this editor does.
  wireCopy(document);

  // Locate: outline the quote in the editor and scroll THE EDITOR to it. The
  // page does not move — losing the card you just read was the whole complaint.
  for (const button of document.querySelectorAll('[data-locate]')) {
    const card = button.closest('[data-card]');
    button.addEventListener('click', () => {
      if (resumeView === 'doc' && docPane?.locate(button.dataset.locate)) {
        if (card) say(card, t('browser.locate.outlined'), true);
        return;
      }
      const loc = locateQuote(editor.value, button.dataset.locate);
      if (!loc) {
        located = null;
        render();
        if (card) say(card, reason('not-found'), true);
        return;
      }
      // The document could not outline it (a line it draws differently): the text can.
      if (resumeView !== 'text') showView('text');
      located = loc;
      render();
      const line = editor.value.slice(0, loc.start).split('\n').length;
      // The outline is not the only signal: the line number is readable and announced.
      if (card) say(card, t('browser.locate.line', { n: line }), true);
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
      expand.textContent = t(tall ? 'browser.editor.shrink' : 'browser.editor.expand');
      expand.setAttribute('aria-expanded', String(tall));
    });
  }

  // The keyword table is the longest block on the page; on a phone it starts
  // folded, on a desktop it is simply open. Media queries cannot set `open`.
  const fold = document.querySelector('details.kw-fold');
  if (fold) fold.open = window.matchMedia('(min-width: 1024px)').matches;

  editor.value = load() ?? data.resumeText;
  loadEdits();
  let stored = null;
  try { stored = localStorage.getItem(viewKey); } catch {}
  showView(stored === 'text' ? 'text' : 'doc');
  render();
}
