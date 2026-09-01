/*
 * Drag-and-drop for the /applications board. Served as a static ES module;
 * the page boots it with initBoard(document). A drop POSTs to the same
 * stage-only endpoint the per-card form uses, then reloads so counts,
 * Closed panel and funnel stats re-render from the server. The form stays
 * in the DOM as the keyboard / no-JS path (collapsed until the card has
 * hover or focus — CSS keyed off body[data-dnd]). Importing this file
 * under node:test touches no DOM.
 */

/** The request for one move, or null when there is nothing to do. */
export function planMove(jobId, fromStage, toStage) {
  if (!jobId || !toStage || fromStage === toStage) return null;
  return {
    action: `/jobs/${encodeURIComponent(jobId)}/stage`,
    body: `toStage=${encodeURIComponent(toStage)}`,
  };
}

// Full literal class names — the Tailwind CDN JIT compiles what it sees.
const HIGHLIGHT = ['ring-2', 'ring-accent/40', 'bg-accent/5'];
const DRAGGING = 'opacity-50';

async function submitMove(plan) {
  try {
    const res = await fetch(plan.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: plan.body,
    });
    return res.ok;
  } catch {
    return false;
  }
}

function clearHighlights(doc) {
  for (const el of doc.querySelectorAll('[data-drop-stage]')) {
    el.classList.remove(...HIGHLIGHT);
  }
}

function showMoveError(doc) {
  doc.getElementById('move-error')?.remove();
  const div = doc.createElement('div');
  div.id = 'move-error';
  div.setAttribute('role', 'alert');
  div.className =
    'mb-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-2.5 text-sm text-danger';
  div.textContent = 'Move failed — the stage was not changed. Try again.';
  doc.getElementById('main')?.firstElementChild?.prepend(div);
}

/** Wire cards and columns; returns how many cards became draggable. */
export function initBoard(doc) {
  const cards = [...doc.querySelectorAll('li[data-job-id]')];
  const targets = [...doc.querySelectorAll('[data-drop-stage]')];
  if (cards.length === 0 || targets.length === 0) return 0;

  doc.body.setAttribute('data-dnd', '');
  let dragged = null; // { li, jobId, fromStage }

  for (const li of cards) {
    li.setAttribute('draggable', 'true');
    // The card link would otherwise start a native URL drag.
    li.querySelector('a')?.setAttribute('draggable', 'false');
    li.addEventListener('dragstart', (e) => {
      dragged = { li, jobId: li.dataset.jobId, fromStage: li.dataset.stage };
      li.classList.add(DRAGGING);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', li.dataset.jobId);
      }
    });
    li.addEventListener('dragend', () => {
      li.classList.remove(DRAGGING);
      dragged = null;
      clearHighlights(doc);
    });
  }

  // Dragging over the collapsed Closed panel opens it, so a card can be
  // dropped straight onto Rejected / Ghosted.
  doc.getElementById('closed')?.addEventListener('dragenter', function open() {
    this.open = true;
  });

  for (const target of targets) {
    target.addEventListener('dragover', (e) => {
      if (!dragged || dragged.fromStage === target.dataset.dropStage) return;
      e.preventDefault(); // this is what allows the drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      target.classList.add(...HIGHLIGHT);
    });
    target.addEventListener('dragleave', (e) => {
      if (!target.contains(e.relatedTarget)) target.classList.remove(...HIGHLIGHT);
    });
    target.addEventListener('drop', (e) => {
      e.preventDefault();
      clearHighlights(doc);
      if (!dragged) return;
      const { li, jobId, fromStage } = dragged;
      const plan = planMove(jobId, fromStage, target.dataset.dropStage);
      if (!plan) return;
      // Optimistic: the card lands in the column right away; the reload
      // (or the revert on failure) restores the server's truth.
      const origin = { parent: li.parentElement, next: li.nextElementSibling };
      (target.querySelector('ul') ?? target).appendChild(li);
      li.classList.remove(DRAGGING);
      submitMove(plan).then((ok) => {
        if (ok) {
          doc.defaultView.location.reload();
        } else {
          origin.parent.insertBefore(li, origin.next);
          showMoveError(doc);
        }
      });
    });
  }
  return cards.length;
}
