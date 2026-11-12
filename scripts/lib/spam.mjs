// Spam filter shared by the site pipeline (fetch-collection.mjs) and the personal archive.
// Anyone can send an NFT to the owner's wallet, so bait has to be caught before it reaches the site.

// Two lists, because real collections talk about mints and rewards too.
// STRONG – only bait writes this way: a prize sum, a throwaway domain, a link shortener,
// a random tag glued to the name. Checked everywhere, including description and external_url.
export const STRONG_RE = new RegExp(
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
export const WEAK_RE = new RegExp(
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

export const isSpam = (t) => {
  const names = [t.collectionName, t.name].filter(Boolean).join(' ');
  const all = [names, t.description, t.externalUrl].filter(Boolean).join(' ');
  return STRONG_RE.test(all) || WEAK_RE.test(names);
};
