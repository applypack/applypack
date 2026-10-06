/*
 * The Tailor page's document pane: the draft drawn as the file it would be —
 * the user's own .docx with the edits written in, or the clean version of a
 * PDF (POST /resumes/:id/document) — and each paragraph of it editable in
 * place. The text in the editor stays the one source of truth: an edit made
 * here is written back into that text, and the pane redraws from it, so the
 * score, the highlights, Undo and Save never see a second model of the resume.
 *
 * The pure helpers are exported and tested from src/web/doc-pane.test.ts; the
 * DOM half (`mountDocPane`) is wired by target-page.mjs. The drawing is
 * docx-preview's (vendor/README.md), loaded the first time the pane opens.
 */

import { diffLines } from './line-diff.mjs';
import { t } from './i18n.mjs';

/** Shortest key worth marking or matching: under this, "and" would light up half the page. */
const MIN_KEY = 4;
/** docx-preview sets tab stops half a second after it draws; the pane swaps once they are set. */
const TAB_SETTLE_MS = 560;
/** How long typing waits before the pane redraws — the server round trip is ~100 ms, the draw ~70. */
const REDRAW_DEBOUNCE_MS = 700;
/** Below this the page is unreadable; the pane scrolls sideways instead. */
const MIN_SCALE = 0.35;
/** The pane's own padding around the sheet, in CSS pixels at 1:1. */
const SHEET_GUTTER_PX = 16;
/** A line marker the text carries and the document draws as formatting instead. */
const MARKER = /^(?:#{1,6} |[-•*·‣▪] )/;

const RENDER_OPTIONS = {
  className: 'docx',
  inWrapper: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: true,
  experimental: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: false,
  renderEndnotes: false,
  renderComments: false,
  renderChanges: false,
  // An altChunk is raw HTML from inside the file, drawn into a same-origin
  // frame where the page's CSP lets its scripts run. A resume has no need of one.
  renderAltChunks: false,
  // data: URLs, not blob: — the dashboard's CSP allows the one and not the other.
  useBase64URL: true,
};

/* ---------- pure ---------- */

/** The words of a line with everything else — case, punctuation, markers, tab glyphs — set aside. */
export function wordsKey(s) {
  return String(s ?? '')
    // NFKC, not NFKD: a formula's 𝑂 becomes O, and a й stays a й.
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * The keys of the lines the draft changed or added against the text the
 * comparison read — the paragraphs the pane marks. A table row's cells are
 * keyed one by one, because the document draws each cell as its own paragraph.
 */
export function changedKeys(baseText, text) {
  const keys = new Set();
  for (const op of diffLines(baseText, text)) {
    if (op.op !== 'change' && op.op !== 'insert') continue;
    // Of a changed row, only the cells that changed: "Programming:" beside a
    // longer skills cell is not an edit.
    const was = new Set(op.op === 'change' ? op.a.text.split(' | ').map(wordsKey) : []);
    for (const part of [op.b.text, ...op.b.text.split(' | ')]) {
      const key = wordsKey(part);
      if (key.length >= MIN_KEY && !was.has(key)) keys.add(key);
    }
  }
  return keys;
}

/** The zoom that fits a sheet of `pageWidth` pixels into `available` pixels, never enlarging it. */
export function fitScale(available, pageWidth) {
  if (!(pageWidth > 0) || !(available > 0)) return 1;
  return Math.min(1, Math.max(MIN_SCALE, available / pageWidth));
}

/** Most text lines one paragraph is drawn from: a bullet or a summary a PDF's text broke over several. */
const MAX_WINDOW = 4;
/** A paragraph this short is not looked for inside a longer line — "Go" is in half of them. */
const MIN_PART_KEY = 4;

/**
 * Where a paragraph of the document stands in the text: the span to replace
 * when it is edited. A paragraph is found by its words, in this order:
 *
 * 1. a whole line (a bullet behind its marker, a heading behind "## ");
 * 2. a cell of a table row ("label | values");
 * 3. up to four lines in a row — a paragraph the text broke over lines;
 * 4. a part of one line — the label or the values of a skills row the clean
 *    version draws as a table ("Programming: PHP, Go" in the text).
 *
 * The n-th identical paragraph maps to the n-th identical match. Null when
 * none reads so, and the paragraph is edited in the plain text instead.
 */
export function locateParagraph(text, paragraphText, occurrence = 0) {
  const want = wordsKey(paragraphText);
  if (want.length === 0) return null;
  const lines = String(text).split('\n');
  const starts = [];
  for (let i = 0, at = 0; i < lines.length; i++) { starts.push(at); at += lines[i].length + 1; }
  const bodyAt = (i) => {
    const marker = MARKER.exec(lines[i])?.[0] ?? '';
    return { marker, start: starts[i] + marker.length, body: lines[i].slice(marker.length) };
  };

  const strategies = [
    function* wholeLines() {
      for (let i = 0; i < lines.length; i++) {
        const { marker, start, body } = bodyAt(i);
        if (wordsKey(body) === want) yield { line: i, start, end: starts[i] + lines[i].length, cell: false, marker };
      }
    },
    function* cells() {
      for (let i = 0; i < lines.length; i++) {
        const { start, body } = bodyAt(i);
        if (!body.includes(' | ')) continue;
        let at = start;
        for (const part of body.split(' | ')) {
          if (wordsKey(part) === want) yield { line: i, start: at, end: at + part.length, cell: true, marker: '' };
          at += part.length + 3;
        }
      }
    },
    function* windows() {
      for (let i = 0; i < lines.length; i++) {
        let words = '';
        for (let j = i; j < Math.min(lines.length, i + MAX_WINDOW); j++) {
          if (lines[j].trim() === '') break;
          words += wordsKey(j === i ? bodyAt(i).body : lines[j]);
          if (!want.startsWith(words)) break;
          if (j > i && words === want) {
            const { marker, start } = bodyAt(i);
            yield { line: i, start, end: starts[j] + lines[j].length, cell: false, marker, lines: j - i + 1 };
          }
        }
      }
    },
    function* partsOfLines() {
      if (want.length < MIN_PART_KEY) return;
      for (let i = 0; i < lines.length; i++) {
        const span = keySpan(lines[i], want, paragraphText);
        if (span) yield { line: i, start: starts[i] + span[0], end: starts[i] + span[1], cell: true, marker: '' };
      }
    },
  ];
  for (const strategy of strategies) {
    const found = [...strategy()];
    if (found.length > occurrence) return found[occurrence];
    if (found.length > 0) return null;
  }
  return null;
}

/**
 * The characters of `line` whose words are `want`, as [start, end), or null.
 * Built character by character so a folded letter (a formula's 𝑂) still
 * points at its own place in the line; the span runs from the first word
 * character to the last, punctuation around it left where it was.
 */
function keySpan(line, want, paragraphText) {
  let key = '';
  const from = [];
  let i = 0;
  for (const ch of line) {
    for (const k of wordsKey(ch)) { key += k; from.push([i, i + ch.length]); }
    i += ch.length;
  }
  // The paragraph's own edge punctuation ("Programming:") belongs to the span,
  // or rewriting the label would leave its colon behind twice.
  const trimmed = String(paragraphText).trim();
  const head = /^[^\p{L}\p{N}]*/u.exec(trimmed)[0];
  const tail = /[^\p{L}\p{N}]*$/u.exec(trimmed)[0];
  const spans = [];
  for (let at = key.indexOf(want); at !== -1; at = key.indexOf(want, at + 1)) {
    let start = from[at][0];
    let end = from[at + want.length - 1][1];
    // Whole words only: "Others" is not the end of "brothers".
    if (/[\p{L}\p{N}]/u.test(line[start - 1] ?? '') || /[\p{L}\p{N}]/u.test(line[end] ?? '')) continue;
    if (head && line.slice(start - head.length, start) === head) start -= head.length;
    if (tail && line.slice(end, end + tail.length) === tail) end += tail.length;
    spans.push([start, end]);
  }
  return spans.length === 1 ? spans[0] : null;
}

/**
 * The text with a located span rewritten to `words`. Emptying a paragraph
 * removes its line, newline and all — the way deleting a paragraph in Word
 * does; a table cell is only ever emptied, never removed, because the row
 * around it stays.
 */
export function rewriteSpan(text, at, words) {
  let clean = String(words).replace(/[\s\u2003]+/g, ' ').trim();
  // A bullet the file types as text is in the paragraph's words too; the span
  // starts after it, so it goes once, not twice.
  const marker = (at.marker ?? '').trim();
  if (marker && clean.startsWith(marker)) clean = clean.slice(marker.length).trim();
  if (clean.length > 0 || at.cell) return text.slice(0, at.start) + clean + text.slice(at.end);
  const lineStart = text.lastIndexOf('\n', at.start - 1) + 1;
  const newline = text.indexOf('\n', at.end);
  if (newline !== -1) return text.slice(0, lineStart) + text.slice(newline + 1);
  return text.slice(0, Math.max(0, lineStart - 1));
}

/**
 * Where a page would end on the continuous sheet the pane draws, in CSS
 * pixels from the sheet's top: the first page holds its height less both
 * margins, and so does every page after it. An estimate — Word keeps a
 * heading with its next line — and the pane says so.
 */
export function pageBreaks(sheetHeight, page) {
  const body = page.height - page.top - page.bottom;
  if (!(body > 0)) return [];
  const out = [];
  for (let y = page.top + body; y < sheetHeight - page.bottom; y += body) out.push(Math.round(y));
  return out;
}

/**
 * The print frame's own stylesheet: the file's page size and margins as the
 * printed page's, and the pane's furniture gone — the sheet's padding was the
 * margin on screen, and on paper @page is. Colours print as the file sets them.
 */
export function printCss(page) {
  const px = (n) => `${Math.round(n * 100) / 100}px`;
  return [
    `@page { size: ${px(page.width)} ${px(page.height)}; margin: ${px(page.top)} ${px(page.right)} ${px(page.bottom)} ${px(page.left)}; }`,
    'html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    '.docx-wrapper { background: none !important; padding: 0 !important; display: block !important; zoom: 1 !important; }',
    '.docx-wrapper > section.docx { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; min-height: 0 !important; hyphens: manual; }',
    '.doc-page-guide { display: none !important; }',
    '.doc-changed, .doc-editing, .located { background: none !important; box-shadow: none !important; outline: none !important; }',
    'p { orphans: 2; widows: 2; }',
  ].join('\n');
}

/** The name a download carries: the UTF-8 form of Content-Disposition when there is one, else the plain one. */
export function fileNameFrom(header) {
  const h = String(header ?? '');
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(h);
  if (utf) {
    try { return decodeURIComponent(utf[1].trim()); } catch {}
  }
  return /filename="([^"]*)"/i.exec(h)?.[1] ?? null;
}

/**
 * A link's address as the pane keeps it: http(s) and mailto only. A link's
 * target is whatever the file's relationships say, and a `javascript:` one
 * would run in the dashboard's origin on a click (format.ts:safeHref, the
 * same rule for a feed's links).
 */
export function safeLink(href) {
  return /^(?:https?:|mailto:)/i.test(String(href ?? '').trim()) ? String(href).trim() : null;
}

/** A stylesheet's text made safe to write between <style> tags: nothing in it can close the element. */
export function styleText(css) {
  return String(css ?? '').replace(/<\//g, '<\\/');
}

/** Bytes from the base64 the route sends. */
export function bytesOf(base64) {
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/* ---------- DOM ---------- */

let vendor = null;

/** docx-preview and the JSZip it expects on window, loaded once, in that order. */
function loadVendor() {
  vendor ??= (async () => {
    for (const src of ['/static/vendor/jszip.min.js', '/static/vendor/docx-preview.min.js']) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(t('browser.doc.loadFailed', { src })));
        document.head.appendChild(script);
      });
    }
    return window.docx;
  })();
  return vendor;
}

/**
 * Wire the pane. `getText` / `setText` are the editor's; `onEdit` runs after
 * a paragraph edit wrote the text (the page re-scores); `say` is the status
 * line. Returns the controls target-page.mjs drives.
 */
export function mountDocPane({ pane, notice, resumeId, name, baseText, getText, setText, say }) {
  const stage = document.createElement('div');
  stage.className = 'doc-stage';
  stage.setAttribute('aria-hidden', 'true');
  const stageStyles = document.createElement('div');
  const stageBody = document.createElement('div');
  stage.append(stageStyles, stageBody);
  document.body.appendChild(stage);

  let last = null;
  let token = 0;
  let timer = null;
  let drawnText = null;
  let drawingText = null;
  let editing = null;
  let page = null;
  // A drawing that finished while a paragraph was being edited waits for the edit to end.
  let deferred = false;

  async function draw() {
    const mine = ++token;
    const text = getText();
    drawingText = text;
    say(t('browser.doc.drawing'));
    let data;
    try {
      const docx = await loadVendor();
      const res = await fetch(`/resumes/${resumeId}/document`, {
        method: 'POST',
        body: new URLSearchParams({ text, baseText, name, as: 'preview' }),
      });
      if (mine !== token) return;
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? t('browser.server.answered', { status: res.status }));
      data = await res.json();
      await docx.renderAsync(bytesOf(data.docx), stageBody, stageStyles, RENDER_OPTIONS);
      await new Promise((r) => setTimeout(r, TAB_SETTLE_MS));
    } catch (err) {
      if (mine === token) {
        drawingText = null;
        say(t('browser.doc.drawFailed', { reason: err.message }));
      }
      return;
    }
    if (mine !== token) return;
    if (editing) { deferred = true; return; }
    for (const a of stageBody.querySelectorAll('a')) {
      const href = safeLink(a.getAttribute('href'));
      if (href) a.setAttribute('href', href);
      else a.removeAttribute('href');
    }
    const keep = pane.scrollTop;
    pane.replaceChildren(...stageStyles.childNodes, ...stageBody.childNodes);
    pane.scrollTop = keep;
    last = data;
    drawnText = text;
    if (notice) {
      notice.textContent = data.notice ?? '';
      notice.hidden = !data.notice;
    }
    measure();
    mark(text);
    fit();
    say(t(data.kind === 'own' ? 'browser.doc.own' : 'browser.doc.clean'));
  }

  /** The sheet's page geometry, read off the section docx-preview drew (its padding is the file's margins). */
  function measure() {
    const sheet = pane.querySelector('section.docx');
    if (!sheet) { page = null; return; }
    const cs = getComputedStyle(sheet);
    page = {
      width: sheet.offsetWidth,
      height: parseFloat(cs.minHeight) || sheet.offsetWidth * 1.294,
      top: parseFloat(cs.paddingTop) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
      right: parseFloat(cs.paddingRight) || 0,
    };
    sheet.style.position = 'relative';
    for (const [n, y] of pageBreaks(sheet.offsetHeight, page).entries()) {
      const guide = document.createElement('div');
      guide.className = 'doc-page-guide';
      guide.style.top = y + 'px';
      guide.textContent = t('browser.doc.pageGuide', { n: n + 2 });
      sheet.appendChild(guide);
    }
  }

  function paragraphs() {
    return [...pane.querySelectorAll('section.docx article p')];
  }

  function mark(text) {
    const changed = changedKeys(baseText, text);
    for (const p of paragraphs()) p.classList.toggle('doc-changed', changed.has(wordsKey(p.textContent)));
  }

  function fit() {
    const wrapper = pane.querySelector('.docx-wrapper');
    if (!wrapper || !page) return;
    wrapper.style.zoom = String(fitScale(pane.clientWidth - 2 * SHEET_GUTTER_PX, page.width + 2 * SHEET_GUTTER_PX));
  }
  new ResizeObserver(fit).observe(pane);

  /* ---------- editing a paragraph in place ---------- */

  /**
   * A paragraph's words as the text writes them: a tab stop — a company and
   * its place, a title and its dates — becomes " | ", the separator the text
   * reader and the patcher both split on, so an edit keeps the two columns.
   */
  function wordsOf(p) {
    let out = '';
    for (const node of p.childNodes) out += textWithTabs(node);
    return out.replace(/[ \t]+/g, ' ').trim();
  }
  function textWithTabs(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.classList.contains('docx-tab-stop')) return ' | ' + node.textContent.replace(/\u2003/g, '').trim() + ' ';
    let out = '';
    for (const child of node.childNodes) out += textWithTabs(child);
    return out;
  }

  function occurrenceOf(p) {
    const key = wordsKey(p.textContent);
    return paragraphs().filter((q) => wordsKey(q.textContent) === key).indexOf(p);
  }

  function begin(p, event) {
    if (editing?.p === p) return;
    if (editing) commit();
    if (p.querySelector('math')) {
      say(t('browser.doc.formula'));
      return;
    }
    const occurrence = occurrenceOf(p);
    if (!locateParagraph(getText(), p.textContent, occurrence)) {
      say(t('browser.doc.multiLine'));
      return;
    }
    // Escape puts back these very nodes: no round trip through the HTML parser.
    editing = { p, occurrence, words: p.textContent, before: wordsOf(p), saved: p.cloneNode(true) };
    p.contentEditable = 'plaintext-only';
    if (p.contentEditable !== 'plaintext-only') p.contentEditable = 'true';
    p.classList.add('doc-editing');
    p.focus();
    // Put the caret where the click landed rather than at the start of the paragraph.
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (range && p.contains(range.startContainer)) {
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    say(t('browser.doc.editing'));
  }

  function end() {
    if (!editing) return;
    editing.p.removeAttribute('contenteditable');
    editing.p.classList.remove('doc-editing');
    editing = null;
    if (deferred) { deferred = false; draw(); }
  }

  function commit() {
    if (!editing) return;
    const { p, occurrence, words, before, saved } = editing;
    const after = wordsOf(p);
    end();
    const same = (s) => s.replace(/\s+/g, ' ').trim();
    if (same(after) === same(before)) return;
    // Found again now: the text may have moved since the click, and a span
    // from before the move would rewrite someone else's words.
    const at = locateParagraph(getText(), words, occurrence);
    if (!at) {
      p.replaceChildren(...saved.childNodes);
      say(t('browser.doc.lost'));
      return;
    }
    setText(rewriteSpan(getText(), at, after));
    say(t(after.trim() ? 'browser.doc.changed' : 'browser.doc.removed'));
    draw();
  }

  function cancel() {
    if (!editing) return;
    editing.p.replaceChildren(...editing.saved.childNodes);
    end();
    say(t('browser.doc.putBack'));
  }

  pane.addEventListener('click', (event) => {
    // A link in the resume is words to edit here, not somewhere to go.
    if (event.target.closest?.('a')) event.preventDefault();
    const p = event.target.closest?.('section.docx article p');
    if (p) begin(p, event);
  });
  pane.addEventListener('keydown', (event) => {
    if (!editing) return;
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    else if (event.key === 'Escape') { event.preventDefault(); cancel(); }
  });
  pane.addEventListener('focusout', (event) => {
    if (editing && event.target === editing.p) commit();
  });

  /** Outline the paragraph that holds `quote` and bring it into the pane's view. */
  function locate(quote) {
    const key = wordsKey(quote);
    if (key.length < MIN_KEY) return false;
    const p = paragraphs().find((q) => wordsKey(q.textContent).includes(key));
    if (!p) return false;
    p.classList.remove('located');
    void p.offsetWidth;
    p.classList.add('located');
    p.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  }

  return {
    /** Redraw now, if the text moved since the last drawing and is not being drawn already. */
    refresh() {
      const text = getText();
      if (text !== drawnText && text !== drawingText) draw();
    },
    /** Redraw once typing pauses. */
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => this.refresh(), REDRAW_DEBOUNCE_MS);
    },
    locate,
    /** The last drawing's answer: its kind, the note, how its PDF is made. */
    get last() {
      return last;
    },
    print,
  };

  /**
   * Print the drawn document from a frame of its own, so the browser's "Save
   * as PDF" gets the sheet and nothing of the dashboard around it. Used for
   * the user's own .docx, which no renderer of ours re-draws.
   */
  function print(title) {
    if (!page || !pane.querySelector('section.docx')) { say(t('browser.doc.stillDrawing')); return; }
    for (const old of document.querySelectorAll('.doc-print-frame')) old.remove();
    const frame = document.createElement('iframe');
    frame.className = 'doc-print-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // No scripts in the frame, whatever the file holds: docx-preview writes a
    // font name or a style id from the file into its <style> text unescaped,
    // and HTML never escapes <style> text — "x</style><img onerror=…>" in a
    // crafted .docx would otherwise run here, in the dashboard's origin
    // (review 2026-09-30). Printing needs only the modal.
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    const styles = [...pane.querySelectorAll('style')].map((st) => `<style>${styleText(st.textContent)}</style>`).join('');
    const wrapper = pane.querySelector('.docx-wrapper').outerHTML;
    const safeTitle = String(title).replace(/[<&]/g, '');
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title>${styles}<style>${printCss(page)}</style></head><body>${wrapper}</body></html>`;
    frame.addEventListener('load', () => {
      // The PDF a browser saves is named after the page it prints.
      const pageTitle = document.title;
      document.title = safeTitle;
      // Safari fires no afterprint for a frame; the page getting focus back is the dialog closing.
      const restore = () => { document.title = pageTitle; };
      frame.contentWindow.addEventListener('afterprint', restore, { once: true });
      window.addEventListener('focus', restore, { once: true });
      frame.contentWindow.focus();
      frame.contentWindow.print();
    });
    document.body.appendChild(frame);
  }
}
