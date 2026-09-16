// Owner, flagship groups and hidden contracts.
// ENS was resolved once (2026-09-15) and pinned here, so builds don't depend on ENS.
export const OWNER = {
  ens: 'drakaris.eth',
  address: '0xE71859A7D000648D397b6F1A33b491BD38f26eF3',
};

export const RPC_URL = process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com';
// Public indexer, used only to discover which tokens the wallet holds.
// Metadata and files are still read from each contract's tokenURI/uri.
export const INDEXER_URL = 'https://eth.blockscout.com/api/v2';

// cloudflare-ipfs.com was shut down in 2024, don't add it back
export const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://w3s.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://4everland.io/ipfs/',
  'https://nftstorage.link/ipfs/',
];

// Contracts without tokenURI whose metadata comes from an official service.
export const METADATA_SERVICES = {
  // ENS Base Registrar and NameWrapper
  '0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85': (id) => `https://metadata.ens.domains/mainnet/0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85/${id}`,
  '0xd4416b13d2b3a9abae7acd5d6c2bbdbe25686401': (id) => `https://metadata.ens.domains/mainnet/0xd4416b13d2b3a9abae7acd5d6c2bbdbe25686401/${id}`,
  // Lazy Scenes: on-chain tokenURI points at metadata.lazylions.ai (dead); the team moved the same
  // paths to their live domain, which also serves the main Lazy Lions collection.
  '0x835a6e20348b89831f2d23493f06f9e03a6ce3a3': (id) => `https://metadata.lazylionsnft.com/api/lazyscenes/${id}.json`,
};

// Flagships in the owner's order of preference. Everything not listed here
// and not hidden goes to the "others" group automatically.
export const FLAGSHIPS = [
  {
    slug: 'lazy-lions',
    name: 'Lazy Lions',
    members: [
      { slug: 'lazy-lions', name: 'Lazy Lions', contract: '0x8943C7bAC1914C9A7ABa750Bf2B6B09Fd21037E0' },
      { slug: 'lazy-cubs', name: 'Lazy Cubs', contract: '0xE6A9826E3B6638d01dE95B55690bd4EE7EfF9441' },
      { slug: 'lazy-scenes', name: 'Lazy Scenes', contract: '0x835A6e20348b89831F2d23493F06f9E03a6Ce3a3' },
      { slug: 'lazy-lions-bungalows', name: 'Lazy Lions Bungalows', contract: '0xd80eeF7484c8fab1912A43E44a97774093007ab1' },
      // add-on by 3D Kings: the lower halves of the lions. Owner asked to keep it in the universe.
      { slug: 'lazy-butts', name: 'Lazy Butts', contract: '0x869fb8A354a565F7576009A88F2e8b7159A20010' },
      { slug: 'lazy-comics', name: 'Lazy Comics', contract: '0xf1739d53E816212A788511E3B42F8604a9417a2A' },
    ],
  },
  {
    slug: 'gray-boys',
    name: 'Gray Boys',
    members: [
      { slug: 'gray-boys', name: 'Gray Boys', contract: '0x8d4100897447d173289560BC85c5C432Be4f44E4' },
      // contract is literally GrayBoys_Science_Lab, same deployer as the main contract
      { slug: 'gray-boys-science-lab', name: 'Gray Boys: Science Lab', contract: '0xF90733aB2F368ffe41BFBA80443E04fc33321f67' },
    ],
  },
  {
    slug: 'bubblegum-kids',
    name: 'Bubblegum Kids',
    members: [
      { slug: 'bubblegum-kids', name: 'Bubblegum Kids', contract: '0xa5ae87B40076745895BB7387011ca8DE5fde37E0' },
      // linked from the archived official BGK site
      { slug: 'bubblegum-puppies', name: 'Bubblegum Puppies', contract: '0x86e9C5ad3D4b5519DA2D2C19F5c71bAa5Ef40933' },
    ],
  },
  {
    slug: 'robotos',
    name: 'Robotos',
    members: [
      { slug: 'robotos', name: 'Robotos', contract: '0x099689220846644F87D1137665CDED7BF3422747' },
      { slug: 'robopets', name: 'Robopets', contract: '0x4e962D488412A14aA37eAcADCb83f18C7e2271a7' },
      { slug: 'timepieces-x-robotos', name: 'TIMEPieces x Robotos', contract: '0x0e1f990d264a9818460DDE1b81c0b04D8A88e751' },
    ],
  },
  {
    slug: 'nonconformist-ducks',
    name: 'Nonconformist Ducks',
    members: [
      { slug: 'nonconformist-ducks', name: 'Nonconformist Ducks', contract: '0x0F4B28D46CAB209bC5fa987A92A26a5680538e45' },
      // "hell" contract in nonconformistducks.com/config.js
      { slug: 'hell-ducks', name: 'Hell Ducks', contract: '0x7B7dAd77E4090160F9cB6BA57A5a774c12D4c28a' },
    ],
  },
  {
    slug: 'adam-bomb-squad',
    name: 'Adam Bomb Squad',
    members: [
      { slug: 'adam-bomb-squad', name: 'Adam Bomb Squad', contract: '0x7AB2352b1D2e185560494D5e577F9D3c238b78C5' },
      // by The Hundreds, Nov 2022
      { slug: 'badam-bomb-squad', name: 'Badam Bomb Squad', contract: '0x72C1cB01DcbE46C9e912Ab5aEf5bF0BeD21A6E55' },
    ],
  },
  {
    slug: 'mars-cats-voyage',
    name: 'MarsCatsVoyage',
    members: [
      { slug: 'mars-cats-voyage', name: 'MarsCatsVoyage', contract: '0xdD467a6C8ae2b39825a452E06b4fA82F73D4253D' },
      // same deployer as the main contract (0xaA41b431...), art on MCV's own pinata gateway
      { slug: 'alien-cats', name: 'Alien Cats', contract: '0x97DB06308b1f139D57b4cB364a7397CBe3127035' },
      { slug: 'mars-cats-spacesuits', name: 'Mars Cats in Spacesuits', contract: '0xf148438326E50eC1c703Cb8fc946A6B5A7884E98' },
    ],
  },
];

// Rescue sources for collections whose own servers are gone. Each file is downloaded once and
// self-hosted; `source` is shown on the token page so a re-encoded copy is never passed off as the original.
//   original    – the project's own file
//   archive     – Wayback Machine capture of the project's own file
//   marketplace – marketplace CDN copy, re-encoded
const BLUR = { Referer: 'https://blur.io/', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' };
// Element's CDN only needs a browser user agent, no Referer
const ELEMENT_UA = { 'user-agent': BLUR['user-agent'] };
const blur = (contract, id, hash) => ({ url: `https://images.blur.io/_blur-prod/${contract}/${id}-${hash}`, source: 'marketplace', headers: BLUR });

export const IMAGE_OVERRIDES = {
  // Crypto Cannabis Club: api.cryptocannabisclub.com is gone and the S3 metadata bucket returns 403.
  // The revealed art was never on IPFS (contract baseURI pointed at their API since 2021-08-06).
  '0x80a4b80c653112b789517eb28ac111519b608b19': {
    1636: { url: 'https://web.archive.org/web/20211121121514id_/https://api.cryptocannabisclub.com/image/1636', source: 'archive' },
    2086: blur('0x80a4b80c653112b789517eb28ac111519b608b19', 2086, 'f2213edd65b0b265'),
    5211: blur('0x80a4b80c653112b789517eb28ac111519b608b19', 5211, '0338b2ac3911fcca'),
    9624: blur('0x80a4b80c653112b789517eb28ac111519b608b19', 9624, '40a39e647d721a72'),
  },
  // Lazy Scenes: images were never pinned on IPFS (the CID has no providers left) and the project's
  // own image host is gone. Lossless 3000x4600 PNGs from Blur; metadata still comes from the live official host.
  '0x835a6e20348b89831f2d23493f06f9e03a6ce3a3': {
    102: { url: 'https://images.blur.io/_blur-prod/0x835a6e20348b89831f2d23493f06f9e03a6ce3a3/102-9569e118d035f04e', source: 'marketplace' },
    170: { url: 'https://images.blur.io/_blur-prod/0x835a6e20348b89831f2d23493f06f9e03a6ce3a3/170-6dd71a9dd9728589', source: 'marketplace' },
    1095: { url: 'https://images.blur.io/_blur-prod/0x835a6e20348b89831f2d23493f06f9e03a6ce3a3/1095-97982023971db97d', source: 'marketplace' },
    1096: { url: 'https://images.blur.io/_blur-prod/0x835a6e20348b89831f2d23493f06f9e03a6ce3a3/1096-2cf0a0d890a4021f', source: 'marketplace' },
    1097: { url: 'https://images.blur.io/_blur-prod/0x835a6e20348b89831f2d23493f06f9e03a6ce3a3/1097-16ee744c4e3abc05', source: 'marketplace' },
    1098: { url: 'https://images.blur.io/_blur-prod/0x835a6e20348b89831f2d23493f06f9e03a6ce3a3/1098-ee905d33d96f1fe8', source: 'marketplace' },
    1099: { url: 'https://images.blur.io/_blur-prod/0x835a6e20348b89831f2d23493f06f9e03a6ce3a3/1099-8a48a93e21f3bca9', source: 'marketplace' },
    1100: { url: 'https://images.blur.io/_blur-prod/0x835a6e20348b89831f2d23493f06f9e03a6ce3a3/1100-82956dd29654fa96', source: 'marketplace' },
    1101: { url: 'https://images.blur.io/_blur-prod/0x835a6e20348b89831f2d23493f06f9e03a6ce3a3/1101-5662061b02782939', source: 'marketplace' },
    1102: { url: 'https://images.blur.io/_blur-prod/0x835a6e20348b89831f2d23493f06f9e03a6ce3a3/1102-d2fd17fdde0e8037', source: 'marketplace' },
  },
  // Lazy Butts: the whole 3D Kings infrastructure is gone (DNS fails, S3 bucket private).
  // 1600x1600 AVIF from Element, re-encoded from the original medium PNGs.
  '0x869fb8a354a565f7576009a88f2e8b7159a20010': {
    4846: { url: 'https://i.nfte.ai/ia/l1/320674/6057181657845944413_989529791.avif', source: 'marketplace', headers: ELEMENT_UA },
    6080: { url: 'https://i.nfte.ai/ia/l1/320674/1013150075095883232_1910509705.avif', source: 'marketplace', headers: ELEMENT_UA },
    9124: { url: 'https://i.nfte.ai/ia/l1/320674/3670593537330709401_1382646065.avif', source: 'marketplace', headers: ELEMENT_UA },
  },
};

// Never shown on the site. Checked 2026-09-15.
export const HIDDEN = {
  // scam airdrops: empty metadata or links to look-alike phishing domains
  '0x0337c108981c1ab7fbe40d3f55725337f0cdb34c': 'spam: fake Etherants, no metadata',
  '0x4d9ad99d37344ff5c9616a50e0cdfe25cbbd04e5': 'spam: fake Etherants, no metadata',
  '0x52011e2f967d44403da2468935fad6ee183a52d8': 'spam: fake Etherants, no metadata',
  '0x5d6483724710aca43a0fdf9f045eaa436889a3ea': 'spam: fake Etherants, no metadata',
  '0x1e8b360082e657e2e498de7cbe83dbcf0de5a9ce': 'spam: "Reward Club", no metadata',
  '0x2353942cf137f7fdfb54c78b74c600baad58dbf1': 'spam: fake Clipper reward, phishing domain clipperdao.pro',
  '0x80218c741b7065df49fad2978db4ef9dee384f09': 'spam: "Crypto Rings Card", no metadata',
  '0x88a1c7a0d63d65e394f58e06804286bfca82521b': 'spam: "Mint Box Officials", no metadata',
  '0xd8698357ab8da0094f9c75e80882719f44f4d2f3': 'spam: "Mint Pass Origins", no metadata',
  '0xc15e7761f32cadbe5ce6fa5bee60985d23576d4f': 'spam: fake Unisocks, phishing domain unisocks.live',
  '0x495f947276749ce646f68ac8c248420045cb7b5e': 'spam: unsolicited OpenSea Shared Storefront item',
};
