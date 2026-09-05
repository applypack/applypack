/*
 * A <select> that saves itself must not save every option a keyboard user
 * passes through: in Chrome on Windows and in Firefox, ArrowDown on a closed
 * select fires `change` per option, so arrowing from "must" to "nice" wrote
 * three levels and three flashes (#90). Dependency-free ES module served
 * as-is; a page calls wireSelectCommits(root) once and every
 * `select[data-commit]` commits through it.
 *
 * The rule: a pick made with the pointer commits at once — one change, one
 * intent. A value reached by keyboard commits when the select loses focus or
 * on Enter, the moment the user says "this one". decide() is pure —
 * unit-tested from src/web/select-commit.test.ts.
 */

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

/** Fresh per-select state: whether a nav key started this interaction, whether a change is waiting. */
export function createState() {
  return { keyboard: false, dirty: false };
}

/**
 * Feed one event; returns true when the current value should be committed
 * now. `kind` is 'keydown' (with `key`), 'change', 'blur' or 'pointerdown'.
 */
export function decide(state, kind, key) {
  switch (kind) {
    case 'pointerdown':
      // A pointer pick after some arrowing is still a deliberate pick.
      state.keyboard = false;
      return false;
    case 'keydown':
      if (NAV_KEYS.has(key)) {
        state.keyboard = true;
        return false;
      }
      return key === 'Enter' && state.dirty ? commit(state) : false;
    case 'change':
      if (!state.keyboard) return commit(state);
      state.dirty = true;
      return false;
    case 'blur':
      return state.dirty ? commit(state) : false;
    default:
      return false;
  }
}

function commit(state) {
  state.keyboard = false;
  state.dirty = false;
  return true;
}

/** One select: `onCommit` runs when decide() says so. */
export function wireSelectCommit(select, onCommit) {
  const state = createState();
  const feed = (kind) => (e) => {
    if (decide(state, kind, e.key)) onCommit();
  };
  select.addEventListener('pointerdown', feed('pointerdown'));
  select.addEventListener('keydown', feed('keydown'));
  select.addEventListener('change', feed('change'));
  select.addEventListener('blur', feed('blur'));
}

/**
 * Every `select[data-commit="submit"]` under `root` submits its own form —
 * through requestSubmit, so the form's own onsubmit still runs.
 */
export function wireSelectCommits(root) {
  for (const select of root.querySelectorAll('select[data-commit="submit"]')) {
    wireSelectCommit(select, () => select.form?.requestSubmit());
  }
}
