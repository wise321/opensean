'use strict';

/**
 * No-host sales poller — runs on GitHub Actions (free) on a timer.
 * Reads a watermark, asks OpenSea for newer sales, posts new ones to Discord,
 * writes the watermark back. Zero npm deps — Node 18+ fetch + ./lib only.
 */

const fs = require('fs');
const path = require('path');
const { fromEventsApi, buildDiscordPayload, postToDiscord } = require('./lib');

const {
  OPENSEA_API_KEY,
  DISCORD_WEBHOOK_URL,
  COLLECTION_SLUG = 'nullthread-by-heefleursss',
  CONTRACT_ADDRESS = '0xc1b068f82b4bc552bf27db6a5ec983a89bfcb6d9',
  COLLECTION_NAME = 'NullThread',
  COLLECTION_ICON = 'https://i2c.seadn.io/collection/nullthread-395904459/image_type_logo/2be99ce634baff4fe56a51c9b7d3e4/372be99ce634baff4fe56a51c9b7d3e4.gif',
  EMBED_COLOR = '0xF4A340',
  LOOKBACK_MINUTES = '60', // first-run backfill window; set 0 to start clean
} = process.env;

const DRY = process.env.DRY_RUN === '1';
const STATE_FILE = path.join(__dirname, 'state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastTimestamp: 0, seen: [] };
  }
}

function saveState(state) {
  state.seen = state.seen.slice(-300);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

async function main() {
  if (!OPENSEA_API_KEY) throw new Error('Missing OPENSEA_API_KEY');
  if (!DRY && !DISCORD_WEBHOOK_URL) throw new Error('Missing DISCORD_WEBHOOK_URL');

  const state = loadState();
  const nowSec = Math.floor(Date.now() / 1000);
  const after = state.lastTimestamp || nowSec - Number(LOOKBACK_MINUTES) * 60;

  const url = `https://api.opensea.io/api/v2/events/collection/${COLLECTION_SLUG}?event_type=sale&after=${after}&limit=50`;
  const res = await fetch(url, { headers: { 'X-API-KEY': OPENSEA_API_KEY } });
  if (!res.ok) throw new Error(`OpenSea events fetch failed: ${res.status}`);
  const data = await res.json();

  const events = (data.asset_events || []).sort(
    (a, b) => (a.event_timestamp || 0) - (b.event_timestamp || 0)
  );

  const opts = {
    contract: CONTRACT_ADDRESS,
    collectionName: COLLECTION_NAME,
    collectionSlug: COLLECTION_SLUG,
    collectionIcon: COLLECTION_ICON || undefined,
    color: Number(EMBED_COLOR),
  };

  let posted = 0;
  let watermark = state.lastTimestamp || 0;

  for (const ev of events) {
    const sale = fromEventsApi(ev);
    const key = sale.txHash || `${sale.tokenId}:${sale.timestampSec}`;
    if (state.seen.includes(key)) continue;

    const payload = await buildDiscordPayload(sale, opts);
    if (DRY) {
      console.log(`[dry] would post ${sale.name} — ${sale.priceWei} wei ${sale.symbol}`);
    } else {
      await postToDiscord(DISCORD_WEBHOOK_URL, payload);
      await new Promise((r) => setTimeout(r, 400));
    }
    state.seen.push(key);
    posted++;
    if (sale.timestampSec && sale.timestampSec > watermark) watermark = sale.timestampSec;
  }

  state.lastTimestamp = Math.max(watermark, after);
  if (!DRY) saveState(state);

  console.log(`Done. ${DRY ? 'Would post' : 'Posted'} ${posted} new sale(s). Watermark=${state.lastTimestamp}`);
}

main().catch((e) => {
  console.error('✖', e.message);
  process.exit(1);
});
