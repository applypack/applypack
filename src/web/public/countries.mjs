/*
 * Country picker for the profile editor (ADR 0032). Pure search over the
 * gazetteer the server publishes at /countries.json, plus a small DOM layer
 * that hangs a suggestion list under the chip input SETTINGS_JS already
 * built. Dependency-free ES module; the search is unit-tested from
 * src/web/countries-picker.test.ts through import().
 *
 * Chips carry "🇵🇱 Poland": the flag is what the server resolves, the name is
 * for the reader. Without JS the textarea takes any spelling the gazetteer
 * knows, one per line.
 */

/** How many suggestions show at once. */
export const SUGGESTION_LIMIT = 8;

/** Ranks: exact code, then a name that starts with the query, then a city or demonym, then any substring. */
const RANK = { code: 0, namePrefix: 1, cityPrefix: 2, contains: 3 };

export function normalize(s) {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[-–—_ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Countries matching a query, best first, at most `limit`. Each result is
 * `{ country, via }` where `via` is the spelling that matched, so the list
 * can say "Kraków → Poland".
 */
export function searchCountries(query, countries, limit = SUGGESTION_LIMIT) {
  const q = normalize(query);
  if (q.length === 0) return [];
  const hits = [];
  for (const country of countries) {
    const best = bestMatch(q, country);
    if (best) hits.push({ country, via: best.via, rank: best.rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.country.name.localeCompare(b.country.name));
  return hits.slice(0, limit).map(({ country, via }) => ({ country, via }));
}

function bestMatch(q, country) {
  if (q === country.code.toLowerCase()) return { via: country.code, rank: RANK.code };
  let best = null;
  const consider = (spelling, prefixRank) => {
    const n = normalize(spelling);
    let rank = null;
    if (n.startsWith(q)) rank = prefixRank;
    else if (q.length >= 3 && n.includes(q)) rank = RANK.contains;
    if (rank !== null && (best === null || rank < best.rank)) best = { via: spelling, rank };
  };
  consider(country.name, RANK.namePrefix);
  for (const n of country.names) consider(n, RANK.namePrefix);
  for (const c of country.cities) consider(c, RANK.cityPrefix);
  for (const d of country.demonyms) consider(d, RANK.cityPrefix);
  return best;
}

/** The chip text for a country: flag + display name. */
export function chipText(country) {
  return `${country.flag} ${country.name}`;
}

/** Wire every `[data-picker="countries"]` chip editor on the page. */
export async function mountCountryPickers(doc = document) {
  const hosts = [...doc.querySelectorAll('[data-picker="countries"]')];
  if (hosts.length === 0) return;
  let gazetteer;
  try {
    const res = await fetch('/countries.json');
    gazetteer = await res.json();
  } catch {
    return; // the textarea path still works
  }
  for (const host of hosts) mountPicker(host, gazetteer.countries, doc);
}

function mountPicker(host, countries, doc) {
  const input = host.querySelector('input[type="text"]');
  if (!input) return;
  const list = doc.createElement('ul');
  list.setAttribute('role', 'listbox');
  list.id = `${input.id || 'countries'}-suggestions-${Math.random().toString(36).slice(2, 7)}`;
  list.className =
    'absolute z-20 mt-1 max-h-64 w-72 overflow-auto rounded-md border border-line-strong bg-surface-raised p-1 shadow-md';
  list.hidden = true;
  host.style.position = 'relative';
  host.appendChild(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);

  let results = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    results = [];
    active = -1;
  };

  const pick = (hit) => {
    input.value = chipText(hit.country);
    close();
    // SETTINGS_JS commits the chip on Enter; hand it one.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };

  const render = () => {
    list.replaceChildren();
    results.forEach((hit, i) => {
      const li = doc.createElement('li');
      li.id = `${list.id}-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.className = `flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] ${
        i === active ? 'bg-accent/10 text-accent-strong' : 'text-ink hover:bg-surface-overlay'
      }`;
      const via = normalize(hit.via) === normalize(hit.country.name) ? '' : hit.via;
      li.textContent = `${hit.country.flag} ${hit.country.name}${via ? ` · ${via}` : ''}`;
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(hit);
      });
      list.appendChild(li);
    });
    list.hidden = results.length === 0;
    input.setAttribute('aria-expanded', String(results.length > 0));
    if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  input.addEventListener('input', () => {
    results = searchCountries(input.value, countries);
    active = results.length > 0 ? 0 : -1;
    render();
  });
  // Capture phase, so this runs before SETTINGS_JS's bubbling handler: a
  // chosen suggestion replaces the typed text first, then that handler
  // commits the chip on the same Enter.
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = (active + 1) % results.length;
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active - 1 + results.length) % results.length;
      render();
    } else if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter' && active >= 0) {
      input.value = chipText(results[active].country);
      close();
    }
  }, { capture: true });
  input.addEventListener('blur', close);
}
