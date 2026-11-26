import { parseBlob, type IPicture } from 'music-metadata';
import type { TrackMeta } from '../types';
import { getAllTracks, getFile, putImported } from './db';

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'aiff', 'aif']);
const ARTWORK_SIZE = 96;
const ARTWORK_QUALITY = 0.8;
const UNKNOWN_ARTIST = 'Unknown Artist';

export interface ImportReport {
  imported: TrackMeta[];
  skipped: { name: string; reason: 'not-audio' | 'duplicate' }[];
  failed: { name: string; error: string }[];
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isAudioFile(file: File): boolean {
  return AUDIO_EXTENSIONS.has(extensionOf(file.name)) || file.type.startsWith('audio/');
}

/** Splits "Artist - Title" (ASCII or en/em dash) from a filename without its extension. */
export function parseFileName(fileName: string): { artist?: string; title: string } {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { title: base };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Center-crops the picture to a 96x96 JPEG data URL. Returns undefined on any failure. */
export async function makeArtwork(pic: IPicture): Promise<string | undefined> {
  try {
    const src = new Blob([pic.data as BlobPart], { type: pic.format || 'image/jpeg' });
    let bitmap: ImageBitmap;
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(src);
    } else {
      return undefined;
    }
    const scale = Math.max(ARTWORK_SIZE / bitmap.width, ARTWORK_SIZE / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    const dx = (ARTWORK_SIZE - w) / 2;
    const dy = (ARTWORK_SIZE - h) / 2;

    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(ARTWORK_SIZE, ARTWORK_SIZE);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, ARTWORK_SIZE, ARTWORK_SIZE);
      ctx.drawImage(bitmap, dx, dy, w, h);
      bitmap.close();
      const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: ARTWORK_QUALITY });
      return await blobToDataUrl(out);
    }

    // Fallback: regular canvas for browsers without OffscreenCanvas.
    const canvas = document.createElement('canvas');
    canvas.width = ARTWORK_SIZE;
    canvas.height = ARTWORK_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ARTWORK_SIZE, ARTWORK_SIZE);
    ctx.drawImage(bitmap, dx, dy, w, h);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', ARTWORK_QUALITY);
  } catch {
    return undefined;
  }
}

/**
 * Imports audio files into the library (metadata to "tracks", blob to "files").
 * Each file is isolated in its own try/catch so one bad file does not stop the batch.
 * Duplicates are files with the same fileName and byte size as an existing track.
 */
export async function importFiles(files: File[] | FileList): Promise<ImportReport> {
  const report: ImportReport = { imported: [], skipped: [], failed: [] };
  const existing = await getAllTracks();

  for (const file of Array.from(files)) {
    try {
      if (!isAudioFile(file)) {
        report.skipped.push({ name: file.name, reason: 'not-audio' });
        continue;
      }

      // Duplicate check: same fileName and size as an existing track.
      let duplicate = false;
      for (const t of existing) {
        if (t.fileName !== file.name) continue;
        const blob = await getFile(t.id);
        if (blob && blob.size === file.size) {
          duplicate = true;
          break;
        }
      }
      if (duplicate) {
        report.skipped.push({ name: file.name, reason: 'duplicate' });
        continue;
      }

      const meta = await parseBlob(file, { duration: true });
      const common = meta.common;
      const fromName = parseFileName(file.name);

      let title = common.title?.trim() || '';
      let artist = common.artist?.trim() || '';
      if (!title) {
        title = fromName.title;
        artist = artist || fromName.artist || '';
      }
      if (!artist) artist = UNKNOWN_ARTIST;

      const picture = common.picture?.[0];
      const artwork = picture ? await makeArtwork(picture) : undefined;

      const track: TrackMeta = {
        id: crypto.randomUUID(),
        title,
        artist,
        duration: meta.format.duration ?? 0,
        fileName: file.name,
        addedAt: Date.now(),
      };
      if (common.album) track.album = common.album;
      if (common.genre?.length) track.genre = common.genre.join(', ');
      if (typeof common.bpm === 'number' && common.bpm > 0) track.bpm = common.bpm;
      if (artwork) track.artwork = artwork;

      await putImported(track, file);
      existing.push(track);
      report.imported.push(track);
    } catch (err) {
      report.failed.push({
        name: file.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}
