import { describe, expect, it } from 'vitest';
import type { TrackMeta } from '../types';
import { filterTracks, sortTracks } from './search';

function track(over: Partial<TrackMeta> & { id: string }): TrackMeta {
  return {
    title: 'Untitled',
    artist: 'Unknown',
    duration: 180,
    fileName: `${over.id}.mp3`,
    addedAt: 0,
    ...over,
  };
}

const tracks: TrackMeta[] = [
  track({ id: '1', title: 'Midnight City', artist: 'M83', album: 'Hurry Up, We Are Dreaming', genre: 'Synth Pop', bpm: 105, key: '8A', duration: 243, addedAt: 300 }),
  track({ id: '2', title: 'Café Del Mar', artist: 'Energy 52', genre: 'Trance', bpm: 130, key: '11B', duration: 400, addedAt: 100 }),
  track({ id: '3', title: 'Around the World', artist: 'Daft Punk', album: 'Homework', genre: 'House', duration: 428, addedAt: 200 }),
  track({ id: '4', title: 'Strobe', artist: 'deadmau5', bpm: 128, key: '10A', duration: 636, addedAt: 400 }),
  track({ id: '5', title: 'Ten', artist: 'Pearl Jam', bpm: 90, key: '2B', duration: 120, addedAt: 500 }),
];

const ids = (list: TrackMeta[]) => list.map((t) => t.id);

describe('filterTracks', () => {
  it('returns all tracks for an empty or whitespace query', () => {
    expect(filterTracks(tracks, '')).toHaveLength(tracks.length);
    expect(filterTracks(tracks, '   ')).toHaveLength(tracks.length);
  });

  it('is case-insensitive across title, artist, album, genre and key', () => {
    expect(ids(filterTracks(tracks, 'MIDNIGHT'))).toEqual(['1']);
    expect(ids(filterTracks(tracks, 'daft'))).toEqual(['3']);
    expect(ids(filterTracks(tracks, 'homework'))).toEqual(['3']);
    expect(ids(filterTracks(tracks, 'trance'))).toEqual(['2']);
    expect(ids(filterTracks(tracks, '10A'))).toEqual(['4']);
  });

  it('ANDs multiple words across fields', () => {
    expect(ids(filterTracks(tracks, 'm83 midnight'))).toEqual(['1']);
    expect(ids(filterTracks(tracks, 'm83 homework'))).toEqual([]);
  });

  it('returns nothing when a term matches no track', () => {
    expect(filterTracks(tracks, 'zzz')).toEqual([]);
  });
});

describe('sortTracks', () => {
  it('does not mutate the input', () => {
    const before = ids(tracks);
    sortTracks(tracks, 'title', 'asc');
    expect(ids(tracks)).toEqual(before);
  });

  it('sorts titles and artists case-insensitively in both directions', () => {
    // Around the World, Café Del Mar, Midnight City, Strobe, Ten
    expect(ids(sortTracks(tracks, 'title', 'asc'))).toEqual(['3', '2', '1', '4', '5']);
    // Pearl Jam, M83, Energy 52, deadmau5, Daft Punk
    expect(ids(sortTracks(tracks, 'artist', 'desc'))).toEqual(['5', '1', '2', '4', '3']);
  });

  it('sorts numerically by bpm, duration and addedAt', () => {
    expect(ids(sortTracks(tracks, 'bpm', 'asc')).slice(0, 4)).toEqual(['5', '1', '4', '2']);
    expect(ids(sortTracks(tracks, 'duration', 'desc'))).toEqual(['4', '3', '2', '1', '5']);
    expect(ids(sortTracks(tracks, 'addedAt', 'asc'))).toEqual(['2', '3', '1', '4', '5']);
  });

  it('sorts Camelot keys by number then A/B letter', () => {
    // 2B=5, 8A=16, 10A=20, 11B=23
    expect(ids(sortTracks(tracks, 'key', 'asc')).slice(0, 4)).toEqual(['5', '1', '4', '2']);
    expect(ids(sortTracks(tracks, 'key', 'desc')).slice(0, 4)).toEqual(['2', '4', '1', '5']);
  });

  it('keeps tracks missing bpm or key last in either direction', () => {
    // Track 3 has no bpm and no key.
    expect(ids(sortTracks(tracks, 'bpm', 'asc'))).toEqual(['5', '1', '4', '2', '3']);
    expect(ids(sortTracks(tracks, 'bpm', 'desc'))).toEqual(['2', '4', '1', '5', '3']);
    expect(ids(sortTracks(tracks, 'key', 'asc'))).toEqual(['5', '1', '4', '2', '3']);
    expect(ids(sortTracks(tracks, 'key', 'desc'))).toEqual(['2', '4', '1', '5', '3']);
  });
});
