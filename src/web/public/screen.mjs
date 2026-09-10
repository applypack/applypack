/*
 * The screening page's behaviours, all progressive: while a run is in flight
 * the results line polls the state route and reloads when it ends; a decision
 * select saves itself (select-commit.mjs); the header checkbox ticks every row
 * and the bulk bar says how many are ticked; a folder pick sends each file
 * under its folder path so "Ivan Petrenko/CV.pdf" stays readable in the table.
 * Without JS the page still works — the Score button says how many are
 * pending on reload, the decision form has a Save button in <noscript>, the
 * bulk bar posts whatever is ticked, and a folder pick sends plain file names.
 */
import { wireSelectCommits } from './select-commit.mjs';

const POLL_MS = 2000;

/** "Scoring… 2 of 5 — now reading №3, №4; 1 queued" — pure, tested from src/web/screen.test.ts; the server renders the same words. */
export function progressLine(state) {
  const done = state.done + state.failed;
  const failed = state.failed > 0 ? ` (${state.failed} failed)` : '';
  const reading = state.inFlight?.length > 0 ? ` — now reading ${state.inFlight.map((n) => `№${n}`).join(', ')}` : '';
  const queued = state.queued?.length > 0 ? `; ${state.queued.length} queued` : '';
  return `Scoring… ${done} of ${state.total}${failed}${reading}${queued}. Each row says where it is; scored rows appear on refresh.`;
}

/** Where one applicant is in the run: queued, scoring, scored, or nowhere. Pure. */
export function rowRunState(number, state) {
  if (!state || !state.running) return null;
  if (state.inFlight?.includes(number)) return 'scoring';
  if (state.queued?.includes(number)) return 'queued';
  if (state.finished?.includes(number)) return 'scored';
  return null;
}

const RUN_BADGE = { queued: 'queued', scoring: 'scoring…', scored: 'scored — refresh for the new number' };

function paintRows(state) {
  for (const tr of document.querySelectorAll('tr[data-applicant]')) {
    const s = rowRunState(Number(tr.dataset.applicant), state);
    if (s) tr.dataset.runState = s;
    else delete tr.dataset.runState;
    const badge = tr.querySelector('[data-run-badge]');
    if (badge) badge.textContent = s ? RUN_BADGE[s] : '';
  }
}

/** "3 of 12 selected" — pure. */
export function selectionLine(checked, total) {
  return checked === 0 ? `none of ${total} selected` : `${checked} of ${total} selected`;
}

/**
 * The files a folder pick hands over, each named by its path inside the
 * folder — what the server stores as the file's name. Pure.
 */
export function pathedFiles(files) {
  return [...files].map((f) => ({ file: f, name: f.webkitRelativePath && f.webkitRelativePath.length > 0 ? f.webkitRelativePath : f.name }));
}

function pollProgress(el) {
  const id = el.dataset.screening;
  async function tick() {
    try {
      const res = await fetch(`/screen/${id}/state`);
      if (!res.ok) return location.reload();
      const state = await res.json();
      if (!state.running) return location.reload();
      el.textContent = progressLine(state);
      paintRows(state);
    } catch {
      /* transient — the next tick retries */
    }
    setTimeout(tick, POLL_MS);
  }
  setTimeout(tick, POLL_MS);
}

function wireSelection(form) {
  const all = form.querySelector('[data-select-all]');
  const boxes = () => [...form.querySelectorAll('input[name="ids"]')];
  const line = form.querySelector('[data-selection]');
  const buttons = [...form.querySelectorAll('button[name="do"]')];
  const paint = () => {
    const n = boxes().filter((b) => b.checked).length;
    if (line) line.textContent = selectionLine(n, boxes().length);
    // A button may need more than one row — Compare wants two.
    for (const b of buttons) b.disabled = n < (Number(b.dataset.min) || 1);
    if (all) all.indeterminate = n > 0 && n < boxes().length;
  };
  if (all) {
    all.addEventListener('change', () => {
      for (const b of boxes()) b.checked = all.checked;
      paint();
    });
  }
  form.addEventListener('change', (e) => {
    if (e.target?.name === 'ids') paint();
  });
  form.addEventListener('submit', (e) => {
    const doing = e.submitter?.value;
    if (doing === 'delete' && !confirm(`Remove ${boxes().filter((b) => b.checked).length} applicant(s) with their files and every verdict?`)) e.preventDefault();
  });
  paint();
}

/**
 * The upload form: a pick IS the upload. Choosing files, a zip or a folder
 * sends them at once and the scoring starts on the server — there is no
 * second press (the browser's own "upload N files to this site?" question
 * on a folder pick is the browser's, and the only one). A folder pick is
 * sent by fetch so each file keeps its path as its name; plain files go
 * as the form's own POST. Without JS the button stays and posts as before.
 */
function wireUpload(form) {
  const inputs = [...form.querySelectorAll('input[type=file]')];
  const line = form.querySelector('[data-picked]');
  const button = form.querySelector('[data-upload-button]');
  const picked = () => inputs.flatMap((i) => [...(i.files ?? [])]);
  let sending = false;
  const send = () => {
    const files = picked();
    if (files.length === 0 || sending) return;
    sending = true;
    if (line) line.textContent = `${files.length} file${files.length === 1 ? '' : 's'} picked — uploading…`;
    for (const b of form.querySelectorAll('button')) b.disabled = true;
    for (const i of inputs) i.disabled = true;
    if (!files.some((f) => f.webkitRelativePath)) {
      // Re-enable the input that holds the files, or the form posts without them.
      for (const i of inputs) i.disabled = i.files?.length === 0;
      form.submit();
      return;
    }
    const body = new FormData();
    for (const { file, name } of pathedFiles(files)) body.append('files', file, name);
    fetch(form.action, { method: 'POST', body, credentials: 'same-origin' })
      .then((res) => {
        location.href = res.redirected ? res.url : form.action.replace(/\/applicants$/, '');
      })
      .catch(() => location.reload());
  };
  for (const i of inputs) {
    i.addEventListener('change', () => {
      // One pick at a time: choosing a folder clears a file pick and the other way round.
      for (const other of inputs) if (other !== i) other.value = '';
      send();
    });
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  // With JS the pick sends itself; the button is the no-JS path.
  if (button) button.hidden = true;
  if (line) line.textContent = '';
}

export function init() {
  wireSelectCommits(document);
  const progress = document.getElementById('run-progress');
  if (progress && progress.dataset.running) pollProgress(progress);
  const bulk = document.getElementById('bulk-form');
  if (bulk) wireSelection(bulk);
  const upload = document.getElementById('upload-form');
  if (upload) wireUpload(upload);
}
