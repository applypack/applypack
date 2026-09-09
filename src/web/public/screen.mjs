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

/** "Scoring… 12 of 40 (2 failed)" — pure, tested from src/web/screen.test.ts. */
export function progressLine(state) {
  const done = state.done + state.failed;
  const failed = state.failed > 0 ? ` (${state.failed} failed)` : '';
  return `Scoring… ${done} of ${state.total}${failed} — one call per applicant, three at a time; the page updates itself.`;
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
    for (const b of buttons) b.disabled = n === 0;
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

/** The upload form: a count of what was picked, and a folder pick sent with paths. */
function wireUpload(form) {
  const inputs = [...form.querySelectorAll('input[type=file]')];
  const line = form.querySelector('[data-picked]');
  const button = form.querySelector('button[type=submit], button:not([type])');
  const picked = () => inputs.flatMap((i) => [...(i.files ?? [])]);
  const paint = () => {
    const files = picked();
    if (line) line.textContent = files.length === 0 ? '' : `${files.length} file${files.length === 1 ? '' : 's'} picked`;
    if (button) button.disabled = files.length === 0;
  };
  for (const i of inputs) {
    i.addEventListener('change', () => {
      // One pick at a time: choosing a folder clears a file pick and the other way round.
      for (const other of inputs) if (other !== i) other.value = '';
      paint();
    });
  }
  form.addEventListener('submit', (e) => {
    const files = picked();
    if (!files.some((f) => f.webkitRelativePath)) return;
    e.preventDefault();
    const body = new FormData();
    for (const { file, name } of pathedFiles(files)) body.append('files', file, name);
    for (const b of form.querySelectorAll('button')) b.disabled = true;
    fetch(form.action, { method: 'POST', body, credentials: 'same-origin' })
      .then((res) => {
        location.href = res.redirected ? res.url : form.action.replace(/\/applicants$/, '');
      })
      .catch(() => location.reload());
  });
  paint();
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
