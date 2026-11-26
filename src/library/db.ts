import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { TrackMeta } from '../types';

const DB_NAME = 'deckline';
const DB_VERSION = 1;

interface DecklineDB extends DBSchema {
  tracks: { key: string; value: TrackMeta };
  files: { key: string; value: Blob }; // key = track id
}

let dbPromise: Promise<IDBPDatabase<DecklineDB>> | null = null;

function getDb(): Promise<IDBPDatabase<DecklineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DecklineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('tracks')) {
          db.createObjectStore('tracks', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files');
        }
      },
    });
  }
  return dbPromise;
}

export async function putTrack(track: TrackMeta): Promise<void> {
  const db = await getDb();
  await db.put('tracks', track);
}

/** Writes track metadata and its audio blob in one transaction. */
export async function putImported(track: TrackMeta, file: Blob): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['tracks', 'files'], 'readwrite');
  await Promise.all([
    tx.objectStore('tracks').put(track),
    tx.objectStore('files').put(file, track.id),
    tx.done,
  ]);
}

export async function getAllTracks(): Promise<TrackMeta[]> {
  const db = await getDb();
  return db.getAll('tracks');
}

export async function getTrack(id: string): Promise<TrackMeta | undefined> {
  const db = await getDb();
  return db.get('tracks', id);
}

/** Merges `patch` into an existing track. Returns the updated track, or undefined if missing. */
export async function patchTrack(id: string, patch: Partial<TrackMeta>): Promise<TrackMeta | undefined> {
  const db = await getDb();
  const tx = db.transaction('tracks', 'readwrite');
  const store = tx.objectStore('tracks');
  const current = await store.get(id);
  if (!current) {
    await tx.done;
    return undefined;
  }
  const next: TrackMeta = { ...current, ...patch, id: current.id };
  await store.put(next);
  await tx.done;
  return next;
}

/** Removes the track metadata and its audio blob. */
export async function deleteTrack(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['tracks', 'files'], 'readwrite');
  await Promise.all([
    tx.objectStore('tracks').delete(id),
    tx.objectStore('files').delete(id),
    tx.done,
  ]);
}

export async function putFile(id: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put('files', blob, id);
}

export async function getFile(id: string): Promise<Blob | undefined> {
  const db = await getDb();
  return db.get('files', id);
}
