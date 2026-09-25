// Task 1: collect every NFT held by the owner, with original files.
// 1) discover tokens via a public indexer, 2) verify ownership on-chain,
// 3) read tokenURI/uri from the contract, 4) download originals.
// Idempotent: re-running downloads only what's missing or broken.
// Usage: npm run fetch
import { createPublicClient, http, parseAbi, getAddress } from 'viem';
import { mainnet } from 'viem/chains';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OWNER, RPC_URL, INDEXER_URL, FLAGSHIPS, HIDDEN, METADATA_SERVICES, IMAGE_OVERRIDES } from './config.mjs';

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

import { MIME_EXT, sniff, sleep, lc, slugify, fetchWithFallback, curlGet, pool, isValid, existing, download, normalizeAttrs } from './lib/media.mjs';

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
