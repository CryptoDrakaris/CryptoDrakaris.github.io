// PNG → RGBA pixels for colour measurements (visual-palette-drift). Node 18+, no dependencies.
// Written from the PNG specification (W3C, ISO/IEC 15948): IHDR, PLTE, tRNS, IDAT, the five
// row filters, bit depths 1–16 and all colour types. Interlaced (Adam7) images are not decoded.
import { inflateSync } from 'node:zlib';

/** Buffer → {width, height, data: Uint8Array RGBA} or throws with a readable reason. */
export function decodePng(b) {
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20), depth = b[24], type = b[25], interlace = b[28];
  if (interlace) throw new Error('interlaced PNG (Adam7) is not decoded: re-export without interlacing');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`unknown PNG colour type ${type}`);
  let palette = null, trns = null;
  const idat = [];
  for (let o = 8; o + 8 <= b.length; ) {
    const len = b.readUInt32BE(o), kind = b.toString('latin1', o + 4, o + 8);
    const body = b.subarray(o + 8, o + 8 + len);
    if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    o += 12 + len;
  }
  if (!idat.length) throw new Error('no image data (IDAT)');
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = Math.max(1, (channels * depth) / 8); // bytes per pixel for filtering
  const stride = Math.ceil((width * channels * depth) / 8);
  if (raw.length < (stride + 1) * height) throw new Error('image data is cut short');
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? rows[dst + x - bpp] : 0;
      const up = y ? rows[dst - stride + x] : 0;
      const c = y && x >= bpp ? rows[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      rows[dst + x] = v & 255;
    }
  }
  // samples → 8-bit RGBA
  const max = (1 << depth) - 1;
  const sample = (y, i) => {
    if (depth === 8) return rows[y * stride + i];
    if (depth === 16) return rows[y * stride + i * 2];
    const bit = i * depth, byte = rows[y * stride + (bit >> 3)];
    return (byte >> (8 - depth - (bit & 7))) & max;
  };
  const scale = (v) => (depth >= 8 ? v : Math.round((v * 255) / max));
  const data = new Uint8Array(width * height * 4);
  const key = trns && type === 0 ? trns.readUInt16BE(0) : null;
  const keyRgb = trns && type === 2 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r, g, bl, al = 255;
      if (type === 3) {
        const idx = sample(y, x);
        r = palette[idx * 3];
        g = palette[idx * 3 + 1];
        bl = palette[idx * 3 + 2];
        if (trns && idx < trns.length) al = trns[idx];
      } else if (type === 0 || type === 4) {
        const v = sample(y, x * channels);
        r = g = bl = scale(v);
        if (type === 4) al = scale(sample(y, x * channels + 1));
        else if (key !== null && v === (depth === 16 ? key >> 8 : key)) al = 0;
      } else {
        r = scale(sample(y, x * channels));
        g = scale(sample(y, x * channels + 1));
        bl = scale(sample(y, x * channels + 2));
        if (type === 6) al = scale(sample(y, x * channels + 3));
        else if (keyRgb && depth === 8 && r === keyRgb[0] && g === keyRgb[1] && bl === keyRgb[2]) al = 0;
      }
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = bl;
      data[o + 3] = al;
    }
  return { width, height, data };
}
