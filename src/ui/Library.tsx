import { useEffect, useMemo, useRef, useState } from 'react';
import type { DeckId, MixerEngine } from '../types';
import { filterTracks, sortTracks, type SortField } from '../library';
import { useLib } from './context';
import { loadTrack, pickFreeDeck } from './core';
import { DECK_COLOR, TRACK_MIME, cleanName, fmtTime } from './format';
import { PlaylistImport } from './PlaylistImport';

const ROW_H = 44;
const AUDIO_EXT = /\.(mp3|wav|flac|ogg|oga|m4a|aac|aif|aiff|opus|webm|mp4)$/i;

export function Library({ mixer, loaded }: { mixer: MixerEngine; loaded: Record<DeckId, string | null> }) {
  const lib = useLib();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortField; dir: 'asc' | 'desc' }>({ key: 'addedAt', dir: 'desc' });
  const [dragging, setDragging] = useState(false);
  const [modal, setModal] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(300);
  const body = useRef<HTMLDivElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const dirIn = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { dirIn.current?.setAttribute('webkitdirectory', ''); }, []);

  const rows = useMemo(() => sortTracks(filterTracks(lib.tracks, query), sort.key, sort.dir), [lib.tracks, query, sort]);

  const doImport = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files).filter((f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name));
    if (list.length) lib.importFiles(list);
  };
  const hdr = (key: SortField, label: string) => (
    <span className={`th ${sort.key === key ? 'sorted' : ''}`} onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))}>
      {label}{sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </span>
  );

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 4);
  const end = Math.min(rows.length, start + Math.ceil(viewH / ROW_H) + 8);

  return (
    <div
      className={`library ${dragging ? 'dragover' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); doImport(e.dataTransfer.files); } setDragging(false); }}
    >
      <div className="lib-bar">
        <input className="search" type="search" placeholder="🔍  Search songs by title, artist, BPM or key   ( press / )" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn small" onClick={() => fileIn.current?.click()}>Import</button>
        <button className="btn small" onClick={() => dirIn.current?.click()}>Import folder</button>
        <button className="btn small" onClick={() => setModal(true)}>Playlist import</button>
        <input ref={fileIn} type="file" multiple accept="audio/*" hidden onChange={(e) => { doImport(e.target.files); e.target.value = ''; }} />
        <input ref={dirIn} type="file" multiple hidden onChange={(e) => { doImport(e.target.files); e.target.value = ''; }} />
        <span className="muted lib-count">{lib.loading ? 'Loading…' : `${rows.length} tracks`}</span>
      </div>
      <div className="lib-row head">
        <span />{hdr('title', 'Title')}{hdr('artist', 'Artist')}{hdr('bpm', 'BPM')}{hdr('key', 'Key')}{hdr('duration', 'Time')}<span />
      </div>
      <div className="lib-body" ref={body} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {rows.length === 0 && <div className="empty">{lib.tracks.length ? 'No matches.' : 'Drop audio files here or click Import to build your library.'}</div>}
        <div style={{ height: start * ROW_H }} />
        {rows.slice(start, end).map((t) => (
          <div
            key={t.id} className="lib-row" draggable={true} style={{ height: ROW_H }}
            onDragStart={(e) => { e.dataTransfer.setData(TRACK_MIME, t.id); e.dataTransfer.effectAllowed = 'copy'; }}
            onDoubleClick={() => loadTrack(lib, t.id, pickFreeDeck(mixer))}
          >
            <span className="art-sm" style={t.artwork ? { backgroundImage: `url(${t.artwork})` } : undefined}>{!t.artwork && '♪'}</span>
            <span className="cell title">
              {(['A', 'B'] as DeckId[]).filter((d) => loaded[d] === t.id).map((d) => <span key={d} className="chip sm" style={{ background: DECK_COLOR[d] }}>{d}</span>)}
              {cleanName(t.title)}
            </span>
            <span className="cell">{cleanName(t.artist)}</span>
            <span className="cell num">{t.bpm ? t.bpm.toFixed(1) : '--'}</span>
            <span className="cell key">{t.key ?? '--'}</span>
            <span className="cell num">{fmtTime(t.duration)}</span>
            <span className="cell load">
              {(['A', 'B'] as DeckId[]).map((d) => (
                <button key={d} className="loadbtn" style={{ borderColor: DECK_COLOR[d], color: DECK_COLOR[d] }} onClick={() => loadTrack(lib, t.id, d)} title={`Load on deck ${d}`}>{d}</button>
              ))}
            </span>
          </div>
        ))}
        <div style={{ height: Math.max(0, rows.length - end) * ROW_H }} />
      </div>
      {dragging && <div className="drop-overlay">Drop audio files to import</div>}
      {modal && <PlaylistImport onClose={() => setModal(false)} />}
    </div>
  );
}
