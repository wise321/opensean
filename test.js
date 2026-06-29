'use strict';

/**
 * Pipeline tester. Pulls the most recent REAL NullThread sale from the
 * OpenSea Events API and runs it through the exact same embed builder the
 * live bot uses — so you can confirm the Discord post (and image) look right
 * without waiting for an organic sale.
 *
 *   npm run test:post   -> posts the latest sale to your Discord webhook
 *   npm run test:dry    -> prints the Discord JSON payload, posts nothing
 */

require('dotenv').config();
const { fromEventsApi, buildDiscordPayload, postToDiscord } = require('./lib');

const {
  OPENSEA_API_KEY,
  DISCORD_WEBHOOK_URL,
  COLLECTION_SLUG = 'nullthread-by-heefleursss',
  CONTRACT_ADDRESS = '0xc1b068f82b4bc552bf27db6a5ec983a89bfcb6d9',
  COLLECTION_NAME = 'NullThread',
  COLLECTION_ICON = 'https://i2c.seadn.io/collection/nullthread-395904459/image_type_logo/2be99ce634baff4fe56a51c9b7d3e4/372be99ce634baff4fe56a51c9b7d3e4.gif',
  EMBED_COLOR = '0xF4A340',
} = process.env;

const dry = process.argv.includes('--dry');

async function main() {
  if (!OPENSEA_API_KEY) throw new Error('Missing OPENSEA_API_KEY');
  if (!dry && !DISCORD_WEBHOOK_URL) throw new Error('Missing DISCORD_WEBHOOK_URL');

  const url = `https://api.opensea.io/api/v2/events/collection/${COLLECTION_SLUG}?event_type=sale&limit=1`;
  const res = await fetch(url, { headers: { 'X-API-KEY': OPENSEA_API_KEY } });
  if (!res.ok) throw new Error(`OpenSea events fetch failed: ${res.status}`);
  const data = await res.json();
  const ev = data.asset_events?.[0];
  if (!ev) return console.log('No recent sales found to replay.');

  const sale = fromEventsApi(ev);
  const opts = {
    contract: CONTRACT_ADDRESS,
    collectionName: COLLECTION_NAME,
    collectionSlug: COLLECTION_SLUG,
    collectionIcon: COLLECTION_ICON || undefined,
    color: Number(EMBED_COLOR),
  };
  const payload = await buildDiscordPayload(sale, opts);

  if (dry) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  await postToDiscord(DISCORD_WEBHOOK_URL, payload);
  console.log(`✅ Posted test sale to Discord: ${sale.name}`);
}

main().catch((e) => {
  console.error('✖', e.message);
  process.exit(1);
});
