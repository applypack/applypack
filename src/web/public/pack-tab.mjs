/*
 * The Application pack tab while a pack is queued or being prepared (#378).
 * The page used to reload itself every 8 seconds, and the rail beside the
 * card holds forms: whatever was typed into Notes was gone with the next
 * reload, for as long as the company check ran. This asks a small state
 * route instead, rewrites the one line that changes, and loads the page
 * again only when the pack has finished — never over an unsaved edit.
 * The decisions are pure and tested from src/web/pack-tab.test.ts.
 */

/** How often the state is asked for: the reload's own pace. */
const POLL_MS = 8000;

/** Whether one form field holds something the page did not load with. */
export function fieldChanged(field) {
  if (field.type === 'hidden' || field.type === 'submit' || field.type === 'button' || field.disabled) return false;
  if (field.type === 'checkbox' || field.type === 'radio') return field.checked !== field.defaultChecked;
  if (field.options) return [...field.options].some((option) => option.selected !== option.defaultSelected);
  return field.value !== field.defaultValue;
}

/** Whether a reload now would throw away the person's work: an edit not yet saved, or a field they are in. */
export function unsavedWork(fields, active) {
  return fields.some((field) => field === active || fieldChanged(field));
}

/**
 * What to do with one answer of the state route. A pack still in the queue
 * or in flight: say its line. A pack that finished (or whose row is gone):
 * load the page again to show it, unless that would cost an edit — then say
 * so and leave the page alone.
 */
export function nextMove(state, unsaved) {
  if (state.busy) return { text: state.line, reload: false, again: true };
  return unsaved ? { text: state.wait, reload: false, again: false } : { text: null, reload: true, again: false };
}

/** Wires the tab: `line` is the element that carries the pack's progress sentence. */
export function init({ url, line }) {
  const fields = () => [...document.querySelectorAll('input, textarea, select')];
  const tick = async () => {
    let state;
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      // The row is gone (the pack was cancelled): the page that shows it is stale.
      state = res.status === 404 ? { busy: false, wait: line.textContent } : await res.json();
    } catch {
      // The dashboard is restarting or the network blinked: ask again.
      setTimeout(tick, POLL_MS);
      return;
    }
    const move = nextMove(state, unsavedWork(fields(), document.activeElement));
    if (move.reload) {
      location.reload();
      return;
    }
    if (move.text && line.textContent !== move.text) line.textContent = move.text;
    if (move.again) setTimeout(tick, POLL_MS);
  };
  setTimeout(tick, POLL_MS);
}
