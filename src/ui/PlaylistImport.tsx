import { useMemo, useState } from 'react';
import type { DeckId } from '../types';
import { useLib } from './context';
import { loadTrack } from './core';
import { matchPlaylist, parsePlaylistText } from '../library';

export function PlaylistImport({ onClose }: { onClose: () => void }) {
  const lib = useLib();
  const [text, setText] = useState('');
  const [run, setRun] = useState('');
  const results = useMemo(() => (run ? matchPlaylist(parsePlaylistText(run), lib.tracks) : []), [run, lib.tracks]);
  const found = results.filter((r) => r.track).length;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const t = await f.text();
    setText(t); setRun(t);
  };

  return (
    <div className="modal-bg" onClick={onClose}><div className="modal playlist-import" onClick={(e) => e.stopPropagation()}>
      <button className="btn small modal-x" onClick={onClose}>Close</button>
      <div className="pi-left">
        <textarea placeholder={'Paste a track list, one per line:\nArtist - Title\nor CSV with title,artist columns'} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="pi-actions">
          <button className="btn" onClick={() => setRun(text)} disabled={!text.trim()}>Match against library</button>
          <label className="btn">Upload CSV<input type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0])} /></label>
        </div>
      </div>
      <div className="pi-right">
        {results.length > 0 && <div className="pi-sum">{found} of {results.length} found in library</div>}
        <div className="pi-list">
          {results.map((r, i) => (
            <div key={i} className={`pi-row ${r.track ? 'ok' : 'miss'}`}>
              <span className="pi-want">{r.entry.artist ? `${r.entry.artist} - ` : ''}{r.entry.title}</span>
              {r.track ? (
                <>
                  <span className="pi-got">{r.track.artist} - {r.track.title}</span>
                  {(['A', 'B'] as DeckId[]).map((d) => <button key={d} className="btn small" onClick={() => loadTrack(lib, r.track!.id, d)}>{d}</button>)}
                </>
              ) : <span className="pi-got missing">not in library</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
  );
}
