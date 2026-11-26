import { useEffect } from 'react';
import type { LibraryApi, TrackMeta } from '../types';
import { libraryStore } from './store';

export { libraryStore } from './store';
export type { LibraryState } from './store';
export type { ImportReport } from './importer';
export * from './search';
export * from './playlistMatch';

/** React hook over the library. Triggers the initial IndexedDB load once (idempotent). */
export function useLibrary(): LibraryApi {
  const tracks: TrackMeta[] = libraryStore((s) => s.tracks);
  const loading = libraryStore((s) => s.loading);

  useEffect(() => {
    void libraryStore.getState().init();
  }, []);

  return {
    tracks,
    loading,
    importFiles: async (files) => {
      await libraryStore.getState().importFiles(files);
    },
    getFile: (id) => libraryStore.getState().getFile(id),
    updateTrack: (id, patch) => libraryStore.getState().updateTrack(id, patch),
    removeTrack: (id) => libraryStore.getState().removeTrack(id),
  };
}
