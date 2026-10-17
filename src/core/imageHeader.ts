/** Header-only image size reader. Pure: no DOM, no decoding. Pass the first ~256 KB of the file. */
export type Size = { width: number; height: number };

const ok = (width: number, height: number): Size | null => (width > 0 && height > 0 ? { width, height } : null);

function jpeg(b: Uint8Array): Size | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let orientation = 1;
  let pos = 2;
  while (pos + 4 <= b.length) {
    if (b[pos] !== 0xff) { pos++; continue; }
    const marker = b[pos + 1];
    if (marker === 0xff) { pos++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0) { pos += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before a frame header
    const len = v.getUint16(pos + 2);
    if (len < 2) return null;
    const body = pos + 4;
    if (marker === 0xe1 && len >= 16 && b[body] === 0x45 && b[body + 1] === 0x78 && b[body + 2] === 0x69 && b[body + 3] === 0x66 && b[body + 4] === 0 && b[body + 5] === 0) {
      orientation = exifOrientation(v, body + 6, Math.min(pos + 2 + len, b.length)) ?? orientation;
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (body + 5 > b.length) return null;
      const height = v.getUint16(body + 1);
      const width = v.getUint16(body + 3);
      return orientation >= 5 && orientation <= 8 ? ok(height, width) : ok(width, height);
    }
    pos += 2 + len;
  }
  return null;
}

/** Orientation tag (0x0112) from the TIFF block starting at `tiff`, or null. */
function exifOrientation(v: DataView, tiff: number, end: number): number | null {
  if (tiff + 8 > end) return null;
  const little = v.getUint16(tiff) === 0x4949;
  if (!little && v.getUint16(tiff) !== 0x4d4d) return null;
  const u16 = (o: number) => v.getUint16(o, little);
  const ifd = tiff + v.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) return null;
    if (u16(e) === 0x0112) {
      const value = u16(e + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

function png(b: Uint8Array): Size | null {
  if (b.length < 24) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return v.getUint32(12) === 0x49484452 ? ok(v.getUint32(16), v.getUint32(20)) : null;
}

function gif(b: Uint8Array): Size | null {
  if (b.length < 10) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return ok(v.getUint16(6, true), v.getUint16(8, true));
}

function webp(b: Uint8Array): Size | null {
  if (b.length < 30) return null;
  const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (tag === 'VP8X') return ok((b[24] | (b[25] << 8) | (b[26] << 16)) + 1, (b[27] | (b[28] << 8) | (b[29] << 16)) + 1);
  if (tag === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return ok((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (tag === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return ok((b[26] | (b[27] << 8)) & 0x3fff, (b[28] | (b[29] << 8)) & 0x3fff);
  }
  return null;
}

/** Display (EXIF-oriented) pixel size from the leading bytes of a JPEG, PNG, WebP or GIF; null when unknown or truncated. */
export function readOrientedSize(bytes: Uint8Array): Size | null {
  const b = bytes;
  try {
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return png(b);
    if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return gif(b);
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return webp(b);
  } catch {
    // RangeError on truncated data
  }
  return null;
}
