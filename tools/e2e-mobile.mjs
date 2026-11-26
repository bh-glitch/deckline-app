// Mobile e2e: SONGS_DIR=/path/to/songs node tools/e2e-mobile.mjs   (dev server must be on :5173)
import { launch } from './cdp.mjs';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const OUT = process.env.OUT_DIR || fileURLToPath(new URL('../.e2e-shots/', import.meta.url)); mkdirSync(OUT, { recursive: true });
const D = (process.env.SONGS_DIR || '').replace(/\/?$/, '/'); if (D === '/') { console.error('Set SONGS_DIR'); process.exit(1); }
const F = [D + 'abhi-toh-party-shuru-hui-hai-full-video-song-khoobsurat-badshah-sonam-kapoor-aastha-128-ytshorts.savetube.me.mp3', D + 'Saturday Saturday Humpty Sharma Ki Dulhania Varun Dhawan, Alia Bhatt Badshah, Akriti Kakkar 4K.mp3', D + 'I know I should sleep but the voices in my head go.mp3'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', n, x); };

async function run(name, w, h, dpr, port) {
  console.log(`\n=== ${name} ${w}x${h} @${dpr}x ===`);
  const b = await launch({ port, width: w, height: h, dpr, mobile: true });
  const ev = (e) => b.eval(e);
  const st = (d) => ev(`JSON.stringify(window.__deckline.mixer.decks.${d}.getState())`).then(JSON.parse);
  const ms = () => ev(`JSON.stringify(window.__deckline.mixer.getState())`).then(JSON.parse);
  const shot = async (n) => { const p = `${OUT}m_${name}_${n}.png`; await b.screenshot(p); execSync(`sips -Z 900 "${p}" --out "${OUT}m_${name}_${n}_s.png" >/dev/null`); };
  const tab = async (label) => { await ev(`[...document.querySelectorAll('.m-tab')].find(e=>e.textContent.trim()==='${label}').click()`); await sleep(350); };
  const overflow = async (where) => ok(`${name} no h-overflow @${where}`, await ev('document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth'), await ev('document.documentElement.scrollWidth + "/" + innerWidth'));
  // pane-level overflow: any visible element wider than viewport
  const wide = () => ev(`[...document.querySelectorAll('.m-pane.on *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left<-1)&&!e.closest('canvas')}).slice(0,3).map(e=>e.className+':'+Math.round(e.getBoundingClientRect().right)).join(',')`);
  try {
    await b.goto('http://localhost:5173'); await sleep(900);
    ok(`${name} mobile shell`, await ev(`!!document.querySelector('.m-app')`));
    await b.setFiles('.m-lib input[type=file]', F); await sleep(2500);
    await tab('Library'); await shot('library');
    await overflow('library');
    ok(`${name} library rows`, (await ev(`document.querySelectorAll('.m-lrow').length`)) === 3);
    const load = (row, d) => ev(`(()=>{const r=[...document.querySelectorAll('.m-lrow')].find(r=>/${row}/i.test(r.innerText));[...r.querySelectorAll('.m-load')].find(b=>b.textContent==='${d}').click()})()`);
    await load('party', 'A'); await load('saturday', 'B'); await sleep(6000);
    let a = await st('A'), bb = await st('B');
    ok(`${name} A,B loaded`, a.loaded && bb.loaded, `${a.bpm} ${bb.bpm}`);
    await tab('Decks'); await sleep(300);
    await b.tap('.m-deck:nth-child(1) .play'); await sleep(1500);
    const p1 = await ev(`window.__deckline.mixer.decks.A.getPosition()`); await sleep(800);
    const p2 = await ev(`window.__deckline.mixer.decks.A.getPosition()`);
    ok(`${name} A plays via tap`, p2 > p1 + 0.4, `${p1}->${p2}`);
    ok(`${name} audio ctx running`, (await ev(`window.__deckline.mixer.ctx?.state ?? 'running'`)) !== 'suspended');
    await shot('decks'); await overflow('decks');
    const wd = await wide(); ok(`${name} decks nothing wider than viewport`, !wd, wd);
    // tempo slider drag
    const t0 = (await st('A')).rate;
    const r = await ev(`(()=>{const e=document.querySelector('.m-deck .m-tfader');const b=e.getBoundingClientRect();return [b.x,b.y+b.height/2,b.width]})()`);
    await b.touchDrag(r[0] + r[2] / 2, r[1], r[0] + r[2] * 0.85, r[1]);
    ok(`${name} tempo slider touch`, (await st('A')).rate > t0 + 0.01, `${t0}->${(await st('A')).rate}`);
    await b.tap('.m-deck .m-tempo .pct'); ok(`${name} tempo reset`, Math.abs((await st('A')).rate - 1) < 1e-6);
    await b.tap('.m-deck .m-hot'); await sleep(100); ok(`${name} hot cue set`, (await st('A')).hotCues[0] != null);
    await b.tap('.m-deck .m-trans .m-btn:nth-child(3)'); await sleep(100);
    await tab('Mixer'); await sleep(300);
    await shot('mixer'); await overflow('mixer');
    const wm = await wide(); ok(`${name} mixer nothing wider than viewport`, !wm, wm);
    // knob drag (filter on A) via touch
    const k = await ev(`(()=>{const e=document.querySelector('.m-chan .knob svg');const b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`);
    await b.touchDrag(k[0], k[1], k[0], k[1] - 70);
    ok(`${name} knob touch drag`, (await st('A')).filter > 0.2, (await st('A')).filter);
    await b.tap('.m-chan .m-chead .m-btn'); ok(`${name} reset`, (await st('A')).filter === 0);
    await b.tap('.m-chan .m-eq:nth-child(2) .m-kill'); ok(`${name} kill`, (await st('A')).eq.high <= -0.99);
    await b.tap('.m-chan .m-eq:nth-child(2) .m-kill');
    const x = await ev(`(()=>{const e=document.querySelector('.m-p-mixer .m-xfader');e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return [b.x,b.y+b.height/2,b.width]})()`);
    await b.touchDrag(x[0] + x[2] / 2, x[1], x[0] + x[2] * 0.85, x[1]);
    ok(`${name} crossfader touch`, (await ms()).crossfader > 0.3, (await ms()).crossfader);
    await ev(`window.__deckline.mixer.setCrossfader(0)`);
    // MIX
    await ev(`document.querySelector('.m-mixer .tx-go .mix-btn, .m-mixer .mix-btn').scrollIntoView({block:'center'})`); await sleep(200);
    await shot('mixer2');
    await b.tap('.m-mixer .mix-btn'); await sleep(1500);
    ok(`${name} transition running`, !!(await ms()).transition?.active);
    await shot('mixing');
    await ev(`window.__deckline.mixer.cancelTransition()`);
    await tab('Sampler'); await shot('sampler'); await overflow('sampler');
    await b.tap('.m-p-sampler .spad'); ok(`${name} sampler tap`, true);
    await tab('Decks'); await shot('decks2');
    const errs = b.logs.filter((l) => /exception|\[error\]/i.test(l) && !/favicon|Failed to load resource/.test(l));
    ok(`${name} no console errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) { ok(`${name} script`, false, e.stack); }
  await b.close();
}
await run('p390', 390, 844, 3, 9390);
await run('p360', 360, 780, 3, 9391);
await run('l844', 844, 390, 3, 9392);
// desktop regression screenshot
const d = await launch({ port: 9393, width: 1916, height: 933, dpr: 1 });
await d.goto('http://localhost:5173'); await sleep(900);
ok('desktop shell unchanged', await d.eval(`!!document.querySelector('.main-row') && !document.querySelector('.m-app')`));
await d.screenshot(OUT + 'm_desktop.png'); execSync(`sips -Z 1400 "${OUT}m_desktop.png" --out "${OUT}m_desktop_s.png" >/dev/null`);
await d.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
