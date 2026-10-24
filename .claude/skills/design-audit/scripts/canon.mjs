// The brand canon for colour checks: a list on the command line ("#1e6fd9,#222:0.4"), a CSS
// file with custom properties or a JSON design-tokens file ($value / value leaves, {a.b}
// references). Shares after ":" (0–1) are the intended part of the picture, for rasters.
import { readFile } from 'node:fs/promises';
import { parseColor, toHex } from './color-delta.mjs';

/** spec → [{name, hex, rgb, share?}] (opaque colours only; translucent ones over white). */
export async function loadCanon(spec) {
  let pairs;
  if (/\.json$/i.test(spec)) {
    let data;
    try {
      data = JSON.parse(await readFile(spec, 'utf8'));
    } catch (e) {
      throw new Error(e.code === 'ENOENT' ? 'file does not exist' : `not valid JSON: ${e.message}`);
    }
    const byPath = new Map(), shares = new Map();
    const flat = (v, name) => {
      const leaf = v && typeof v === 'object' && !Array.isArray(v) ? (v.$value ?? v.value) : v;
      if (typeof leaf === 'string') {
        byPath.set(name, leaf);
        if (typeof v?.share === 'number') shares.set(name, v.share);
        return;
      }
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!k.startsWith('$')) flat(x, name ? `${name}.${k}` : k);
    };
    flat(data, '');
    const deref = (v, depth = 0) => (depth < 8 && /^\{(.+)\}$/.test(v) && byPath.has(v.slice(1, -1)) ? deref(byPath.get(v.slice(1, -1)), depth + 1) : v);
    pairs = [...byPath].map(([n, v]) => [n, deref(v), shares.get(n)]);
  } else if (/\.css$/i.test(spec)) {
    let text;
    try {
      text = (await readFile(spec, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
    } catch {
      throw new Error('file does not exist');
    }
    const own = {};
    for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) own[m[1]] = m[2].trim(); // a later theme wins, as in the cascade
    const resolve = (v, depth = 0) => (depth > 8 ? v : v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, n, fb) => (own[n] !== undefined ? resolve(own[n], depth + 1) : fb !== undefined ? resolve(fb.trim(), depth + 1) : _)));
    pairs = Object.entries(own).map(([n, v]) => [n, resolve(v)]);
  } else {
    pairs = spec.split(',').map((x, i) => {
      const [v, share] = x.trim().split(':');
      return [`#${i + 1}`, v, share === undefined ? undefined : +share];
    });
    if (pairs.some(([, v]) => !parseColor(v))) throw new Error(`not a colour list or a .css/.json file: ${spec}`);
  }
  const out = [];
  for (const [name, v, share] of pairs) {
    const c = parseColor(v);
    if (!c || c.a === 0) continue;
    const rgb = c.a < 1 ? { r: c.r * c.a + 255 * (1 - c.a), g: c.g * c.a + 255 * (1 - c.a), b: c.b * c.a + 255 * (1 - c.a) } : c;
    out.push({ name, hex: toHex(rgb), rgb, ...(share !== undefined && !isNaN(share) ? { share } : {}) });
  }
  if (!out.length) throw new Error('no colour tokens found');
  return out;
}
