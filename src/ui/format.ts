export function fmtTime(s: number, signed = false): string {
  if (!isFinite(s)) s = 0;
  const neg = s < 0;
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  const sec = Math.floor(a % 60);
  const str = `${m}:${sec.toString().padStart(2, '0')}`;
  return neg || signed ? (neg ? '-' : '+') + str : str;
}

export function fmtBeats(b: number): string {
  if (b >= 1) return String(b);
  return `1/${Math.round(1 / b)}`;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const HOT_COLORS = ['#ff4d6a', '#ff9f2e', '#ffd84a', '#4ddb7a', '#2fd3c4', '#3d8bff', '#9a6bff', '#ff6bd0'];

export const DECK_COLOR = { A: '#22d3ee', B: '#fb923c' } as const;
export const TRACK_MIME = 'application/x-deckline-track';

/** Make a messy file-derived name readable. */
export function cleanName(raw: string): string {
  let s = (raw || '')
    .replace(/\.(mp3|wav|flac|ogg|oga|m4a|aac|aif|aiff|opus|webm|mp4)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/savetube(\.me)?/gi, ' ')
    .replace(/yt\s*-?\s*shorts?/gi, ' ')
    .replace(/\b(official|lyrics?|hd|hq|4k|1080p|720p)\b/gi, ' ')
    .replace(/\s*\.\s*$/, ' ')
    .replace(/\b(64|96|128|192|256|320)\s*(kbps)?\s*$/i, ' ')
    .replace(/full\s*video\s*song/gi, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return raw || 'Untitled';
  const flat = s === s.toUpperCase() || s === s.toLowerCase();
  s = s.split(' ').map((w) => (flat ? w.toLowerCase() : w)).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return s;
}

/** Downscale an image file to a 256px square JPEG data URL. */
export function imageToDataUrl(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d')!;
      const m = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not an image')); };
    img.src = url;
  });
}
