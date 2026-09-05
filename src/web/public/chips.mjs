/*
 * The chip editor over a newline-joined textarea — the transport the routes
 * already parse, so without JS the plain textarea still works. Mounted by the
 * profile editor on /settings and by the wizard's "Where do you work?"; the
 * country picker (countries.mjs) adds gazetteer suggestions on top of it.
 */
function enhance(host) {
  var ta = host.querySelector('textarea');
  if (!ta) return;
  var box = document.createElement('div');
  box.className = 'flex min-h-[38px] w-full cursor-text flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface-raised px-2 py-1.5 shadow-sm transition-colors duration-150 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15';
  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'min-w-[8rem] flex-1 border-0 bg-transparent p-0.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-0';
  input.placeholder = host.dataset.placeholder || 'Add and press Enter…';
  input.setAttribute('aria-label', (host.dataset.label || 'Tags') + ' — add item');

  function items() {
    return ta.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function sync(list) {
    ta.value = list.join('\n');
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    renderChips(list);
  }
  function renderChips(list) {
    box.querySelectorAll('[data-chip]').forEach(function (c) { c.remove(); });
    list.forEach(function (value, i) {
      var chip = document.createElement('span');
      chip.setAttribute('data-chip', '');
      chip.className = 'inline-flex items-center gap-1 rounded-md bg-surface-overlay px-2 py-0.5 text-[13px] text-ink ring-1 ring-inset ring-line';
      var text = document.createElement('span');
      text.textContent = value;
      var del = document.createElement('button');
      del.type = 'button';
      del.setAttribute('aria-label', 'Remove ' + value);
      del.className = 'grid h-4 w-4 cursor-pointer place-items-center rounded text-ink-faint hover:bg-line hover:text-ink';
      del.textContent = '\u00d7';
      del.addEventListener('click', function () {
        var list = items(); list.splice(i, 1); sync(list); input.focus();
      });
      chip.appendChild(text);
      chip.appendChild(del);
      box.insertBefore(chip, input);
    });
  }
  function commit() {
    var v = input.value.trim();
    if (!v) return;
    var list = items();
    if (list.indexOf(v) === -1) list.push(v);
    input.value = '';
    sync(list);
  }
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && input.value === '') {
      var list = items();
      if (list.length) { list.pop(); sync(list); }
    }
  });
  input.addEventListener('blur', commit);
  input.addEventListener('paste', function (e) {
    var data = (e.clipboardData || window.clipboardData).getData('text');
    if (data && data.indexOf('\n') !== -1) {
      e.preventDefault();
      var list = items();
      data.split('\n').forEach(function (s) {
        var v = s.trim();
        if (v && list.indexOf(v) === -1) list.push(v);
      });
      sync(list);
    }
  });
  box.addEventListener('mousedown', function (e) {
    if (e.target === box) { e.preventDefault(); input.focus(); }
  });
  box.appendChild(input);
  ta.hidden = true;
  ta.setAttribute('aria-hidden', 'true');
  ta.tabIndex = -1;
  host.appendChild(box);
  renderChips(items());
}

/** Upgrade every `[data-chips]` host under `doc` that has not been upgraded yet. */
export function mountChipEditors(doc = document) {
  doc.querySelectorAll('[data-chips]').forEach((host) => {
    if (!host.querySelector('input[type="text"]')) enhance(host);
  });
}
