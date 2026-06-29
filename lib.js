'use strict';

/**
 * Shared helpers for the NullThread sales bot.
 *
 * Two data sources feed the SAME embed builder:
 *   - fromStreamEvent()  -> OpenSea Stream API "item_sold" payload (real-time, bot.js)
 *   - fromEventsApi()    -> OpenSea Events API "sale" object       (replay/test, test.js)
 *
 * Both normalize into one `sale` shape so the Discord embed looks identical
 * whether it came from a live websocket push or a replayed historical sale.
 */

// --- tiny formatting helpers ---------------------------------------------

function shortAddr(addr) {
  if (!addr) return 'unknown';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`; // 0x1234…abcd
}

// wei string -> Number of tokens, using BigInt so we never lose precision
function weiToTokens(weiStr, decimals = 18) {
  try {
    const wei = BigInt(weiStr);
    const base = 10n ** BigInt(decimals);
    const whole = wei / base;
    const frac = (wei % base).toString().padStart(decimals, '0').replace(/0+$/, '');
    return Number(`${whole}.${frac || '0'}`);
  } catch {
    return Number(weiStr) / 10 ** decimals;
  }
}

// up to `max` decimals, no trailing zeros: 0.025000 -> "0.025"
function trimNum(n, max = 5) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return parseFloat(Number(n).toFixed(max)).toString();
}

// ETH/USD with a 60s cache and graceful fallback (no API key required).
let _ethUsd = { v: null, t: 0 };
async function getEthUsd() {
  if (_ethUsd.v && Date.now() - _ethUsd.t < 60_000) return _ethUsd.v;
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
    );
    const j = await r.json();
    const v = j?.ethereum?.usd ?? null;
    if (v) _ethUsd = { v, t: Date.now() };
    return v;
  } catch {
    return null; // USD is a nice-to-have; never block a post on it
  }
}

// --- normalizers ----------------------------------------------------------

// OpenSea Stream API `item_sold` -> normalized sale
function fromStreamEvent(payload = {}) {
  const item = payload.item || {};
  const meta = item.metadata || {};
  const pt = payload.payment_token || {};
  const tokenId = String(item.nft_id || '').split('/').pop();
  return {
    tokenId,
    name: meta.name || `#${tokenId}`,
    imageUrl: meta.image_url || meta.image || null,
    permalink: item.permalink || null,
    collectionSlug: payload.collection?.slug || null,
    priceWei: payload.sale_price,
    decimals: pt.decimals ?? 18,
    symbol: pt.symbol || 'ETH',
    usdPerToken: pt.usd_price ? Number(pt.usd_price) : null,
    seller: payload.maker?.address || null,
    buyer: payload.taker?.address || null,
    txHash: payload.transaction?.hash || null,
    timestampSec: payload.closing_date || payload.transaction?.timestamp || null,
    traits: null, // stream payload doesn't carry traits; tier shown when present
  };
}

// OpenSea Events API `sale` event -> normalized sale
function fromEventsApi(ev = {}) {
  const nft = ev.nft || {};
  const pay = ev.payment || {};
  return {
    tokenId: nft.identifier,
    name: nft.name || `#${nft.identifier}`,
    imageUrl: nft.display_image_url || nft.image_url || null,
    permalink: nft.opensea_url || null,
    collectionSlug: nft.collection || null,
    priceWei: pay.quantity,
    decimals: pay.decimals ?? 18,
    symbol: pay.symbol || 'ETH',
    usdPerToken: null,
    seller: ev.seller || null,
    buyer: ev.buyer || null,
    txHash: ev.transaction || null,
    timestampSec: ev.event_timestamp || ev.closing_date || null,
    traits: Array.isArray(nft.traits) ? nft.traits : null,
  };
}

// --- Discord embed --------------------------------------------------------

async function buildDiscordPayload(sale, opts = {}) {
  const tokens = weiToTokens(sale.priceWei, sale.decimals);
  const symbol = (sale.symbol || 'ETH').toUpperCase();
  const isEthLike = symbol === 'ETH' || symbol === 'WETH';

  // USD: prefer the token's own usd_price (Stream API); else convert ETH-like via spot price
  let usd = null;
  if (sale.usdPerToken) usd = tokens * sale.usdPerToken;
  else if (isEthLike) {
    const spot = await getEthUsd();
    if (spot) usd = tokens * spot;
  }
  const usdStr = usd
    ? `$${usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
    : null;

  // rarity / tier from traits when available
  let tier = null;
  if (Array.isArray(sale.traits)) {
    const t = sale.traits.find((x) => /rarity|tier/i.test(x.trait_type || ''));
    if (t) tier = t.value;
  }

  const pricePrefix = isEthLike ? 'Ξ ' : ''; // Ξ
  const assetUrl =
    sale.permalink ||
    (opts.contract && sale.tokenId
      ? `https://opensea.io/assets/ethereum/${opts.contract}/${sale.tokenId}`
      : `https://opensea.io/collection/${opts.collectionSlug || sale.collectionSlug}`);

  const fields = [
    {
      name: 'Price',
      value: `${pricePrefix}**${trimNum(tokens)}** ${sale.symbol}${usdStr ? `\n\`${usdStr}\`` : ''}`,
      inline: true,
    },
  ];
  if (tier) fields.push({ name: 'Tier', value: `\`${tier}\``, inline: true });
  fields.push({ name: '​', value: '​', inline: true }); // grid spacer

  fields.push({
    name: 'Seller',
    value: sale.seller ? `[${shortAddr(sale.seller)}](https://opensea.io/${sale.seller})` : 'unknown',
    inline: true,
  });
  fields.push({
    name: 'Buyer',
    value: sale.buyer ? `[${shortAddr(sale.buyer)}](https://opensea.io/${sale.buyer})` : 'unknown',
    inline: true,
  });
  fields.push({ name: '​', value: '​', inline: true }); // grid spacer

  if (sale.txHash) {
    fields.push({
      name: 'Transaction',
      value: `[View on Etherscan](https://etherscan.io/tx/${sale.txHash})`,
      inline: false,
    });
  }

  const embed = {
    author: {
      name: opts.collectionName || 'NullThread',
      url: `https://opensea.io/collection/${opts.collectionSlug || sale.collectionSlug || ''}`,
      ...(opts.collectionIcon ? { icon_url: opts.collectionIcon } : {}),
    },
    title: `${sale.name} — SOLD`,
    url: assetUrl,
    color: typeof opts.color === 'number' ? opts.color : 0xf4a340, // amber
    fields,
    ...(sale.imageUrl ? { image: { url: sale.imageUrl } } : {}),
    footer: { text: `OpenSea · ${opts.collectionName || 'NullThread'} sales` },
    timestamp: sale.timestampSec
      ? new Date(sale.timestampSec * 1000).toISOString()
      : new Date().toISOString(),
  };

  return {
    username: opts.botName || `${opts.collectionName || 'NullThread'} Sales`,
    ...(opts.collectionIcon ? { avatar_url: opts.collectionIcon } : {}),
    embeds: [embed],
  };
}

// POST to a Discord channel webhook, with one polite retry on rate-limit (429).
async function postToDiscord(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 429) {
    const j = await res.json().catch(() => ({}));
    const waitMs = ((j.retry_after ?? 1) * 1000) + 250;
    await new Promise((r) => setTimeout(r, waitMs));
    return postToDiscord(webhookUrl, payload);
  }
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord webhook failed: ${res.status} ${body}`);
  }
  return true;
}

module.exports = {
  shortAddr,
  weiToTokens,
  trimNum,
  getEthUsd,
  fromStreamEvent,
  fromEventsApi,
  buildDiscordPayload,
  postToDiscord,
};
