/*
 * Two small jobs on the companies pages, in one dependency-free ES module
 * (TASKS §17 stage A):
 *
 * 1. The resolve progress page polls its state route and narrates the URLs
 *    as they are answered, then reloads into the preview.
 * 2. The watchlist section's interval / policy selects submit themselves —
 *    the same mechanism the engine pickers use, so nobody has to find a Save
 *    button. Without JS the <noscript> Save button is there and the plain
 *    form POST still works.
 *
 * `resolveLine` is pure — unit-tested from src/web/watchlist.test.ts.
 */

const POLL_MS = 1500;

/** "7 of 20 resolved · linear.app/careers" */
export function resolveLine(state) {
  const head = `${state.resolved} of ${state.total} resolved`;
  if (state.done) return `${head} — opening the preview…`;
  return state.current ? `${head} · ${short(state.current)}` : head;
}

/** A URL short enough for one line, without the scheme. */
export function short(url) {
  return String(url).replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 60);
}

/** "Vercel — Greenhouse · 88 postings" */
export function verdictLine(row) {
  return `${row.name} — ${row.verdict}`;
}

async function poll(box) {
  const list = document.getElementById('wl-lines');
  let shown = 0;
  for (;;) {
    let state;
    try {
      const resp = await fetch(box.dataset.state);
      if (!resp.ok) break;
      state = await resp.json();
    } catch {
      break;
    }
    box.textContent = resolveLine(state);
    for (const row of (state.rows || []).slice(shown)) {
      const li = document.createElement('li');
      li.textContent = verdictLine(row);
      list?.appendChild(li);
    }
    shown = (state.rows || []).length;
    if (state.done) {
      window.location.href = box.dataset.done;
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  box.textContent = 'Lost contact with the run — reload this page.';
}

function wireSelfSubmit() {
  for (const form of document.querySelectorAll('form[action$="/watch"]')) {
    form.addEventListener('change', () => form.submit());
  }
}

export function init() {
  const box = document.getElementById('wl-progress');
  if (box) void poll(box);
  wireSelfSubmit();
}

init();
