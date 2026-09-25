// Shared media helpers: resolve ipfs:// and ar:// links, download originals, verify file types.
// Used by scripts/fetch-collection.mjs (site data) and scripts/archive-collection.mjs (personal archive).
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IPFS_GATEWAYS } from '../config.mjs';

export const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'model/gltf-binary': 'glb', 'text/html': 'html', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
};
const SIGNATURES = {
  png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46],
  webp: [0x52, 0x49, 0x46, 0x46], glb: [0x67, 0x6c, 0x54, 0x46],
};
// Some servers send a generic type; fall back to magic bytes.
export function sniff(buf) {
  for (const [ext, sig] of Object.entries(SIGNATURES)) if (sig.every((b, i) => buf[i] === b)) return ext;
  const head = buf.subarray(0, 512).toString('utf8').trimStart();
  if (/^(<\?xml[^>]*>\s*)?<svg/i.test(head)) return 'svg';
  if (/^<!doctype html|^<html/i.test(head)) return 'html';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (brand.startsWith('avi')) return 'avif'; // avif, avis
    if (brand.startsWith('hei') || brand.startsWith('mif')) return 'heic';
    return 'mp4';
  }
  return null;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const lc = (a) => a.toLowerCase();
export const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-') || 'collection';

// ---------- network ----------
function candidates(uri) {
  const sub = uri.match(/^https?:\/\/(b[a-z2-7]{50,}|Qm[1-9A-HJ-NP-Za-km-z]{44})\.ipfs\.[^/]+(\/.*)?$/); // subdomain gateways
  if (sub) return IPFS_GATEWAYS.map((g) => g + sub[1] + (sub[2] ?? ''));
  const ipfs = uri.match(/^ipfs:\/\/(?:ipfs\/)?(.+)$/) || uri.match(/^https?:\/\/[^/]+\/ipfs\/(.+)$/);
  if (ipfs) return [...IPFS_GATEWAYS.map((g) => g + ipfs[1]), ...(uri.startsWith('http') ? [uri] : [])];
  if (uri.startsWith('ar://')) return ['https://arweave.net/' + uri.slice(5)];
  return [uri];
}

// Hosts that keep failing in this run are skipped, so dead servers don't stall every token.
const hostFailures = new Map();
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
// Shared IPFS gateways fail per CID, not per host, so they are never marked dead.
const GATEWAY_HOSTS = new Set(IPFS_GATEWAYS.map(hostOf));
const hostDead = (url) => !GATEWAY_HOSTS.has(hostOf(url)) && (hostFailures.get(hostOf(url)) ?? 0) >= 4;

export async function fetchWithFallback(uri, { tries = 3, timeout = 45_000, headers = {} } = {}) {
  if (uri.startsWith('data:')) {
    const m = uri.match(/^data:([^,]*),(.*)$/s);
    if (!m) throw new Error('bad data uri');
    const isB64 = m[1].endsWith(';base64');
    const buf = isB64 ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]));
    return { buf, mime: m[1].replace(';base64', '').split(';')[0] };
  }
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    const urls = candidates(uri).filter((u) => !hostDead(u));
    if (!urls.length) break; // every host is marked dead; the curl fallback below still gets a try
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'drakaris-site-fetch/1.0', ...headers } });
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        return { buf: Buffer.from(await res.arrayBuffer()), mime };
      } catch (e) {
        lastErr = e;
        // network-level failures (DNS, reset, timeout) and 403/404 count against the host
        if (!/^(429|5\d\d) /.test(e.message ?? '')) hostFailures.set(hostOf(url), (hostFailures.get(hostOf(url)) ?? 0) + 1);
      }
    }
    await sleep(1500 * (attempt + 1));
  }
  if (/^https?:/.test(uri)) {
    try {
      return await curlGet(uri, headers);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// Some CDNs (Element) reject Node's TLS fingerprint but answer curl. Used only as a last resort.
const execFileAsync = promisify(execFile);
export async function curlGet(url, headers = {}) {
  const tmp = path.join(tmpdir(), `curl-${randomUUID()}`);
  const args = ['-sSL', '--max-time', '90', '-o', tmp, '-w', '%{http_code} %{content_type}'];
  for (const [k, v] of Object.entries(headers)) {
    // some CDNs only accept the canonical "User-Agent" spelling, which -H lowercases
    if (k.toLowerCase() === 'user-agent') args.push('-A', v);
    else args.push('-H', `${k}: ${v}`);
  }
  try {
    const { stdout } = await execFileAsync('curl', [...args, url], { encoding: 'utf8' });
    const [code, mime = ''] = stdout.trim().split(" ");
    if (code !== '200') throw new Error(`${code} ${url} (curl)`);
    return { buf: await readFile(tmp), mime: mime.split(';')[0].trim().toLowerCase() };
  } finally {
    await rm(tmp, { force: true });
  }
}

export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

// ---------- files ----------
export function isValid(buf, ext) {
  if (!buf.length) return false;
  const sig = SIGNATURES[ext];
  return !sig || sig.every((b, i) => buf[i] === b);
}

export async function existing(dir, base) {
  try {
    const hit = (await readdir(dir)).find((f) => f.startsWith(base + '.') && !f.slice(base.length + 1).includes('.'));
    if (!hit) return null;
    return isValid(await readFile(path.join(dir, hit)), path.extname(hit).slice(1)) ? hit : null;
  } catch {
    return null;
  }
}

export async function download(uri, dir, base, broken, headers) {
  const have = await existing(dir, base);
  if (have) return have;
  try {
    const { buf, mime } = await fetchWithFallback(uri, headers ? { headers } : {});
    // content beats headers: some servers label PNGs as image/jpeg
    const ext = sniff(buf) ?? MIME_EXT[mime];
    if (!ext || !isValid(buf, ext)) {
      broken.push({ uri, mime, size: buf.length, reason: 'unknown type or bad signature' });
      return null;
    }
    const name = `${base}.${ext}`;
    await writeFile(path.join(dir, name), buf);
    return name;
  } catch (e) {
    broken.push({ uri, reason: String(e.message ?? e) });
    return null;
  }
}

export const normalizeAttrs = (a) =>
  (Array.isArray(a) ? a : [])
    .filter((x) => x && x.trait_type != null && x.value != null && typeof x.value !== 'object')
    .map((x) => ({ trait_type: String(x.trait_type).trim(), value: String(x.value).trim() }));
