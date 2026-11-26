// Minimal Chrome DevTools Protocol driver — no dependencies (Node 22 global WebSocket).
// Usage:
//   import { launch } from './cdp.mjs';
//   const b = await launch({ port: 9333, width: 1916, height: 933 });
//   await b.goto('http://localhost:5173');
//   await b.eval('document.title');                 // returns value (awaits promises)
//   await b.setFiles('input[type=file]', ['/abs/a.mp3']);
//   await b.click('button.play');                  // CSS selector, real mouse events at element center
//   await b.mouse('mouseMoved', x, y);             // raw mouse
//   await b.screenshot('/abs/out.png');
//   b.logs  -> array of console/exception strings
//   await b.close();
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, width = 1916, height = 933, dpr = 2, headless = true, mobile = false } = {}) {
  const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'cdp-'));
  const proc = spawn(CHROME, [
    headless ? '--headless=new' : '', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, `--force-device-scale-factor=${dpr}`,
    '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', 'about:blank',
  ].filter(Boolean), { stdio: 'ignore' });
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    if (!wsUrl) await sleep(100);
  }
  if (!wsUrl) throw new Error('Chrome did not start');
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const logs = []; const listeners = new Set();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.j(new Error(m.error.message)) : p.r(m.result); return; }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    listeners.forEach((f) => f(m));
  };
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: !!mobile });
  if (mobile) {
    await send('Network.enable');
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }).catch(() => {});
  }

  const api = {
    send, logs, sleep,
    async goto(url) {
      const loaded = new Promise((r) => { const f = (m) => { if (m.method === 'Page.loadEventFired') { listeners.delete(f); r(); } }; listeners.add(f); });
      await send('Page.navigate', { url }); await loaded; await sleep(300);
    },
    async eval(expr) {
      const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
      return res.result.value;
    },
    async setFiles(selector, files) {
      const { root } = await send('DOM.getDocument', { depth: -1, pierce: true });
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error('no element ' + selector);
      await send('DOM.setFileInputFiles', { nodeId, files });
    },
    async center(selector) {
      const r = await api.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'center'}); const b = e.getBoundingClientRect(); return [b.x + b.width/2, b.y + b.height/2]; })()`);
      if (!r) throw new Error('no element ' + selector);
      return r;
    },
    async mouse(type, x, y, extra = {}) { await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra }); },
    async click(selector) {
      const [x, y] = await api.center(selector);
      await api.mouse('mouseMoved', x, y); await api.mouse('mousePressed', x, y); await api.mouse('mouseReleased', x, y);
      await sleep(80);
    },
    /** Resize the emulated viewport (e.g. portrait -> landscape). Reload afterwards if layout is JS-driven. */
    async setViewport(w, h, d = dpr) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: d, mobile: !!mobile, screenOrientation: { type: w > h ? 'landscapePrimary' : 'portraitPrimary', angle: w > h ? 90 : 0 } });
      await sleep(250);
    },
    /** Raw touch (requires mobile: true). type: touchStart | touchMove | touchEnd | touchCancel */
    async touch(type, x, y) { await send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] }); },
    async tap(selector) {
      const [x, y] = await api.center(selector);
      await api.touch('touchStart', x, y); await sleep(40); await api.touch('touchEnd', x, y); await sleep(120);
    },
    async touchDrag(x0, y0, x1, y1, steps = 12) {
      await api.touch('touchStart', x0, y0);
      for (let i = 1; i <= steps; i++) { await api.touch('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await sleep(16); }
      await api.touch('touchEnd', x1, y1); await sleep(120);
    },
    async key(key, code = key) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
    },
    async screenshot(path) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(data, 'base64'));
      return path;
    },
    async close() { try { ws.close(); } catch {} proc.kill(); },
  };
  return api;
}
