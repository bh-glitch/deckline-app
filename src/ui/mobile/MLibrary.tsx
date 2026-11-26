import { useEffect, useMemo, useRef, useState } from 'react';
import type { DeckId, MixerEngine } from '../../types';
import { filterTracks, sortTracks, type SortField } from '../../library';
import { useLib } from '../context';
import { loadTrack } from '../core';
import { DECK_COLOR, cleanName, fmtTime } from '../format';

const ROW_H = 60;
const AUDIO_EXT = /\.(mp3|wav|flac|ogg|oga|m4a|aac|aif|aiff|opus|webm|mp4)$/i;
const SORTS: [SortField, 'asc' | 'desc', string][] = [['addedAt', 'desc', 'Newest'], ['title', 'asc', 'Title'], ['artist', 'asc', 'Artist'], ['bpm', 'asc', 'BPM'], ['key', 'asc', 'Key']];

export function MLibrary({ loaded }: { mixer: MixerEngine; loaded: Record<DeckId, string | null> }) {
  const lib = useLib();
  const [query, setQuery] = useState('');
  const [sortIdx, setSortIdx] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  const body = useRef<HTMLDivElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [sk, sd] = SORTS[sortIdx];
  const rows = useMemo(() => sortTracks(filterTracks(lib.tracks, query), sk, sd), [lib.tracks, query, sk, sd]);
  const doImport = (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files).filter((f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name));
    if (list.length) lib.importFiles(list);
  };
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 3);
  const end = Math.min(rows.length, start + Math.ceil(viewH / ROW_H) + 7);
  return (
    <div className="m-lib">
      <div className="m-libbar">
        <input className="m-search" type="search" placeholder="Search title, artist, BPM, key" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="m-btn" onClick={() => fileIn.current?.click()}>＋ Import</button>
        <input ref={fileIn} type="file" multiple accept="audio/*" hidden onChange={(e) => { doImport(e.target.files); e.target.value = ''; }} />
      </div>
      <div className="m-libsub">
        <span className="muted">{lib.loading ? 'Loading…' : `${rows.length} tracks`}</span>
        <button className="m-chipbtn" onClick={() => setSortIdx((i) => (i + 1) % SORTS.length)}>Sort: {SORTS[sortIdx][2]} ⇅</button>
      </div>
      <div className="m-libbody" ref={body} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {rows.length === 0 && <div className="empty">{lib.tracks.length ? 'No matches.' : 'Tap Import to add songs from your device.'}</div>}
        <div style={{ height: start * ROW_H }} />
        {rows.slice(start, end).map((t) => (
          <div key={t.id} className="m-lrow" style={{ height: ROW_H }}>
            <span className="art-sm m-art" style={t.artwork ? { backgroundImage: `url(${t.artwork})` } : undefined}>{!t.artwork && '♪'}</span>
            <span className="m-ltxt">
              <span className="m-lt">{cleanName(t.title)}</span>
              <span className="m-la">{cleanName(t.artist) || 'Unknown artist'}</span>
            </span>
            <span className="m-lmeta"><b>{t.bpm ? t.bpm.toFixed(1) : '--'}</b><span>{t.key ?? '--'} · {fmtTime(t.duration)}</span></span>
            {(['A', 'B'] as DeckId[]).map((d) => (
              <button key={d} className={`m-load ${loaded[d] === t.id ? 'on' : ''}`} style={{ ['--dc' as string]: DECK_COLOR[d] }} onClick={() => loadTrack(lib, t.id, d)} aria-label={`Load on deck ${d}`}>{d}</button>
            ))}
          </div>
        ))}
        <div style={{ height: Math.max(0, rows.length - end) * ROW_H }} />
      </div>
    </div>
  );
}
