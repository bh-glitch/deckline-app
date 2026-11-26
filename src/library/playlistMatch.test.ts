import { describe, expect, it } from 'vitest';
import type { TrackMeta } from '../types';
import { MATCH_THRESHOLD, matchPlaylist, normalize, parseCsv, parsePlaylistText } from './playlistMatch';

function track(over: Partial<TrackMeta> & { id: string; title: string; artist: string }): TrackMeta {
  return { duration: 200, fileName: `${over.id}.mp3`, addedAt: 0, ...over };
}

describe('parseCsv', () => {
  it('handles quoted fields with commas, escaped quotes and embedded newlines', () => {
    const rows = parseCsv('a,"b, c","say ""hi""",\n"multi\nline",x,y\n');
    expect(rows).toEqual([
      ['a', 'b, c', 'say "hi"', ''],
      ['multi\nline', 'x', 'y'],
    ]);
  });

  it('drops blank lines', () => {
    expect(parseCsv('a,b\n\n\nc,d\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('parsePlaylistText', () => {
  it('parses "Artist - Title" lines, skipping blanks', () => {
    const entries = parsePlaylistText('Daft Punk - One More Time\n\n  M83 – Midnight City  \nJust A Title');
    expect(entries).toEqual([
      { artist: 'Daft Punk', title: 'One More Time' },
      { artist: 'M83', title: 'Midnight City' },
      { artist: '', title: 'Just A Title' },
    ]);
  });

  it('parses an Exportify CSV with quoted artist lists and primary artist only', () => {
    const csv = [
      'Track URI,Track Name,Artist Name(s),Album Name',
      'spotify:track:1,"Hello, World","Artist One;Artist Two",Album',
      'spotify:track:2,Plain Song,Solo Artist,Album 2',
    ].join('\n');
    expect(parsePlaylistText(csv)).toEqual([
      { title: 'Hello, World', artist: 'Artist One' },
      { title: 'Plain Song', artist: 'Solo Artist' },
    ]);
  });
});

describe('normalize', () => {
  it('lowercases, strips accents and punctuation', () => {
    expect(normalize('Café, Déjà-Vu!')).toBe('cafe deja vu');
  });

  it('removes feat. groups and remaster suffixes', () => {
    expect(normalize('Song (feat. Someone)')).toBe('song');
    expect(normalize('Song [ft X]')).toBe('song');
    expect(normalize('Song - Remastered 2011')).toBe('song');
    expect(normalize('Song - 2009 Remaster')).toBe('song');
    expect(normalize('Song feat. Bob')).toBe('song');
  });

  it('keeps titles that merely contain "with"', () => {
    expect(normalize('Help (With a Little Help)')).toBe('help with a little help');
  });
});

describe('matchPlaylist', () => {
  const library: TrackMeta[] = [
    track({ id: 'a', title: 'Midnight City', artist: 'M83' }),
    track({ id: 'b', title: 'One More Time (Remastered)', artist: 'Daft Punk' }),
    track({ id: 'c', title: 'Get Lucky (feat. Pharrell Williams)', artist: 'Daft Punk' }),
    track({ id: 'd', title: 'Café del Mar', artist: 'Energy 52' }),
    track({ id: 'e', title: 'Strobe', artist: 'deadmau5' }),
  ];

  it('matches entries despite accents, feat. credits and remaster suffixes', () => {
    const results = matchPlaylist(
      [
        { title: 'Midnight City', artist: 'M83' },
        { title: 'One More Time', artist: 'Daft Punk' },
        { title: 'Get Lucky', artist: 'Daft Punk' },
        { title: 'Cafe Del Mar', artist: 'Energy 52' },
      ],
      library,
    );
    expect(results.map((r) => r.track?.id)).toEqual(['a', 'b', 'c', 'd']);
    for (const r of results) expect(r.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it('returns null for missing tracks', () => {
    const [r] = matchPlaylist([{ title: 'Nonexistent Song', artist: 'Nobody' }], library);
    expect(r.track).toBeNull();
    expect(r.score).toBeLessThan(MATCH_THRESHOLD);
  });

  it('does not match an identical title by a clearly different artist', () => {
    const [r] = matchPlaylist([{ title: 'Strobe', artist: 'Someone Else Entirely' }], library);
    expect(r.track).toBeNull();
  });

  it('matches title-only entries when the artist is unknown', () => {
    const [r] = matchPlaylist([{ title: 'Strobe', artist: '' }], library);
    expect(r.track?.id).toBe('e');
  });

  it('returns one result per entry, in order, even with no library', () => {
    const results = matchPlaylist([{ title: 'A', artist: 'B' }, { title: 'C', artist: '' }], []);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.track === null)).toBe(true);
  });
});
