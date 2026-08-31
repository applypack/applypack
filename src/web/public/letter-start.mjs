/*
 * Enhancements for the /letter launcher. Dependency-free ES module served
 * as-is; the page boots init(). Two behaviors, both progressive — without JS
 * the form still submits correctly:
 *   - touching any field inside a mode box selects that mode's radio;
 *   - the job search box filters the option list in place.
 * filterOptions is pure and unit-tested from src/web/letter-start.test.ts;
 * importing this module touches no DOM.
 */

/** Case-insensitive AND over whitespace-separated terms. */
export function matchesQuery(text, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = text.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/** Returns the options that survive the query; keeps a selection visible. */
export function filterOptions(options, query) {
  return options.filter((o) => matchesQuery(o.text, query));
}

function wireModeBoxes() {
  document.querySelectorAll('[data-mode]').forEach((box) => {
    const radio = box.querySelector('input[type=radio]');
    if (!radio || radio.disabled) return;
    const select = () => {
      if (!radio.checked) radio.checked = true;
    };
    // focusin covers keyboard and mouse; pointerdown catches a click on a
    // control that swallows focus (file inputs, native select popups).
    box.addEventListener('focusin', (e) => {
      if (e.target !== radio) select();
    });
    box.addEventListener('pointerdown', (e) => {
      if (e.target !== radio) select();
    });
  });
}

function wireJobSearch() {
  const search = document.getElementById('job-search');
  const select = document.getElementById('job-select');
  if (!search || !select) return;
  const all = [...select.options].map((o) => ({ value: o.value, text: o.textContent ?? '' }));
  const count = document.getElementById('job-count');

  search.addEventListener('input', () => {
    const kept = filterOptions(all, search.value);
    const previous = select.value;
    select.textContent = '';
    for (const o of kept) {
      const option = document.createElement('option');
      option.value = o.value;
      option.textContent = o.text;
      select.append(option);
    }
    // Keep the previous pick when it survived; otherwise take the top hit so
    // the form always submits something the user can see.
    if (kept.some((o) => o.value === previous)) select.value = previous;
    else if (kept.length > 0) select.selectedIndex = 0;
    if (count) count.textContent = String(kept.length);
  });

  // Enter in the search box should not submit the whole form by accident.
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      select.focus();
    }
  });
}

export function init() {
  wireModeBoxes();
  wireJobSearch();
}
