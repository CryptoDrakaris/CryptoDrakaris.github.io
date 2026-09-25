// Personal archive: every NFT of the owner across chains, in the best quality available.
// Independent from the site pipeline: nothing here is published, files stay on disk.
// Usage: npm run archive [-- --chain base] [--dry]
import { createPublicClient, http, parseAbi, getAddress } from 'viem';
import * as chains from 'viem/chains';
import sharp from 'sharp';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { OWNER, CHAINS, HIDDEN, ARCHIVE_ALLOW, ARCHIVE_DENY, METADATA_SERVICES } from './config.mjs';
import { fetchWithFallback, pool, download, lc, normalizeAttrs } from './lib/media.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const ORIGINALS = path.join(DATA, 'originals');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const only = args.includes('--chain') ? args[args.indexOf('--chain') + 1] : null;

const abi721 = parseAbi(['function ownerOf(uint256) view returns (address)', 'function tokenURI(uint256) view returns (string)']);
const abi1155 = parseAbi(['function balanceOf(address,uint256) view returns (uint256)', 'function uri(uint256) view returns (string)']);

// Two lists, because real collections talk about mints and rewards too.
// STRONG – only bait writes this way: a prize sum, a throwaway domain, a link shortener,
// a random tag glued to the name. Checked everywhere, including description and external_url.
const STRONG_RE = new RegExp(
  [
    '🎁',
    String.raw`\bt\.ly\b|\bbit\.ly\b|\btinyurl\b|\bcutt\.ly\b`,
    String.raw`\b[\w-]+\.(cfd|lat|icu|lol|click|top|us|pl|sbs|cyou|monster)\b`,
    String.raw`\[[A-Za-z0-9]{6,10}\]`, // «ETH CTIY [lCz2mp1Z]»: случайная метка в названии
    String.raw`\bhigh risk\b|\bconnect\s+wallet\b|\bwallet\s+verification\b`,
    String.raw`\bclaim\s+(your\s+|the\s+)?(rewards?|airdrop|tokens?|prize)\b`, // призыв фишинга
    String.raw`\bface value of\b`,
  ].join('|'),
  'i',
);

// WEAK – ordinary words and sums that turn into bait only in a collection or token name.
// Not applied to descriptions: an honest project writes «3 for $10» and «reward» there too.
const WEAK_RE = new RegExp(
  [
    String.raw`\$\s?\d`,
    String.raw`\d+[\s,.]*\d*\s?\$`,
    String.raw`\d+[\s,.]*\d*\s?(usdc|usdt|eth|bnb|shib|matic|sol|aave|zro|ton)\b`,
    String.raw`\bclaims?\b`,
    String.raw`\bairdrops?\b`,
    String.raw`\breward(s|ed)?\b`,
    String.raw`\bvouchers?\b`,
    String.raw`\bgiveaways?\b`,
    String.raw`\bfree\s*mint\b`,
    String.raw`\bprize\b|\bwinner\b|\bwin\b`,
    String.raw`\bgifts?\b|\btickets?\b|\bbonus\b`,
    String.raw`\bqr\s*code\b|\bkyc\b|\bverify\b|\bunlock\b`,
    String.raw`\b(lido|eigenlayer|layerzero|pancakeswap)\b`,
  ].join('|'),
  'i',
);

const RASTER = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

const isSpam = (t) => {
  const names = [t.collectionName, t.name].filter(Boolean).join(' ');
  const all = [names, t.description, t.externalUrl].filter(Boolean).join(' ');
  return STRONG_RE.test(all) || WEAK_RE.test(names);
};

function chainClient(chain) {
  const viemChain = chains[chain.viem];
  if (!viemChain) return null;
  return createPublicClient({ chain: viemChain, transport: http(chain.rpc, { retryCount: 2, batch: { batchSize: 40 } }) });
}

async function discover(chain) {
  const found = [];
  let params = '';
  for (let page = 0; page < 40; page++) {
    const url = `${chain.api}/addresses/${OWNER.address}/nft?type=ERC-721,ERC-1155,ERC-404${params}`;
    let d;
    try {
      const { buf } = await fetchWithFallback(url, { tries: 2, timeout: 30_000 });
      d = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      console.warn(`  ${chain.id}: индексатор не ответил (${String(e.message ?? e).slice(0, 60)})`);
      break;
    }
    for (const it of d.items ?? []) {
      const meta = it.metadata ?? {};
      found.push({
        chain: chain.id,
        contract: getAddress(it.token.address_hash ?? it.token.address),
        collectionName: it.token.name ?? null,
        standard: it.token_type === 'ERC-1155' ? 'erc1155' : 'erc721',
        tokenId: String(it.id),
        name: meta.name ?? null,
        description: meta.description ?? null,
        externalUrl: meta.external_url ?? null,
        attributes: normalizeAttrs(meta.attributes),
        indexerImage: it.image_url ?? meta.image ?? null,
        indexerAnimation: it.animation_url ?? meta.animation_url ?? null,
      });
    }
    if (!d.next_page_params) break;
    params = '&' + Object.entries(d.next_page_params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  }
  return found;
}

/** tokenURI and ownership straight from the contract; the indexer is only a fallback. */
async function readChain(client, tokens) {
  if (!client || !tokens.length) return;
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
  for (let i = 0; i < calls.length; i += 120) {
    try {
      res.push(...(await client.multicall({ contracts: calls.slice(i, i + 120), allowFailure: true })));
    } catch {
      res.push(...calls.slice(i, i + 120).map(() => ({ status: 'failure' })));
    }
  }
  tokens.forEach((t, i) => {
    const [own, uri] = [res[i * 2], res[i * 2 + 1]];
    t.owned = own?.status === 'success' ? (t.standard === 'erc721' ? lc(own.result) === lc(OWNER.address) : own.result > 0n) : null;
    const raw = uri?.status === 'success' ? uri.result : null;
    t.tokenURI = raw ? (raw.includes('{id}') ? raw.replaceAll('{id}', BigInt(t.tokenId).toString(16).padStart(64, '0')) : raw) : null;
  });
}

async function loadMeta(t) {
  const svc = METADATA_SERVICES[lc(t.contract)];
  if (svc) t.tokenURI = svc(t.tokenId);
  if (!t.tokenURI) return null;
  try {
    const { buf } = await fetchWithFallback(t.tokenURI, { tries: 2, timeout: 25_000 });
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

async function dimensions(file) {
  if (!RASTER.test(file)) return null;
  try {
    const m = await sharp(file).metadata();
    return { width: m.width, height: m.pageHeight ?? m.height };
  } catch {
    return null;
  }
}

async function main() {
  const chainList = CHAINS.filter((c) => !only || c.id === only);
  const inventory = [];
  const skipped = { spam: [], noMedia: [], notOwned: [], denied: [] };
  const broken = [];

  for (const chain of chainList) {
    const all = await discover(chain);
    const client = chainClient(chain);

    const keep = [];
    for (const t of all) {
      const key = lc(t.contract);
      if (ARCHIVE_DENY[key] || HIDDEN[key]) { skipped.denied.push(`${chain.id} ${t.collectionName ?? key}`); continue; }
      if (!ARCHIVE_ALLOW[key] && isSpam(t)) { skipped.spam.push(`${chain.id} ${t.collectionName ?? t.name ?? key}`); continue; }
      keep.push(t);
    }
    console.log(`\n${chain.name}: найдено ${all.length}, после фильтра ${keep.length}`);
    if (dry) { keep.forEach((t) => console.log(`   ${(t.collectionName ?? '—').slice(0, 34).padEnd(34)} #${t.tokenId.slice(0, 10).padEnd(10)} ${t.contract}`)); continue; }

    await readChain(client, keep);
    let done = 0;
    await pool(keep, 5, async (t) => {
      if (t.owned === false) { skipped.notOwned.push(`${chain.id} ${t.collectionName} #${t.tokenId}`); return; }
      const meta = await loadMeta(t);
      if (meta) {
        t.name = meta.name ?? t.name;
        t.description = meta.description ?? t.description;
        t.externalUrl = meta.external_url ?? t.externalUrl;
        if (meta.attributes) t.attributes = normalizeAttrs(meta.attributes);
      }
      // a second spam pass now that the real metadata is in
      if (!ARCHIVE_ALLOW[lc(t.contract)] && isSpam(t)) { skipped.spam.push(`${chain.id} ${t.collectionName ?? t.name}`); return; }

      const image = meta?.image ?? meta?.image_url ?? t.indexerImage ?? null;
      const animation = meta?.animation_url ?? t.indexerAnimation ?? null;
      if (!image && !animation) { skipped.noMedia.push(`${chain.id} ${t.collectionName} #${t.tokenId}`); return; }

      // Ethereum keeps the existing layout so the site pipeline finds its files
      const dir = chain.id === 'ethereum' ? path.join(ORIGINALS, lc(t.contract)) : path.join(ORIGINALS, chain.id, lc(t.contract));
      await mkdir(dir, { recursive: true });
      const base = t.tokenId.length > 40 ? t.tokenId.slice(0, 40) : t.tokenId;

      const file = image ? await download(image, dir, base, broken) : null;
      const anim = animation && animation !== image ? await download(animation, dir, `${base}-animation`, broken) : null;

      for (const [f, kind] of [[file, 'image'], [anim, 'animation']]) {
        if (!f) continue;
        const full = path.join(dir, f);
        const size = (await stat(full)).size;
        inventory.push({
          chain: chain.id,
          collection: t.collectionName,
          contract: t.contract,
          tokenId: t.tokenId,
          name: t.name,
          kind,
          file: path.relative(ROOT, full).replace(/\\/g, '/'),
          bytes: size,
          ...((await dimensions(full)) ?? {}),
          sourceUrl: kind === 'image' ? image : animation,
          tokenURI: t.tokenURI,
          standard: t.standard,
          traits: t.attributes?.length ?? 0,
        });
      }
      if (++done % 10 === 0) console.log(`   ${done}/${keep.length}`);
    });
  }

  const uniq = (a) => [...new Set(a)];

  if (dry) {
    console.log(`\nОтсеяно фильтром: спам ${skipped.spam.length}, вручную ${skipped.denied.length}`);
    for (const s of uniq([...skipped.spam, ...skipped.denied])) console.log('   ' + s);
    return;
  }

  // A --chain run only knows about one chain, so keep what the previous full run recorded
  // about the others instead of throwing the inventory away.
  const invPath = path.join(DATA, 'archive.json');
  if (only) {
    try {
      const old = JSON.parse(await readFile(invPath, 'utf8'));
      inventory.push(...(old.files ?? []).filter((f) => f.chain !== only));
      for (const [k, v] of Object.entries(old.skipped ?? {})) skipped[k]?.push(...v.filter((s) => !s.startsWith(`${only} `)));
    } catch {
      // первого архива ещё нет – пишем только эту сеть
    }
  }

  inventory.sort((a, b) => a.chain.localeCompare(b.chain) || String(a.collection).localeCompare(String(b.collection)) || a.tokenId.localeCompare(b.tokenId));
  await writeFile(invPath, JSON.stringify({ owner: OWNER, madeAt: new Date().toISOString(), files: inventory, skipped }, null, 2) + '\n');

  const byChain = {};
  let bytes = 0;
  for (const f of inventory) {
    byChain[f.chain] ??= { files: 0, bytes: 0, collections: new Set() };
    byChain[f.chain].files++;
    byChain[f.chain].bytes += f.bytes;
    byChain[f.chain].collections.add(f.collection);
    bytes += f.bytes;
  }
  console.log('\n=== Архив ===');
  for (const [c, s] of Object.entries(byChain))
    console.log(`  ${c.padEnd(10)} ${String(s.files).padStart(4)} файлов  ${(s.bytes / 1048576).toFixed(1).padStart(7)} МБ  ${s.collections.size} коллекций`);
  console.log(`  всего      ${String(inventory.length).padStart(4)} файлов  ${(bytes / 1048576).toFixed(1).padStart(7)} МБ  -> data/archive.json`);

  console.log(`\nОтфильтровано как спам: ${skipped.spam.length} (${uniq(skipped.spam).length} коллекций)`);
  for (const s of uniq(skipped.spam).slice(0, 25)) console.log('   ' + s);
  if (uniq(skipped.spam).length > 25) console.log(`   … ещё ${uniq(skipped.spam).length - 25}`);
  if (skipped.noMedia.length) console.log(`\nБез картинки в метаданных: ${uniq(skipped.noMedia).join(', ')}`);
  if (skipped.notOwned.length) console.log(`\nУже не принадлежит адресу: ${uniq(skipped.notOwned).join(', ')}`);
  if (broken.length) {
    await writeFile(path.join(DATA, 'archive-broken.json'), JSON.stringify(broken, null, 2) + '\n');
    console.log(`\nНе скачалось: ${broken.length} (data/archive-broken.json), повторный запуск докачает`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
