import type { TrackMeta } from '../types';

/** One playlist row, as text only (no audio is downloaded). */
export interface PlaylistEntry {
  title: string;
  artist: string;
}

export interface PlaylistMatch {
  entry: PlaylistEntry;
  /** Best local track, or null if nothing reached the threshold (missing). */
  track: TrackMeta | null;
  /** Similarity of the best candidate (0..1), even when below threshold. */
  score: number;
}

export const MATCH_THRESHOLD = 0.6;

/** Splits "Artist - Title" (ASCII or en/em dash) at the first separator. */
function parseLine(line: string): PlaylistEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { title: trimmed, artist: '' };
}

/**
 * Parses a CSV with RFC 4180 quoting (quoted fields may contain commas, newlines and "" escapes).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function parseExportifyCsv(rows: string[][]): PlaylistEntry[] | null {
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const titleIdx = header.indexOf('track name');
  let artistIdx = header.indexOf('artist name(s)');
  if (artistIdx < 0) artistIdx = header.indexOf('artist name');
  if (titleIdx < 0) return null;

  const entries: PlaylistEntry[] = [];
  for (const r of rows.slice(1)) {
    const title = (r[titleIdx] ?? '').trim();
    if (!title) continue;
    // Exportify separates multiple artists with ";". Matching uses the primary artist.
    const rawArtist = artistIdx >= 0 ? (r[artistIdx] ?? '') : '';
    const artist = rawArtist.split(';')[0].trim();
    entries.push({ title, artist });
  }
  return entries;
}

/**
 * Parses either an Exportify-style CSV (needs "Track Name" and "Artist Name(s)" columns)
 * or pasted text with one "Artist - Title" per line.
 */
export function parsePlaylistText(text: string): PlaylistEntry[] {
  const trimmed = text.replace(/^﻿/, '');
  const rows = parseCsv(trimmed);
  if (rows.length > 0 && rows[0].some((h) => h.trim().toLowerCase() === 'track name')) {
    const fromCsv = parseExportifyCsv(rows);
    if (fromCsv) return fromCsv;
  }
  return trimmed
    .split(/\r?\n/)
    .map(parseLine)
    .filter((e): e is PlaylistEntry => e !== null);
}

/** Lowercase, strip accents, drop feat./remaster suffixes and punctuation, collapse spaces. */
export function normalize(s: string): string {
  let out = s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  // "(feat. X)" / "[ft X]" groups.
  out = out.replace(/[([]\s*(feat|ft|featuring)\b[^)\]]*[)\]]/g, ' ');
  // Bare trailing "feat. X" / "ft. X".
  out = out.replace(/\s(feat|ft|featuring)\.?\s.*$/, ' ');
  // " - Remastered 2011", " - 2009 Remaster", " - Mono", etc.
  out = out.replace(/\s[-–—]\s*(\d{4}\s+)?(remaster(ed)?|mono|stereo|radio edit|single version|album version)\b.*$/, ' ');
  out = out.replace(/[^\p{L}\p{N}]+/gu, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

function tokenize(s: string): Set<string> {
  const n = normalize(s);
  return new Set(n ? n.split(' ') : []);
}

/** Overlap coefficient: |A ∩ B| / min(|A|, |B|). Forgiving when one side has extra words. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / Math.min(a.size, b.size);
}

interface Indexed {
  track: TrackMeta;
  title: Set<string>;
  artist: Set<string>;
}

/**
 * Similarity of a playlist entry to a track, 0..1.
 * Title overlap is the base score. When the entry has an artist, the score is scaled by artist
 * overlap, so an exact title by a different artist falls below the threshold.
 */
function similarity(entry: { title: Set<string>; artist: Set<string> }, track: Indexed): number {
  const titleScore = overlap(entry.title, track.title);
  if (titleScore === 0) return 0;
  if (entry.artist.size === 0) return titleScore;
  const artistScore = overlap(entry.artist, track.artist);
  return titleScore * (0.5 + 0.5 * artistScore);
}

/**
 * For each playlist entry, finds the best-scoring local track. Entries whose best score is below
 * MATCH_THRESHOLD get track: null (missing).
 */
export function matchPlaylist(entries: PlaylistEntry[], tracks: TrackMeta[]): PlaylistMatch[] {
  const indexed: Indexed[] = tracks.map((track) => ({
    track,
    title: tokenize(track.title),
    artist: tokenize(track.artist),
  }));

  return entries.map((entry) => {
    const eTitle = tokenize(entry.title);
    const eArtist = tokenize(entry.artist);
    let best: Indexed | null = null;
    let bestScore = 0;
    for (const cand of indexed) {
      const score = similarity({ title: eTitle, artist: eArtist }, cand);
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    const matched = best !== null && bestScore >= MATCH_THRESHOLD;
    return {
      entry,
      track: matched && best ? best.track : null,
      score: bestScore,
    };
  });
}
