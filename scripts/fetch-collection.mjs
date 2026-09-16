// Task 1: collect every NFT held by the owner, with original files.
// 1) discover tokens via a public indexer, 2) verify ownership on-chain,
// 3) read tokenURI/uri from the contract, 4) download originals.
// Idempotent: re-running downloads only what's missing or broken.
// Usage: npm run fetch
import { createPublicClient, http, parseAbi, getAddress } from 'viem';
import { mainnet } from 'viem/chains';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { OWNER, RPC_URL, INDEXER_URL, IPFS_GATEWAYS, FLAGSHIPS, HIDDEN, METADATA_SERVICES, IMAGE_OVERRIDES } from './config.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const ORIGINALS = path.join(DATA, 'originals');

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL, { retryCount: 3, batch: { batchSize: 50 } }),
});

const abi721 = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function tokenURI(uint256) view returns (string)',
]);
const abi1155 = parseAbi([
  'function balanceOf(address,uint256) view returns (uint256)',
  'function uri(uint256) view returns (string)',
]);

const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'model/gltf-binary': 'glb', 'text/html': 'html', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
};
const SIGNATURES = {
  png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], gif: [0x47, 0x49, 0x46],
  webp: [0x52, 0x49, 0x46, 0x46], glb: [0x67, 0x6c, 0x54, 0x46],
};
// Some servers send a generic type; fall back to magic bytes.
function sniff(buf) {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lc = (a) => a.toLowerCase();
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-') || 'collection';

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

async function fetchWithFallback(uri, { tries = 3, timeout = 45_000, headers = {} } = {}) {
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
async function curlGet(url, headers = {}) {
  const tmp = path.join(DATA, `.curl-${randomUUID()}`);
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

async function pool(items, limit, fn) {
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

// ---------- discovery ----------
async function discover() {
  const found = [];
  let params = '';
  for (let page = 0; page < 50; page++) {
    const url = `${INDEXER_URL}/addresses/${OWNER.address}/nft?type=ERC-721,ERC-1155,ERC-404${params}`;
    const { buf } = await fetchWithFallback(url);
    const d = JSON.parse(buf.toString('utf8'));
    for (const it of d.items ?? []) {
      found.push({
        contract: getAddress(it.token.address_hash ?? it.token.address),
        collectionName: it.token.name,
        standard: it.token_type === 'ERC-1155' ? 'erc1155' : 'erc721',
        tokenId: String(it.id),
        indexerMeta: it.metadata ?? null,
        indexerImage: it.image_url ?? null,
        indexerAnimation: it.animation_url ?? null,
      });
    }
    if (!d.next_page_params) break;
    params = '&' + Object.entries(d.next_page_params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  }
  return found;
}

// ---------- metadata ----------
function resolveTemplate(uri, tokenId) {
  // ERC-1155 {id}: lowercase hex, zero-padded to 64 chars
  return uri.includes('{id}') ? uri.replaceAll('{id}', BigInt(tokenId).toString(16).padStart(64, '0')) : uri;
}

async function readChain(tokens) {
  const calls = tokens.flatMap((t) =>
    t.standard === 'erc721'
      ? [
          { address: t.contract, abi: abi721, functionName: 'ownerOf', args: [BigInt(t.tokenId)] },
          { address: t.contract, abi: abi721, functionName: 'tokenURI', args: [BigInt(t.tokenId)] },
        ]
      : [
          { address: t.contract, abi: abi1155, functionName: 'balanceOf', args: [OWNER.address, BigInt(t.tokenId)] },
          { address: t.contract, abi: abi1155, functionName: 'uri', args: [BigInt(t.tokenId)] },
        ],
  );
  const res = [];
  for (let i = 0; i < calls.length; i += 200) {
    res.push(...(await client.multicall({ contracts: calls.slice(i, i + 200), allowFailure: true })));
  }
  tokens.forEach((t, i) => {
    const [own, uri] = [res[i * 2], res[i * 2 + 1]];
    if (own.status === 'success') t.owned = t.standard === 'erc721' ? lc(own.result) === lc(OWNER.address) : own.result > 0n;
    else t.owned = null; // contract without ownerOf/balanceOf (e.g. pre-standard) – trust indexer
    t.tokenURI = uri.status === 'success' && uri.result ? resolveTemplate(uri.result, t.tokenId) : null;
  });
}

// Contract metadata is cached per token; delete data/meta-cache to force a refresh
// (needed only for collections with mutable metadata).
const META_CACHE = path.join(DATA, 'meta-cache');

async function loadMeta(t) {
  // a rescue source may also carry the metadata, when the project API that served it is gone
  const rescueMeta = IMAGE_OVERRIDES[lc(t.contract)]?.[t.tokenId]?.metadataUrl;
  if (rescueMeta) t.tokenURI = rescueMeta;
  // A configured metadata service wins over the contract's tokenURI: it is either the only source
  // (ENS) or the project's live host after a move (Lazy Scenes).
  if (METADATA_SERVICES[lc(t.contract)]) t.tokenURI = METADATA_SERVICES[lc(t.contract)](t.tokenId);
  const cacheFile = path.join(META_CACHE, lc(t.contract), `${t.tokenId.slice(0, 80)}.json`);
  try {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
    if (cached.tokenURI === t.tokenURI) return { meta: cached.meta, source: 'contract' };
  } catch {}
  if (t.tokenURI) {
    try {
      const { buf } = await fetchWithFallback(t.tokenURI, { tries: 2, timeout: 30_000 });
      const meta = JSON.parse(buf.toString('utf8'));
      await mkdir(path.dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile, JSON.stringify({ tokenURI: t.tokenURI, meta }));
      return { meta, source: 'contract' };
    } catch {}
  }
  if (t.indexerMeta) return { meta: t.indexerMeta, source: 'indexer' };
  return { meta: null, source: null };
}

// ---------- files ----------
function isValid(buf, ext) {
  if (!buf.length) return false;
  const sig = SIGNATURES[ext];
  return !sig || sig.every((b, i) => buf[i] === b);
}

async function existing(dir, base) {
  try {
    const hit = (await readdir(dir)).find((f) => f.startsWith(base + '.') && !f.slice(base.length + 1).includes('.'));
    if (!hit) return null;
    return isValid(await readFile(path.join(dir, hit)), path.extname(hit).slice(1)) ? hit : null;
  } catch {
    return null;
  }
}

async function download(uri, dir, base, broken, headers) {
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

const normalizeAttrs = (a) =>
  (Array.isArray(a) ? a : [])
    .filter((x) => x && x.trait_type != null && x.value != null && typeof x.value !== 'object')
    .map((x) => ({ trait_type: String(x.trait_type).trim(), value: String(x.value).trim() }));

// ---------- main ----------
async function main() {
  const discovered = await discover();
  const hidden = [];
  const visible = [];
  for (const t of discovered) {
    const reason = HIDDEN[lc(t.contract)];
    if (reason) hidden.push({ contract: t.contract, name: t.collectionName, tokenId: t.tokenId, reason });
    else visible.push(t);
  }
  console.log(`Discovered ${discovered.length} tokens, hidden ${hidden.length}, processing ${visible.length}`);

  await readChain(visible);
  const notOwned = visible.filter((t) => t.owned === false);
  if (notOwned.length) console.warn(`Skipping ${notOwned.length} token(s) not owned on-chain (indexer lag):`, notOwned.map((t) => `${t.collectionName} #${t.tokenId}`));
  const tokens = visible.filter((t) => t.owned !== false);

  const broken = [];
  const suspicious = [];
  let done = 0;
  await pool(tokens, 6, async (t) => {
    const { meta, source } = await loadMeta(t);
    t.metadataSource = source;
    const dir = path.join(ORIGINALS, lc(t.contract));
    await mkdir(dir, { recursive: true });
    const safeId = t.tokenId.length > 40 ? t.tokenId.slice(0, 40) : t.tokenId;

    const override = IMAGE_OVERRIDES[lc(t.contract)]?.[t.tokenId];
    const image = override?.url ?? override?.image ?? meta?.image ?? meta?.image_url ?? t.indexerImage ?? null;
    t.imageSource = override?.source ?? 'original';
    const animation = override?.animation ?? meta?.animation_url ?? t.indexerAnimation ?? null;
    t.name = meta?.name ?? null;
    t.description = meta?.description ?? null;
    t.externalUrl = meta?.external_url ?? null;
    t.image = image;
    t.animationUrl = animation;
    t.attributes = normalizeAttrs(meta?.attributes);
    if (image) t.originalFile = await download(image, dir, safeId, broken, override?.headers);
    else if (typeof meta?.image_data === 'string' && /<svg/i.test(meta.image_data)) {
      // fully on-chain SVG art
      t.originalFile = `${safeId}.svg`;
      await writeFile(path.join(dir, t.originalFile), meta.image_data);
      t.image = 'image_data';
    } else t.originalFile = null;
    t.originalAnimationFile = animation && animation !== image ? await download(animation, dir, `${safeId}-animation`, broken, override?.headers) : null;

    const text = `${t.name ?? ''} ${t.description ?? ''}`;
    if (!meta || /claim|airdrop|reward|voucher|visit\s+\S+\.\w+|free\s+mint/i.test(text)) suspicious.push(`${t.collectionName} #${t.tokenId}: ${text.slice(0, 100)}`);
    if (++done % 20 === 0) console.log(`  ${done}/${tokens.length}`);
  });

  // group
  const memberOf = new Map();
  for (const f of FLAGSHIPS) for (const m of f.members) memberOf.set(lc(m.contract), { flagship: f.slug, member: m });
  const byContract = new Map();
  for (const t of tokens) {
    const k = lc(t.contract);
    if (!byContract.has(k)) byContract.set(k, []);
    byContract.get(k).push(t);
  }
  const clean = (t) => ({
    tokenId: t.tokenId,
    name: t.name,
    description: t.description,
    externalUrl: t.externalUrl,
    tokenURI: t.tokenURI,
    metadataSource: t.metadataSource,
    image: t.image,
    imageSource: t.imageSource ?? 'original',
    animationUrl: t.animationUrl,
    originalFile: t.originalFile,
    originalAnimationFile: t.originalAnimationFile,
    attributes: t.attributes,
  });
  const sortIds = (a, b) => (BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : 1);
  const member = (contract, name, slug) => {
    const list = (byContract.get(lc(contract)) ?? []).sort(sortIds);
    return { slug, name, contract: getAddress(contract), standard: list[0]?.standard ?? 'erc721', count: list.length, tokens: list.map(clean) };
  };

  const groups = FLAGSHIPS.map((f) => ({
    slug: f.slug,
    name: f.name,
    kind: 'flagship',
    members: f.members.map((m) => member(m.contract, m.name, m.slug)).filter((m) => m.count > 0),
  }));
  const usedSlugs = new Set(FLAGSHIPS.flatMap((f) => f.members.map((m) => m.slug)));
  const others = [...byContract.keys()]
    .filter((k) => !memberOf.has(k))
    .map((k) => {
      const first = byContract.get(k)[0];
      const name = first.collectionName || first.name?.replace(/\s*#\d+$/, '') || `Contract ${k.slice(0, 8)}`;
      let slug = slugify(name);
      while (usedSlugs.has(slug)) slug += '-' + k.slice(2, 6);
      usedSlugs.add(slug);
      return member(k, name, slug);
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  groups.push({ slug: 'others', name: 'Others', kind: 'others', members: others });

  const out = { owner: OWNER, fetchedAt: new Date().toISOString(), groups, hidden };
  await writeFile(path.join(DATA, 'collection.json'), JSON.stringify(out, null, 2) + '\n');

  const total = groups.reduce((n, g) => n + g.members.reduce((m, x) => m + x.count, 0), 0);
  console.log(`\nDone: ${total} tokens in ${groups.reduce((n, g) => n + g.members.length, 0)} collections -> data/collection.json`);
  for (const g of groups) console.log(`  ${g.name}: ${g.members.map((m) => `${m.name} ${m.count}`).join(', ')}`);
  const noImage = tokens.filter((t) => !t.originalFile);
  if (noImage.length) console.warn(`\n${noImage.length} token(s) without a downloaded image:`, noImage.map((t) => `${t.collectionName} #${t.tokenId.slice(0, 12)}`));
  if (suspicious.length) console.warn(`\nReview for spam (not hidden automatically):\n  ${suspicious.join('\n  ')}`);
  await writeFile(path.join(DATA, 'broken.json'), JSON.stringify(broken, null, 2) + '\n');
  if (broken.length) {
    console.warn(`\n${broken.length} failed download(s), see data/broken.json. Re-run to retry.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
