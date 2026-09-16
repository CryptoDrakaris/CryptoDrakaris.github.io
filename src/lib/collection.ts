// Build-time access to data/collection.json (npm run fetch) and data/derived.json (npm run derive).
import data from '../../data/collection.json';
import derivedManifest from '../../data/derived.json';
import { asset } from './site';

export type Attribute = { trait_type: string; value: string };

export type Token = {
  tokenId: string;
  name: string | null;
  description: string | null;
  externalUrl: string | null;
  tokenURI: string | null;
  metadataSource: string | null;
  image: string | null;
  /** where the stored file came from when the project's own server is gone */
  imageSource?: 'original' | 'archive' | 'marketplace';
  animationUrl: string | null;
  originalFile: string | null;
  originalAnimationFile: string | null;
  attributes: Attribute[];
};

export type Collection = {
  slug: string;
  name: string;
  contract: string;
  standard: string;
  count: number;
  tokens: Token[];
  /** auto-extracted from the art, readable on dark backgrounds */
  accent: string;
  group: Group;
};

export type Group = {
  slug: string;
  name: string;
  kind: 'flagship' | 'others';
  members: Collection[];
  count: number;
};

type DerivedEntry = { accent?: string; tokens: Record<string, { grid: boolean; full: boolean; width?: number; height?: number; animated?: boolean; kind?: string }> };
const manifest = derivedManifest as Record<string, DerivedEntry>;

export const owner = data.owner;

export const groups: Group[] = (data.groups as any[]).map((g) => {
  const group = { slug: g.slug, name: g.name, kind: g.kind, members: [] as Collection[], count: 0 } as Group;
  group.members = (g.members as any[]).map((m) => ({
    ...m,
    accent: manifest[m.contract.toLowerCase()]?.accent ?? '#ff6a3d',
    group,
    tokens: (m.tokens as Token[]).map((t) => ({ ...t, attributes: t.attributes ?? [] })),
  }));
  group.count = group.members.reduce((n, m) => n + m.tokens.length, 0);
  return group;
});

export const flagships = groups.filter((g) => g.kind === 'flagship' && g.count > 0);
export const others = groups.find((g) => g.kind === 'others');
export const collections: Collection[] = groups.flatMap((g) => g.members);
export const totalTokens = collections.reduce((n, c) => n + c.tokens.length, 0);

export const findGroup = (slug: string) => groups.find((g) => g.slug === slug);

// ---------- media ----------
export function media(col: Collection, t: Token) {
  return manifest[col.contract.toLowerCase()]?.tokens?.[t.tokenId];
}
export function hasImage(col: Collection, t: Token) {
  return !!media(col, t)?.grid;
}
export function derived(col: Collection, t: Token, size: 'grid' | 'full') {
  return asset(`derived/${col.contract.toLowerCase()}/${t.tokenId}-${size}.webp`);
}
export function fullSize(col: Collection, t: Token) {
  const m = media(col, t);
  return { width: m?.width ?? 1600, height: m?.height ?? 1600 };
}

const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
export function toHttp(uri: string | null) {
  if (!uri) return null;
  const m = uri.match(/^ipfs:\/\/(?:ipfs\/)?(.+)$/);
  if (m) return IPFS_GATEWAY + m[1];
  if (uri.startsWith('ar://')) return 'https://arweave.net/' + uri.slice(5);
  if (uri.startsWith('data:')) return null;
  return uri;
}
export const originalUrl = (t: Token) => toHttp(t.animationUrl) ?? toHttp(t.image);

// ---------- links & names ----------
export const openseaUrl = (col: Collection, t: Token) => `https://opensea.io/assets/ethereum/${col.contract}/${t.tokenId}`;
export const etherscanTokenUrl = (col: Collection, t: Token) => `https://etherscan.io/nft/${col.contract}/${t.tokenId}`;
export const etherscanAddressUrl = (addr: string) => `https://etherscan.io/address/${addr}`;

export const shortAddress = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
/** Very long ids (ERC-1155 packed ids) are shortened for display. */
export const shortId = (id: string) => (id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

export function tokenTitle(col: Collection, t: Token) {
  if (!t.name) return `${col.name} #${shortId(t.tokenId)}`;
  return /^#?\d+$/.test(t.name.trim()) ? `${col.name} #${t.name.replace('#', '')}` : t.name;
}
/** Short label for cards */
export function tokenLabel(col: Collection, t: Token) {
  const title = tokenTitle(col, t);
  return title.startsWith(col.name + ' #') ? `#${shortId(t.tokenId)}` : title;
}

export const tokenPath = (col: Collection, t: Token) => `nft/${col.slug}/${t.tokenId}`;

export function traitIndex(cols: Collection[]) {
  const map = new Map<string, Set<string>>();
  for (const c of cols)
    for (const t of c.tokens)
      for (const a of t.attributes) {
        if (!map.has(a.trait_type)) map.set(a.trait_type, new Set());
        map.get(a.trait_type)!.add(a.value);
      }
  return [...map.entries()].map(([type, values]) => ({ type, values: [...values].sort() }));
}
