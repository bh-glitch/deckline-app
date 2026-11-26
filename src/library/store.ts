import { create } from 'zustand';
import type { TrackMeta } from '../types';
import * as db from './db';
import { importFiles as runImport, type ImportReport } from './importer';

export interface LibraryState {
  tracks: TrackMeta[];
  loading: boolean;
  /** Loads tracks from IndexedDB. Idempotent: only the first call hits the DB. */
  init: () => Promise<void>;
  importFiles: (files: File[] | FileList) => Promise<ImportReport>;
  updateTrack: (id: string, patch: Partial<TrackMeta>) => Promise<void>;
  removeTrack: (id: string) => Promise<void>;
  getFile: (id: string) => Promise<Blob | undefined>;
}

let initPromise: Promise<void> | null = null;
// Serializes imports so duplicate detection never races with itself.
let importChain: Promise<unknown> = Promise.resolve();

export const libraryStore = create<LibraryState>()((set, get) => ({
  tracks: [],
  loading: false,

  init: () => {
    if (!initPromise) {
      set({ loading: true });
      initPromise = db
        .getAllTracks()
        .then((tracks) => {
          tracks.sort((a, b) => a.addedAt - b.addedAt);
          set({ tracks, loading: false });
        })
        .catch((err) => {
          console.error('[library] failed to load tracks', err);
          initPromise = null; // allow a retry
          set({ loading: false });
        });
    }
    return initPromise;
  },

  importFiles: (files) => {
    const run = importChain.then(async () => {
      set({ loading: true });
      try {
        const report = await runImport(files);
        if (report.imported.length > 0) {
          const tracks = await db.getAllTracks();
          tracks.sort((a, b) => a.addedAt - b.addedAt);
          set({ tracks });
        }
        return report;
      } finally {
        set({ loading: false });
      }
    });
    importChain = run.catch(() => undefined);
    return run;
  },

  updateTrack: async (id, patch) => {
    const updated = await db.patchTrack(id, patch);
    if (!updated) return;
    set({ tracks: get().tracks.map((t) => (t.id === id ? updated : t)) });
  },

  removeTrack: async (id) => {
    await db.deleteTrack(id);
    set({ tracks: get().tracks.filter((t) => t.id !== id) });
  },

  getFile: (id) => db.getFile(id),
}));
