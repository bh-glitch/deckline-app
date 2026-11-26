// Orchestrates mix.html in headless Chrome and writes the WAV. Usage: node tools/render-mix.mjs [overridesJSON]
import { launch } from './cdp.mjs';
import { writeFileSync } from 'node:fs';
const D = (process.env.SONGS_DIR || process.argv[2] || '').replace(/\/?$/, '/'); if (D === '/') { console.error('Usage: SONGS_DIR=/path/to/songs node ' + process.argv[1]); process.exit(1); }
const files = [
  D + 'abhi-toh-party-shuru-hui-hai-full-video-song-khoobsurat-badshah-sonam-kapoor-aastha-128-ytshorts.savetube.me.mp3',
  D + 'I know I should sleep but the voices in my head go.mp3',
  D + 'Saturday Saturday Humpty Sharma Ki Dulhania Varun Dhawan, Alia Bhatt Badshah, Akriti Kakkar 4K.mp3',
];
const OUT = D + 'mixed song.wav';
const over = process.argv[2] || '{}';
const b = await launch({ port: 9360, width: 1400, height: 520, dpr: 1 });
try {
  await b.goto('http://localhost:5173/mix.html');
  await b.setFiles('#files', files);
  const info = await b.eval('window.mix.prepare()');
  console.log('prepared', info.map((t) => ({ bpm: t.bpm, firstBeat: t.firstBeat, key: t.key, dur: t.dur })));
  console.log('energy Party', info[0].full.join(' '));
  console.log('energy Sat', info[1].full.join(' '));
  const r = await b.eval(`window.mix.render(${over})`);
  console.log(r.log.join('\n'));
  const n = await b.eval('window.mix.chunks()');
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(Buffer.from(await b.eval(`window.mix.chunk(${i})`), 'base64'));
  writeFileSync(OUT, Buffer.concat(parts));
  console.log('wrote', OUT, Buffer.concat(parts).length);
  await b.sleep(300);
  await b.screenshot((process.env.OUT_DIR || '.') + '/mix-overview.png');
} finally { console.log(b.logs.filter((l) => /error|exception/i.test(l)).join('\n')); await b.close(); }
