import type { TrackMeta } from '../types';

export type SortField = 'title' | 'artist' | 'bpm' | 'key' | 'duration' | 'addedAt';
export type SortDir = 'asc' | 'desc';

function haystack(t: TrackMeta): string {
  return [t.title, t.artist, t.album, t.genre, t.key]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join('\u0000')
    .toLowerCase();
}

/**
 * Case-insensitive multi-word AND search across title, artist, album, genre and key.
 * Every whitespace-separated term must appear somewhere in the track. Empty query returns all tracks.
 */
export function filterTracks(tracks: TrackMeta[], query: string): TrackMeta[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return tracks;
  return tracks.filter((t) => {
    const text = haystack(t);
    return terms.every((term) => text.includes(term));
  });
}

/** Camelot key -> sortable number: 1A..12A, 1B..12B. Unparseable keys return undefined. */
function camelotRank(key: string): number | undefined {
  const m = key.trim().toUpperCase().match(/^(\d{1,2})([AB])$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (n < 1 || n > 12) return undefined;
  return n * 2 + (m[2] === 'B' ? 1 : 0);
}

/**
 * Returns a new sorted array. Tracks missing the sort value (undefined bpm/key) always go last,
 * regardless of direction.
 */
export function sortTracks(tracks: TrackMeta[], field: SortField, dir: SortDir): TrackMeta[] {
  const sign = dir === 'asc' ? 1 : -1;

  const compareValues = (a: TrackMeta, b: TrackMeta): number | undefined => {
    switch (field) {
      case 'title':
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }) * sign;
      case 'artist':
        return a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base', numeric: true }) * sign;
      case 'addedAt':
        return (a.addedAt - b.addedAt) * sign;
      case 'duration':
        return (a.duration - b.duration) * sign;
      case 'bpm': {
        if (a.bpm === undefined || b.bpm === undefined) return undefined;
        return (a.bpm - b.bpm) * sign;
      }
      case 'key': {
        if (!a.key || !b.key) return undefined;
        const ra = camelotRank(a.key);
        const rb = camelotRank(b.key);
        if (ra !== undefined && rb !== undefined) return (ra - rb) * sign;
        return a.key.localeCompare(b.key, undefined, { sensitivity: 'base', numeric: true }) * sign;
      }
    }
  };

  const hasValue = (t: TrackMeta): boolean => {
    switch (field) {
      case 'bpm':
        return t.bpm !== undefined;
      case 'key':
        return !!t.key;
      default:
        return true;
    }
  };

  return [...tracks].sort((a, b) => {
    const aHas = hasValue(a);
    const bHas = hasValue(b);
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (!aHas) return 0;
    return compareValues(a, b) ?? 0;
  });
}
