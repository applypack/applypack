/*
 * The redesign's yardstick (docs/ui-redesign-plan.md §4.2). Not part of the
 * build: paste the expression below into the browser tool's JavaScript call
 * on a dashboard page at 1440×900 and record the object it returns in
 * docs/ui-redesign/metrics.md. Every stage measures the same pages with the
 * same expression, so a before and an after are comparable.
 *
 * Visibility is `checkVisibility()`, never `offsetParent`: Chrome hides the
 * body of a closed <details> with content-visibility, and `offsetParent`
 * stays non-null for what is inside it. The first analysis counted 98
 * "visible" controls above the Jobs table that way; 68 of them sat inside
 * the closed "More…" and the real number was 30.
 *
 * What the fields mean:
 *   tabStops    visible, enabled, focusable controls inside <main>
 *   inDom       the same selector with nothing filtered out
 *   aboveTable  tab stops that come before the page's first <table> (null = no table)
 *   hintWords   words of visible helper prose (the Hint primitive and its kin)
 *   mainWords   every visible word inside <main> — moves with the data, read it with that in mind
 *   boxes       visible elements with a border on all four sides
 *   primaries   visible solid-emerald buttons (the rule is one per region)
 *   heightPx    scroll height of <main>
 *   htmlKB / requests / jsKB / externalHosts   what the page cost to load
 */
(() => {
  const main = document.querySelector('main');
  const vis = (el) =>
    el.checkVisibility
      ? el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })
      : el.offsetParent !== null;
  const words = (s) => (s.trim().match(/\S+/g) || []).length;
  const all = [...main.querySelectorAll('a[href], button, select, textarea, summary, input:not([type=hidden])')];
  const stops = all.filter((el) => vis(el) && !el.disabled && el.tabIndex !== -1);
  const table = main.querySelector('table');
  // `data-ui="hint"` is what stage 0 puts on the primitives; the class
  // selectors are how the same prose is found on a build from before it.
  const hintEls = [
    ...main.querySelectorAll('[data-ui="hint"], p.text-ink-faint, header div.text-ink-faint, label span.text-ink-faint'),
  ].filter(vis);
  const hints = hintEls.filter((el) => !hintEls.some((o) => o !== el && o.contains(el)));
  const boxed = (el) => {
    const s = getComputedStyle(el);
    return ['Top', 'Right', 'Bottom', 'Left'].every((k) => parseFloat(s[`border${k}Width`]) > 0);
  };
  const res = performance.getEntriesByType('resource');
  const js = res.filter((r) => /\.m?js(\?|$)/.test(r.name));
  return JSON.stringify({
    path: location.pathname + location.search,
    tabStops: stops.length,
    inDom: all.length,
    aboveTable: table
      ? stops.filter((el) => el.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).length
      : null,
    hintWords: hints.reduce((n, el) => n + words(el.innerText), 0),
    mainWords: words(main.innerText),
    boxes: [...main.querySelectorAll('*')].filter((el) => vis(el) && boxed(el)).length,
    primaries: [...main.querySelectorAll('.bg-accent-strong')].filter(vis).length,
    heightPx: main.scrollHeight,
    htmlKB: +(new Blob([document.documentElement.outerHTML]).size / 1024).toFixed(1),
    requests: res.length + 1,
    jsKB: +(js.reduce((n, r) => n + (r.decodedBodySize || 0), 0) / 1024).toFixed(1),
    externalHosts: [...new Set(res.map((r) => new URL(r.name).host))].filter((h) => h !== location.host),
  });
})();
