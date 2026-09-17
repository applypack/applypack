#!/usr/bin/env node
/*
 * Runs the yardstick (measure.js, verbatim) over the dashboard pages and,
 * when asked, saves the screenshots a stage owes (plan §4.2). No dependency:
 * it starts a headless Chrome and talks to it over the DevTools protocol with
 * Node's own WebSocket (Node 22+). It only ever sends GET requests.
 *
 *   node docs/ui-redesign/shoot.js --label stage1-before
 *   node docs/ui-redesign/shoot.js --label stage1-after --out jobs-filter-panel --shots
 *   node docs/ui-redesign/shoot.js --label probe --pages jobs,target,extra=/jobs?q=php --missed
 *
 *   --label   names the run; with --out the rows land in <out>/metrics-<label>.json
 *   --out     a folder under ~/applypack-evidence/ui-redesign/ (EVIDENCE_DIR moves
 *             the root). Outside the repository on purpose: the pages show the
 *             owner's data
 *   --shots   1440 (the fold and the whole page), 768 and 375, each after its own load
 *   --pages   all (default), or slugs from PAGES, or slug=/path for a page not listed
 *   --missed  list the prose the class selectors see and the data-ui hooks do not
 *   --base    the dashboard to read (default http://127.0.0.1:4848 — plan §4.2)
 *
 * <main> is the scroll container, so "the whole page" is taken by growing the
 * viewport to the height <main> needs, not with a full-page capture.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EVIDENCE = process.env.EVIDENCE_DIR || path.join(os.homedir(), 'applypack-evidence/ui-redesign');
const MAX_SHOT_HEIGHT = 12000;
const SETTLE_MS = 350;
const LOAD_TIMEOUT_MS = 30_000;

// The twenty pages of metrics.md, the five wizard steps and one screening.
// /jobs/100, /resumes/1 and /screen/1 are rows of the owner's database.
const PAGES = [
  ['overview', '/'],
  ['jobs', '/jobs'],
  ['jobs-filtered', '/jobs?country=US&workplace=remote&posted=7d'],
  ['job-100', '/jobs/100'],
  ['applications', '/applications'],
  ['resumes', '/resumes'],
  ['resume-1', '/resumes/1'],
  ['target', '/target'],
  ['letter', '/letter'],
  ['companies', '/companies'],
  ['discovery', '/discovery'],
  ['runs', '/runs'],
  ['settings-general', '/settings?tab=general'],
  ['settings-profile', '/settings?tab=profile'],
  ['settings-ai', '/settings?tab=ai'],
  ['settings-notifications', '/settings?tab=notifications'],
  ['settings-sources', '/settings?tab=sources'],
  ['settings-screening', '/settings?tab=screening'],
  ['welcome', '/welcome'],
  ['screen', '/screen'],
  ['welcome-ai', '/welcome?step=ai'],
  ['welcome-search', '/welcome?step=search'],
  ['welcome-profile', '/welcome?step=profile'],
  ['welcome-sources', '/welcome?step=sources'],
  ['welcome-matches', '/welcome?step=matches'],
  ['screen-1', '/screen/1'],
];
const MOBILE_PASS = ['overview', 'jobs', 'job-100', 'target', 'settings-profile'];

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

function pickPages(spec) {
  if (spec === 'all') return PAGES;
  return spec.split(',').map((item) => {
    const eq = item.indexOf('=/');
    if (eq > 0) return [item.slice(0, eq), item.slice(eq + 1)];
    const known = PAGES.find(([slug]) => slug === item);
    if (!known) throw new Error(`unknown page "${item}" — use a slug from PAGES or slug=/path`);
    return known;
  });
}

const MEASURE = fs.readFileSync(path.join(__dirname, 'measure.js'), 'utf8');

// Stage 0's proof, kept as a guard: the hooks must see what the class
// selectors saw, or a restyle can lower hintWords without hiding a word.
const HOOKS = `(() => {
  const main = document.querySelector('main');
  const vis = (el) => el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true });
  const words = (s) => (s.trim().match(/\\S+/g) || []).length;
  const count = (sel) => {
    const els = [...main.querySelectorAll(sel)].filter(vis);
    return els.filter((el) => !els.some((o) => o !== el && o.contains(el))).reduce((n, el) => n + words(el.innerText), 0);
  };
  const CLASS = 'p.text-ink-faint, header div.text-ink-faint, label span.text-ink-faint';
  const hooked = [...main.querySelectorAll('[data-ui="hint"]')];
  return JSON.stringify({
    hintWordsClass: count(CLASS),
    hintWordsHook: count('[data-ui="hint"]'),
    missedByHook: [...main.querySelectorAll(CLASS)]
      .filter((el) => vis(el) && !hooked.some((h) => h === el || h.contains(el) || el.contains(h)))
      .map((el) => el.tagName.toLowerCase() + ': ' + el.innerText.trim().replace(/\\s+/g, ' ').slice(0, 90)),
  });
})()`;

const AT_WIDTH = `(() => {
  const main = document.querySelector('main');
  const vis = (el) => el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true });
  const all = [...main.querySelectorAll('a[href], button, select, textarea, summary, input:not([type=hidden])')];
  return JSON.stringify({
    tabStops: all.filter((el) => vis(el) && !el.disabled && el.tabIndex !== -1).length,
    heightPx: main.scrollHeight,
    hScroll: document.documentElement.scrollWidth > window.innerWidth || main.scrollWidth > main.clientWidth,
  });
})()`;

const HEIGHT_NEEDED = `(() => { const m = document.querySelector('main'); return m.scrollHeight + (window.innerHeight - m.clientHeight); })()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 1;
    const on = (method, fn) => {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(fn);
      return () => listeners.get(method).delete(fn);
    };
    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { res, rej, method });
        ws.send(JSON.stringify({ id, method, params }));
      });
    ws.onopen = () => resolve({ send, on, close: () => ws.close() });
    ws.onerror = () => reject(new Error('DevTools websocket failed'));
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id) {
        for (const fn of listeners.get(msg.method) || []) fn(msg.params);
        return;
      }
      const call = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) call.rej(new Error(`${call.method}: ${msg.error.message}`));
      else call.res(msg.result);
    };
  });
}

async function startChrome(profileDir) {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      // Port 0 = Chrome picks a free one and writes it into the profile, so
      // two runs at once never attach to each other's browser.
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return { chrome, wsUrl: page.webSocketDebuggerUrl };
    } catch {
      // not listening yet
    }
  }
  chrome.kill('SIGKILL');
  throw new Error(`Chrome did not open its DevTools port (${CHROME})`);
}

function printTable(rows, problems, showMissed) {
  const cols = ['slug', 'tabStops', 'inDom', 'aboveTable', 'hintWords', 'mainWords', 'boxes', 'primaries', 'heightPx', 'htmlKB', 'requests', 'jsKB'];
  console.log(cols.join('\t'));
  for (const r of rows) console.log(cols.map((c) => (r[c] === null ? '—' : r[c])).join('\t'));

  console.log('\n375 px (tabStops / heightPx):');
  for (const r of rows.filter((x) => MOBILE_PASS.includes(x.slug))) console.log(`  ${r.slug}\t${r.tabStops375}\t${r.heightPx375}`);

  // More by hook than by class is fine (restyled prose kept its hook); less means prose lost it.
  const unhooked = rows.filter((r) => r.hintWordsHook < r.hintWordsClass).map((r) => `${r.slug} hook ${r.hintWordsHook} / class ${r.hintWordsClass}`);
  console.log(`\nhooks vs classes: ${unhooked.length ? `${unhooked.join('; ')} — run with --missed` : 'the hooks see everything the classes see'}`);
  const scrolls = rows.flatMap((r) => [1440, 768, 375].filter((w) => r[`hScroll${w}`]).map((w) => `${r.slug}@${w}`));
  console.log(`horizontal scroll: ${scrolls.length ? scrolls.join(', ') : 'none'}`);
  const hosts = rows.filter((r) => r.externalHosts.length).map((r) => `${r.slug}: ${r.externalHosts.join(' ')}`);
  console.log(`external hosts: ${hosts.length ? hosts.join('; ') : 'none'}`);
  console.log(`problems: ${problems.length ? `\n  ${problems.join('\n  ')}` : 'none'}`);
  if (showMissed) {
    console.log('\nseen by class, not by hook:');
    for (const r of rows.filter((x) => x.missedByHook.length)) console.log(`  ${r.slug}\n    ${r.missedByHook.join('\n    ')}`);
  }
}

const label = opt('label', 'run');
const base = opt('base', 'http://127.0.0.1:4848');
const outDir = opt('out', null) ? path.join(EVIDENCE, opt('out', null)) : null;
const shots = flag('shots');

async function main() {
  if (shots && !outDir) throw new Error('--shots needs --out <folder>');
  const pages = pickPages(opt('pages', 'all'));

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'applypack-shoot-'));
  const { chrome, wsUrl } = await startChrome(profileDir);
  const stopChrome = async () => {
    const gone = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill('SIGKILL');
    await gone;
    // Chrome's helpers may still be letting go of the profile: retry, and a
    // leftover temp folder is never a reason to fail a finished run.
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {}
  };

  try {
    await run(await connect(wsUrl), pages);
  } finally {
    await stopChrome();
  }
}

async function run(cdp, pages) {
  for (const domain of ['Page', 'Runtime', 'Network', 'Log']) await cdp.send(`${domain}.enable`);

  const problems = [];
  let current = '';
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') problems.push(`${current} console: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
  });
  cdp.on('Runtime.exceptionThrown', (p) =>
    problems.push(`${current} exception: ${(p.exceptionDetails.exception?.description || p.exceptionDetails.text).slice(0, 200)}`),
  );
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error') problems.push(`${current} log: ${p.entry.text.slice(0, 160)} ${p.entry.url || ''}`);
  });

  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${current}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  const viewport = (width, height) => cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const open = async (slug, urlPath, width, height) => {
    current = `${slug}@${width}`;
    await viewport(width, height);
    let status = null;
    const offResponse = cdp.on('Network.responseReceived', (p) => {
      if (p.type === 'Document' && status === null) status = p.response.status;
    });
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${current}: no load event in ${LOAD_TIMEOUT_MS} ms`)), LOAD_TIMEOUT_MS);
      const off = cdp.on('Page.loadEventFired', () => {
        off();
        clearTimeout(timer);
        resolve();
      });
    });
    const { errorText } = await cdp.send('Page.navigate', { url: base + urlPath });
    if (errorText) throw new Error(`${current}: ${errorText} — is the dashboard up on ${base}?`);
    await loaded;
    await sleep(SETTLE_MS);
    offResponse();
    if (status !== 200) problems.push(`${current} answered HTTP ${status}`);
  };
  const shoot = async (file) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  };
  const shootWholePage = async (file, width) => {
    const needed = await evaluate(HEIGHT_NEEDED);
    await viewport(width, Math.min(Math.max(needed, 600), MAX_SHOT_HEIGHT));
    await sleep(150);
    await shoot(file);
  };

  const rows = [];
  for (const [slug, urlPath] of pages) {
    await open(slug, urlPath, 1440, 900);
    const row = { slug, ...JSON.parse(await evaluate(MEASURE)), ...JSON.parse(await evaluate(HOOKS)) };
    if (row.path !== urlPath) problems.push(`${slug}: asked for ${urlPath}, measured ${row.path}`);
    row.hScroll1440 = JSON.parse(await evaluate(AT_WIDTH)).hScroll;
    if (shots) {
      await shoot(path.join(outDir, '1440', `${slug}-fold.png`));
      await shootWholePage(path.join(outDir, '1440', `${slug}.png`), 1440);
    }
    for (const [width, height] of [[768, 1024], [375, 812]]) {
      await open(slug, urlPath, width, height);
      const at = JSON.parse(await evaluate(AT_WIDTH));
      row[`hScroll${width}`] = at.hScroll;
      if (width === 375) {
        row.tabStops375 = at.tabStops;
        row.heightPx375 = at.heightPx;
      }
      if (shots) await shootWholePage(path.join(outDir, String(width), `${slug}.png`), width);
    }
    rows.push(row);
  }
  cdp.close();

  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `metrics-${label}.json`), JSON.stringify({ label, base, takenAt: new Date().toISOString(), rows, problems }, null, 2));
  }
  printTable(rows, problems, flag('missed'));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.message);
    process.exit(1);
  },
);
