'use strict';

/**
 * NullThread → Discord sales bot (real-time).
 *
 * Opens a websocket to the OpenSea Stream API, subscribes to the NullThread
 * collection, and on every confirmed sale posts a rich embed (with the NFT
 * image) to a Discord channel webhook. The stream client auto-reconnects.
 *
 * Run:  npm start
 */

require('dotenv').config();
const { OpenSeaStreamClient, Network } = require('@opensea/stream-js');
const { WebSocket } = require('ws');
const { fromStreamEvent, buildDiscordPayload, postToDiscord } = require('./lib');

const {
  OPENSEA_API_KEY,
  DISCORD_WEBHOOK_URL,
  COLLECTION_SLUG = 'nullthread-by-heefleursss',
  CONTRACT_ADDRESS = '0xc1b068f82b4bc552bf27db6a5ec983a89bfcb6d9',
  COLLECTION_NAME = 'NullThread',
  COLLECTION_ICON = 'https://i2c.seadn.io/collection/nullthread-395904459/image_type_logo/2be99ce634baff4fe56a51c9b7d3e4/372be99ce634baff4fe56a51c9b7d3e4.gif',
  EMBED_COLOR = '0xF4A340',
} = process.env;

if (!OPENSEA_API_KEY || !DISCORD_WEBHOOK_URL) {
  console.error('✖ Missing OPENSEA_API_KEY or DISCORD_WEBHOOK_URL. Copy .env.example to .env and fill them in.');
  process.exit(1);
}

const opts = {
  contract: CONTRACT_ADDRESS,
  collectionName: COLLECTION_NAME,
  collectionSlug: COLLECTION_SLUG,
  collectionIcon: COLLECTION_ICON || undefined,
  color: Number(EMBED_COLOR),
};

const client = new OpenSeaStreamClient({
  token: OPENSEA_API_KEY,
  network: Network.MAINNET,
  connectOptions: { transport: WebSocket },
  onError: (err) => console.error('[stream error]', err?.message || err),
});

// De-dupe guard: the same sale can occasionally be delivered twice.
const seen = new Set();
function alreadyPosted(key) {
  if (!key) return false;
  if (seen.has(key)) return true;
  seen.add(key);
  if (seen.size > 1000) seen.delete(seen.values().next().value); // bound memory
  return false;
}

client.onItemSold(COLLECTION_SLUG, async (event) => {
  try {
    const sale = fromStreamEvent(event.payload);
    const key = sale.txHash || `${sale.tokenId}:${sale.timestampSec}`;
    if (alreadyPosted(key)) return;

    const payload = await buildDiscordPayload(sale, opts);
    await postToDiscord(DISCORD_WEBHOOK_URL, payload);
    console.log(`✓ posted ${sale.name} — ${sale.priceWei} wei ${sale.symbol}`);
  } catch (e) {
    console.error('[handler error]', e.message);
  }
});

client.connect();
console.log(`🧵 NullThread sales bot live — watching "${COLLECTION_SLUG}" for sales…`);

function shutdown() {
  console.log('shutting down…');
  try { client.disconnect(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
