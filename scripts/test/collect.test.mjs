// Guards for the collection scripts: anyone can send an NFT to the wallet, so its metadata is hostile input.
// Run: npm test (node's built-in runner, no network: fetch is stubbed where a request would be made)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { assertPublicUrl, fileId, slugify, fetchWithFallback, MAX_BYTES } from '../lib/media.mjs';
import { isSpam } from '../lib/spam.mjs';

test('local and private hosts are refused', () => {
  for (const bad of ['http://localhost:8080/x', 'http://127.0.0.1/x', 'http://192.168.1.1/cam.jpg', 'http://10.0.0.5/', 'http://172.20.1.1/',
    'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://router/', 'http://nas.local/a.png',
    'file:///etc/passwd', 'javascript:alert(1)'])
    assert.throws(() => assertPublicUrl(bad), undefined, bad);
  for (const good of ['https://ipfs.io/ipfs/Qm', 'https://images.blur.io/x', 'http://example.com/a.png']) assert.doesNotThrow(() => assertPublicUrl(good));
});

test('no request reaches a private host', async () => {
  let hits = 0;
  const server = http.createServer((req, res) => (hits++, res.end('no')));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(fetchWithFallback(`http://127.0.0.1:${server.address().port}/`, { tries: 1, timeout: 2000 }), /blocked private address/);
    assert.equal(hits, 0);
  } finally {
    server.close();
  }
});

test('redirect to a private host and oversized answers are refused', async (t) => {
  const real = globalThis.fetch;
  t.after(() => (globalThis.fetch = real));
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'http://192.168.1.1/cam.jpg' } });
  await assert.rejects(fetchWithFallback('https://evil.example/a.png', { tries: 1, timeout: 2000 }), /blocked private address/);
  globalThis.fetch = async () => new Response('x', { status: 200, headers: { 'content-length': String(MAX_BYTES + 1) } });
  await assert.rejects(fetchWithFallback('https://big.example/a.png', { tries: 1, timeout: 2000 }), /too large/);
  await assert.rejects(fetchWithFallback('data:image/png;base64,' + 'A'.repeat(Math.ceil(MAX_BYTES * 1.4) + 8)), /too large/);
});

test('long token ids that share 40 digits get different files', () => {
  assert.notEqual(fileId('1319319896042156330065111690264448072945660751603'), fileId('1319319896042156330065111690264448072945999999999'));
  assert.equal(fileId('4230'), '4230');
});

test('spam filter catches bait and passes real collections', () => {
  for (const t of [{ collectionName: 'NFTCard', name: 'Card worth 2200 USDT' }, { name: 'Lucky box', description: 'claim your rewards at win-eth.click' },
    { collectionName: 'ETH CTIY [lCz2mp1Z] 1697914666891' }, { name: 'Visit', externalUrl: 'https://bit.ly/xyz' }])
    assert.equal(isSpam(t), true, JSON.stringify(t));
  for (const t of [{ collectionName: 'Lazy Lions', name: 'Lazy Lion #5597' }, { collectionName: 'DegenToonz', name: 'Toonz #4230', description: 'A degen cartoon' }])
    assert.equal(isSpam(t), false, t.collectionName);
});

test('slugs: Latin only, empty for names without it', () => {
  assert.equal(slugify('Lazy Lions Bungalows'), 'lazy-lions-bungalows');
  assert.equal(slugify('Café Crème'), 'cafe-creme');
  assert.equal(slugify('Мишки'), '');
  assert.equal(slugify('🦁🦁'), '');
});
