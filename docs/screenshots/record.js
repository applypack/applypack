#!/usr/bin/env node
// Drives headless Chrome over the DevTools protocol against the scratch ApplyPack:
//   node record.js shots <outdir>   → 1440×900 fold screenshots (jobs-list.png, tailor-resume.png)
//   node record.js gif <outdir>     → screencast frames + list.txt for ffmpeg (1200×760)
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:4949';
const JOB = process.env.JOB || '14';
const MATCH = process.env.MATCH || '1';
const mode = process.argv[2];
const OUT = path.resolve(process.argv[3] || 'out');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      if (!msg.id) { for (const fn of listeners.get(msg.method) || []) fn(msg.params); return; }
      const call = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) call.rej(new Error(`${call.method}: ${msg.error.message}`)); else call.res(msg.result);
    };
  });
}

async function startChrome(profileDir) {
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--hide-scrollbars', '--force-device-scale-factor=1', '--font-render-hinting=none', 'about:blank',
  ], { stdio: 'ignore' });
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return { chrome, wsUrl: page.webSocketDebuggerUrl };
    } catch { /* not yet */ }
  }
  chrome.kill('SIGKILL');
  throw new Error('Chrome did not open its DevTools port');
}

// Injected on every document: a drawn cursor, a caption pill, a click ripple.
const INJECT = `(() => {
  const init = () => {
    if (document.getElementById('__cur')) return;
    const cur = document.createElement('div'); cur.id = '__cur';
    cur.innerHTML = '<svg width="24" height="32" viewBox="0 0 24 32"><path d="M3 2 L3 25 L9 19.5 L13.5 30 L18 28 L13.6 18 L21.5 18 Z" fill="#111827" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    Object.assign(cur.style, { position: 'fixed', left: '0px', top: '0px', zIndex: 2147483647, pointerEvents: 'none', marginLeft: '-3px', marginTop: '-2px',
      transition: 'left .5s cubic-bezier(.25,.7,.25,1), top .5s cubic-bezier(.25,.7,.25,1)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.45))' });
    const saved = sessionStorage.getItem('__cur');
    if (saved) { const [x, y] = JSON.parse(saved); cur.style.left = x + 'px'; cur.style.top = y + 'px'; } else { cur.style.left = '640px'; cur.style.top = '420px'; }
    document.documentElement.appendChild(cur);
    const cap = document.createElement('div'); cap.id = '__cap';
    Object.assign(cap.style, { position: 'fixed', left: '50%', bottom: '20px', transform: 'translateX(-50%)', zIndex: 2147483646, pointerEvents: 'none',
      background: 'rgba(17,24,39,.94)', color: '#fff', font: '600 17px/1.35 Inter, system-ui, sans-serif', padding: '11px 18px', borderRadius: '12px',
      maxWidth: '84%', whiteSpace: 'nowrap', boxShadow: '0 8px 24px rgba(0,0,0,.28)', opacity: '0', transition: 'opacity .25s', letterSpacing: '.01em' });
    const savedCap = sessionStorage.getItem('__cap');
    void savedCap;
    document.documentElement.appendChild(cap);
    window.__demo = {
      cursor(x, y) { cur.style.left = x + 'px'; cur.style.top = y + 'px'; sessionStorage.setItem('__cur', JSON.stringify([x, y])); },
      caption(t) { sessionStorage.setItem('__cap', t || ''); },
      ripple(x, y) {
        const r = document.createElement('div');
        Object.assign(r.style, { position: 'fixed', left: (x - 14) + 'px', top: (y - 14) + 'px', width: '28px', height: '28px', borderRadius: '50%',
          border: '2px solid #059669', background: 'rgba(5,150,105,.18)', zIndex: 2147483645, pointerEvents: 'none', transition: 'transform .35s ease-out, opacity .35s ease-out' });
        document.documentElement.appendChild(r);
        requestAnimationFrame(() => { r.style.transform = 'scale(1.9)'; r.style.opacity = '0'; });
        setTimeout(() => r.remove(), 450);
      },
      rect(sel, text, nth) {
        const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
        let els = [...document.querySelectorAll(sel)].filter(vis);
        if (text) els = els.filter((el) => el.textContent.trim().replace(/\\s+/g, ' ').startsWith(text));
        const el = els[nth || 0];
        if (!el) return null;
        const b0 = el.getBoundingClientRect();
        if (b0.top < 40 || b0.bottom > window.innerHeight - 40) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: b.width, h: b.height };
      },
    };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();`;

async function main() {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-rec-'));
  const { chrome, wsUrl } = await startChrome(profileDir);
  const cdp = await connect(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
  const evalJs = async (expression) => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  const loaded = () => new Promise((res) => { const off = cdp.on('Page.loadEventFired', () => { off(); res(); }); });
  const goto = async (url) => { const p = loaded(); await cdp.send('Page.navigate', { url: BASE + url }); await p; await sleep(450); };

  try {
    if (mode === 'shots') {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      const shots = [['jobs-list', '/jobs?sort=fitScore_desc'], ['tailor-resume', `/jobs/${JOB}/target?match=${MATCH}`]];
      for (const [name, url] of shots) {
        await goto(url);
        await evalJs(`document.getElementById('__cur').remove(); document.getElementById('__cap').remove(); 'ok'`);
        await sleep(350);
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } });
        fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
        console.log('shot', name);
      }
      return;
    }

    // ---- gif: screencast ----
    const W = 1440, H = 900;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    const frames = [];
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const i = frames.length;
      const file = path.join(OUT, `f${String(i).padStart(4, '0')}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      frames.push({ file, ts: metadata.timestamp });
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });

    const captions = [];
    const caption = async (t) => { captions.push({ at: Date.now() / 1000, text: t }); };
    const cursorTo = async (x, y, ms = 560) => { await evalJs(`__demo.cursor(${x}, ${y}); 'ok'`); await sleep(ms); };
    const find = async (sel, text, nth) => {
      const r = await evalJs(`JSON.stringify(__demo.rect(${JSON.stringify(sel)}, ${JSON.stringify(text || '')}, ${nth || 0}))`);
      const rect = JSON.parse(r);
      if (!rect) throw new Error(`not found: ${sel} ${text || ''}`);
      await sleep(250);
      return rect;
    };
    const click = async ({ x, y }) => {
      await evalJs(`__demo.ripple(${x}, ${y}); 'ok'`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await sleep(70);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };
    const clickAndLoad = async (rect) => { const p = loaded(); await click(rect); await p; await sleep(450); };

    const typeText = async (text, ms = 85) => {
      for (const ch of text) {
        await evalJs(`(() => { const ed = document.getElementById('editor'); ed.focus(); ed.value += ${JSON.stringify(ch)}; ed.setSelectionRange(ed.value.length, ed.value.length); ed.scrollTop = ed.scrollHeight; ed.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
        await sleep(ms);
      }
      console.log('editor ends with:', await evalJs(`document.getElementById('editor').value.slice(-40)`));
    };

    await goto('/jobs?sort=fitScore_desc');
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: W, maxHeight: H });
    await sleep(300);

    // 1 — the list
    await caption('It watches 33 kinds of job board every hour and scores each posting against your search');
    await cursorTo(820, 600, 300);
    await sleep(1500);
    let r = await find(`a[href="/jobs/${JOB}"]`, 'Senior Full-Stack Engineer');
    await cursorTo(r.x - r.w / 2 + 70, r.y);
    await sleep(350);
    await clickAndLoad({ x: r.x - r.w / 2 + 70, y: r.y });

    // 2 — the posting with its verdict
    await caption('The verdict in words: what fits, what it pays, where you can live');
    await cursorTo(700, 640, 400);
    await sleep(1800);
    r = await find('a[href*="tab=match"]');
    await cursorTo(r.x, r.y);
    await sleep(350);
    await clickAndLoad(r);

    // 3 — the comparison
    await caption('Your resume against the posting: every keyword graded, the score computed in code');
    await cursorTo(700, 700, 400);
    await sleep(2000);
    r = await find(`a[href^="/jobs/${JOB}/target"]`, 'Tailor resume');
    await cursorTo(r.x, r.y);
    await sleep(350);
    await clickAndLoad(r);

    // 4 — the editor: one press adds a missing keyword, then typing moves the score too
    await caption('Fix it in place: one press adds a missing keyword and the score moves, no AI call');
    await cursorTo(900, 560, 400);
    await sleep(700);
    await evalJs(`document.getElementById('main').scrollBy({ top: 130, behavior: 'instant' }); 'ok'`);
    await sleep(300);
    r = await find('button', '+ add', 0);
    await cursorTo(r.x, r.y);
    await sleep(400);
    await click(r);
    await sleep(1600);
    await caption('Type a word you can honestly claim: the score moves on the next keystroke');
    const ed = JSON.parse(await evalJs(`(() => {
      const ed = document.getElementById('editor');
      ed.scrollIntoView({ block: 'center', behavior: 'instant' });
      ed.scrollTop = ed.scrollHeight;
      const b = ed.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(b.left + b.width * 0.55), y: Math.round(b.bottom - 34) });
    })()`));
    await sleep(300);
    await cursorTo(ed.x, ed.y);
    await sleep(300);
    await click(ed);
    await evalJs(`(() => { const ed = document.getElementById('editor'); ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); ed.scrollTop = ed.scrollHeight; return 'ok'; })()`);
    await sleep(500);
    await typeText(', Redis');
    await sleep(1100);
    await evalJs(`document.getElementById('main').scrollTo({ top: 0, behavior: 'smooth' }); 'ok'`);
    await sleep(900);
    await cursorTo(900, 520, 300);
    await sleep(1500);

    // 5 — the letter
    await goto(`/jobs/${JOB}?tab=letter`);
    await caption('A cover letter from your resume and your confirmed facts. Nothing invented');
    try {
      const b = await find('span', 'fact-check', 0);
      await evalJs(`document.getElementById('main').scrollBy({ top: ${Math.max(0, b.y - 150)}, behavior: 'instant' }); 'ok'`);
      await sleep(250);
      await cursorTo(b.x + 60, 420, 300);
    } catch { await cursorTo(760, 640, 300); }
    await sleep(2500);
    await caption('');
    await sleep(400);

    await cdp.send('Page.stopScreencast');
    await sleep(300);
    // concat list with real durations
    const lines = [];
    for (let i = 0; i < frames.length; i++) {
      const next = frames[i + 1];
      let d = next ? next.ts - frames[i].ts : 1.0;
      d = Math.min(Math.max(d, 0.02), 3.5);
      lines.push(`file '${frames[i].file}'`, `duration ${d.toFixed(3)}`);
    }
    if (frames.length) lines.push(`file '${frames[frames.length - 1].file}'`);
    fs.writeFileSync(path.join(OUT, 'list.txt'), lines.join('\n') + '\n');
    fs.writeFileSync(path.join(OUT, 'captions.json'), JSON.stringify({ firstFrameTs: frames[0]?.ts, wall: Date.now() / 1000, captions, frames }, null, 1));
    const total = frames.length ? frames[frames.length - 1].ts - frames[0].ts : 0;
    console.log(`frames ${frames.length}, ${total.toFixed(1)} s`);
  } finally {
    cdp.close();
    chrome.kill('SIGKILL');
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
