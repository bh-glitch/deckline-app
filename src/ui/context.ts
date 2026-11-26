import { createContext, useContext } from 'react';
import type { LibraryApi, TrackMeta } from '../types';

const empty: LibraryApi = {
  tracks: [], loading: false,
  importFiles: async () => {}, getFile: async () => undefined,
  updateTrack: async () => {}, removeTrack: async () => {},
};

export const LibraryContext = createContext<LibraryApi>(empty);
export const useLib = () => useContext(LibraryContext);

export function useTrack(id: string | null): TrackMeta | undefined {
  const lib = useLib();
  if (!id) return undefined;
  return lib.tracks.find((t) => t.id === id);
}
