import { launch } from './cdp.mjs';
import { execSync } from 'node:child_process';
const OUT = process.env.OUT_DIR || new URL('../.e2e-shots/', import.meta.url).pathname; (await import('node:fs')).mkdirSync(OUT, { recursive: true });
const D = (process.env.SONGS_DIR || process.argv[2] || '').replace(/\/?$/, '/'); if (D === '/') { console.error('Usage: SONGS_DIR=/path/to/songs node ' + process.argv[1]); process.exit(1); }
const F = [D + 'abhi-toh-party-shuru-hui-hai-full-video-song-khoobsurat-badshah-sonam-kapoor-aastha-128-ytshorts.savetube.me.mp3', D + 'Saturday Saturday Humpty Sharma Ki Dulhania Varun Dhawan, Alia Bhatt Badshah, Akriti Kakkar 4K.mp3', D + 'I know I should sleep but the voices in my head go.mp3'];
const only = process.argv[2];
const b = await launch({ port: 9350 });
const sleep = b.sleep;
const res = [];
const ok = (n, c, x = '') => { res.push([n, !!c]); console.log(c ? 'PASS' : 'FAIL', n, x); };
const shot = async (n, w = 1400) => { const p = OUT + n + '.png'; await b.screenshot(p); execSync(`sips -Z ${w} "${p}" --out "${OUT}${n}_s.png" >/dev/null`); };
const ev = (e) => b.eval(e);
const st = (d) => ev(`JSON.stringify(window.__deckline.mixer.decks.${d}.getState())`).then(JSON.parse);
const ms = () => ev(`JSON.stringify(window.__deckline.mixer.getState())`).then(JSON.parse);
const pos = (d) => ev(`window.__deckline.mixer.decks.${d}.getPosition()`);
const rms = () => ev(`(()=>{const a=window.__deckline.mixer.masterAnalyser;const x=new Float32Array(a.fftSize);a.getFloatTimeDomainData(x);let s=0;for(const v of x)s+=v*v;return Math.sqrt(s/x.length)})()`);
const clickText = (sel, txt) => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>e.textContent.trim()===${JSON.stringify(txt)});if(!e)return false;e.click();return true})()`);
try {
  await b.goto('http://localhost:5173');
  await sleep(800);
  await b.setFiles('.library input[type=file]', F);
  await sleep(2500);
  await shot('01_import');
  const rows = await ev(`[...document.querySelectorAll('.lib-body .lib-row')].map(r=>r.innerText.replace(/\\n+/g,' | '))`);
  console.log(rows);
  ok('3 rows', rows.length === 3);
  // load via buttons
  const loadBtn = (row, d) => ev(`(()=>{const r=[...document.querySelectorAll('.lib-body .lib-row')].find(r=>/${row}/i.test(r.innerText));[...r.querySelectorAll('.loadbtn')].find(b=>b.textContent==='${d}').click()})()`);
  await loadBtn('party', 'A'); await loadBtn('saturday', 'B');
  await sleep(6000);
  let a = await st('A'), bb = await st('B');
  ok('A,B loaded', a.loaded && bb.loaded, `${a.bpm} ${bb.bpm}`);
  await shot('02_loaded');
  // play A
  await b.click('.deck-panel .play'); await sleep(1500);
  const p1 = await pos('A'); await sleep(1000); const p2 = await pos('A');
  ok('A advances', p2 > p1 + 0.5, `${p1}->${p2}`);
  ok('master signal', (await rms()) > 0.005, await rms());
  // EQ kill
  const kills = await ev(`document.querySelectorAll('.chan .kill').length`);
  await ev(`[...document.querySelectorAll('.chan')][0].querySelectorAll('.kill')[2].click()`); await sleep(200);
  ok('low kill A', (await st('A')).eq.low <= -0.99);
  await ev(`[...document.querySelectorAll('.chan .reset')][0].click()`); await sleep(200);
  ok('reset', (await st('A')).eq.low === 0);
  // filter knob drag
  const [kx, ky] = await b.center('.chan .knob');
  await b.mouse('mouseMoved', kx, ky); await b.mouse('mousePressed', kx, ky);
  for (let i = 1; i <= 10; i++) await b.mouse('mouseMoved', kx, ky - i * 6, { buttons: 1 });
  await b.mouse('mouseReleased', kx, ky - 60); await sleep(200);
  ok('filter drag', (await st('A')).filter > 0.1, (await st('A')).filter);
  // channel fader
  const [fx, fy] = await b.center('.chan-fader');
  await b.mouse('mouseMoved', fx, fy); await b.mouse('mousePressed', fx, fy);
  await b.mouse('mouseMoved', fx, fy + 30, { buttons: 1 }); await b.mouse('mouseReleased', fx, fy + 30); await sleep(200);
  ok('chan fader', (await st('A')).gain < 0.95, (await st('A')).gain);
  const [cx, cy] = await b.center('.xfader');
  await b.mouse('mouseMoved', cx, cy); await b.mouse('mousePressed', cx, cy);
  await b.mouse('mouseMoved', cx + 40, cy, { buttons: 1 }); await b.mouse('mouseReleased', cx + 40, cy); await sleep(200);
  ok('crossfader', Math.abs((await ms()).crossfader) > 0.1, (await ms()).crossfader);
  await ev(`window.__deckline.mixer.decks.A.setGain(1);window.__deckline.mixer.decks.A.setFilter(0);window.__deckline.mixer.setCrossfader(0)`);
  // beatmatch
  await sleep(2000);
  await b.click('.deck-panel:nth-of-type(2) .play, .main-row > .deck-panel:last-child .play'); await sleep(2500);
  a = await st('A'); bb = await st('B');
  console.log('A', a.bpm, a.rate, 'B', bb.bpm, bb.rate, bb.synced);
  ok('B synced', bb.synced && Math.abs(a.bpm * a.rate - bb.bpm * bb.rate) < 0.3);
  await shot('03_playing');
  // transition
  await clickText('.tx .btn', '8');
  await ev(`document.querySelector('.mix-btn').click()`); await sleep(1500);
  ok('tx bar', await ev(`!!document.querySelector('.tx-bar')`));
  await shot('04_mixing', 1000);
  await sleep(9000);
  const m = await ms(); a = await st('A');
  console.log('xf', m.crossfader, 'A playing', a.playing, m.transition);
  ok('tx done', m.crossfader > 0.95 && !a.playing);
  // other styles: load A back, play and mix to A
  for (const sname of ['Echo Out', 'Cut', 'Bass Swap']) {
    await ev(`(()=>{const mx=window.__deckline.mixer; mx.decks.A.seek(20); })()`);
    await clickText('.tx .btn', sname); await clickText('.tx .btn', '4');
    await ev(`document.querySelector('.mix-btn').click()`); await sleep(5500);
    const mm = await ms(); const aa = await st('A'), b2 = await st('B');
    console.log(sname, 'xf', mm.crossfader, 'A', aa.playing, 'B', b2.playing);
    ok('tx ' + sname, mm.crossfader < -0.9 && aa.playing && !b2.playing);
    // swap back
    await ev(`(()=>{const mx=window.__deckline.mixer;mx.decks.B.seek(30);mx.decks.B.pause&&0})()`);
    await ev(`window.__deckline.mixer.decks.B.play()`); await sleep(500);
    await ev(`window.__deckline.mixer.setCrossfader(-1)`);
    await ev(`document.querySelector('.mix-btn') && 0`);
    // now mix back to B
    await clickText('.tx .btn', sname);
    await ev(`document.querySelector('.mix-btn').click()`); await sleep(5500);
  }
  console.log('pre05', (await st('A')).loaded, (await st('B')).loaded, await ev('location.href'));
  await shot('05_after_tx', 1000);
  // brake
  console.log('prebrake', (await st('A')).loaded);
  await ev(`window.__deckline.mixer.decks.A.play()`); await sleep(500);
  await clickText('.deck-panel .btn', 'BRAKE'); await sleep(2500);
  ok('brake', !(await st('A')).playing);
  // tempo
  console.log('A after brake', JSON.stringify(await st('A')));
  const bpm0 = (await st('A')).rate;
  await ev(`document.querySelectorAll('.tempo-btns .btn')[1].click()`); await sleep(100);
  ok('tempo +', (await st('A')).rate > bpm0);
  // loop + hotcue
  await ev(`window.__deckline.mixer.decks.A.play()`); await sleep(300);
  await ev(`document.querySelector('.dp-loop .btn').click()`); await sleep(200);
  console.log('A loop', JSON.stringify(await st('A')));
  ok('loop', (await st('A')).loop?.active);
  await ev(`document.querySelector('.hot').click()`); await sleep(100);
  ok('hotcue', (await st('A')).hotCues[0] != null);
  await shot('06_loop', 1400);
  // sampler
  await clickText('.tab', 'Sampler'); await sleep(200);
  await ev(`window.__deckline.mixer.decks.A.pause&&window.__deckline.mixer.decks.A.pause(); window.__deckline.mixer.decks.B.pause&&window.__deckline.mixer.decks.B.pause()`);
  await ev(`window.__deckline.mixer.decks.A.getState().playing&&window.__deckline.mixer.decks.A.togglePlay();window.__deckline.mixer.decks.B.getState().playing&&window.__deckline.mixer.decks.B.togglePlay()`);
  await sleep(600);
  const r0 = await rms();
  const [sx, sy] = await b.center('.spad'); await b.mouse('mouseMoved', sx, sy); await b.mouse('mousePressed', sx, sy); await b.mouse('mouseReleased', sx, sy);
  let mx = 0; for (let i = 0; i < 8; i++) { await sleep(60); mx = Math.max(mx, await rms()); }
  ok('sampler level', mx > 0.01 && mx > r0, `${r0} ${mx}`);
  await shot('07_sampler', 1000);
  await clickText('.tab', 'FX'); await sleep(200);
  await ev(`document.querySelector('.fx-slot .btn').click()`); await sleep(150);
  ok('fx toggle', (await ms()).fx[0].enabled);
  await shot('08_fx', 1000);
  await clickText('.tab', 'Library');
  // drag/drop
  await ev(`(()=>{const r=document.querySelectorAll('.lib-body .lib-row')[0];const dt=new DataTransfer();const panels=document.querySelectorAll('.deck-panel');const t=panels[0];
    const f=(el,type)=>el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}));f(r,'dragstart');f(t,'dragover');f(t,'drop');})()`);
  await sleep(1500);
  ok('dragdrop loads', (await st('A')).loaded);
  // meme clip to end
  await ev(`(()=>{const r=[...document.querySelectorAll('.lib-body .lib-row')].find(r=>/voices/i.test(r.innerText));[...r.querySelectorAll('.loadbtn')].find(b=>b.textContent==='A').click()})()`);
  await sleep(2500);
  await ev(`window.__deckline.mixer.decks.A.play()`); await sleep(6500);
  a = await st('A'); console.log('meme', a.playing, await pos('A'), a.duration);
  ok('meme ends clean', !a.playing);
  // load on playing deck
  await ev(`window.__deckline.mixer.decks.B.play()`); await sleep(500);
  await ev(`(()=>{const r=[...document.querySelectorAll('.lib-body .lib-row')].find(r=>/party/i.test(r.innerText));[...r.querySelectorAll('.loadbtn')].find(b=>b.textContent==='B').click()})()`);
  await sleep(4000);
  ok('load on playing', (await st('B')).loaded);
  // 1440
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await sleep(500); await shot('09_1440', 1400);
  const ov = await ev(`({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,sh:document.documentElement.scrollHeight,ch:document.documentElement.clientHeight})`);
  console.log(ov); ok('1440 no scroll', ov.sw <= ov.cw && ov.sh <= ov.ch);
} catch (e) { console.log('ERR', e.stack); }
console.log('LOGS', b.logs.filter((l) => !/^\[(log|info|debug)\]/.test(l)));
await b.close(); process.exit(0);
