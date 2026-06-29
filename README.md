# 🧵 NullThread → Discord Sales Bot

Auto-posts a rich embed to a Discord channel **every time a NullThread NFT sells on OpenSea** — big NFT image, price in ETH + USD, buyer/seller, tier, and an Etherscan link. Real-time, via the OpenSea Stream API.

- **Collection:** NullThread by heefleursss
- **Contract:** `0xc1b068f82b4bc552bf27db6a5ec983a89bfcb6d9` (Ethereum, ERC-721)
- **Slug:** `nullthread-by-heefleursss`

---

## 1. Get your two keys

**OpenSea API key** — instant, no signup:
```bash
curl -X POST https://api.opensea.io/api/v2/auth/keys
```
Copy the `api_key` value. (Need higher limits later → https://opensea.io/settings/developer)

**Discord webhook URL** — in Discord:
`Your channel → Edit Channel (⚙) → Integrations → Webhooks → New Webhook → Copy Webhook URL`.
Name it whatever you like (e.g. `NullThread Sales`) and pick the channel the feed should post to.

---

## 2. Configure

```bash
cp .env.example .env
```
Open `.env` and paste in `OPENSEA_API_KEY` and `DISCORD_WEBHOOK_URL`. Everything else is pre-filled for NullThread.

```bash
npm install
```

---

## 3. Test it now (no waiting for a real sale)

This pulls the **most recent real NullThread sale** and pushes it through the exact same code path the live bot uses:

```bash
npm run test:dry    # prints the Discord JSON — posts nothing
npm run test:post   # posts that sale to your Discord channel
```
If `test:post` lands a clean embed with the NFT image in your channel, the pipeline works end to end.

---

## 4. Run it live

```bash
npm start
```
It opens a websocket to OpenSea and posts each new sale as it happens. Leave it running.

---

## 5. Deploy (keep it always-on)

The live bot holds an open websocket, so it needs an **always-on host** — *not* Vercel serverless (functions sleep and the socket dies). Easiest options:

### Railway (recommended — closest to the Vercel workflow)
1. Push this folder to a GitHub repo.
2. railway.app → **New Project → Deploy from GitHub repo**.
3. **Variables** tab → add `OPENSEA_API_KEY` and `DISCORD_WEBHOOK_URL` (and any overrides).
4. Railway runs `npm start` automatically. Done.

### Fly.io
```bash
fly launch --no-deploy        # generates fly.toml
fly secrets set OPENSEA_API_KEY=xxx DISCORD_WEBHOOK_URL=xxx
fly deploy
```

### Any VPS / Raspberry Pi (pm2 keeps it alive + auto-restarts)
```bash
npm i -g pm2
pm2 start bot.js --name nullthread-sales
pm2 save && pm2 startup
```

---

## Reuse for any other collection
Change `COLLECTION_SLUG`, `CONTRACT_ADDRESS`, `COLLECTION_NAME`, and `COLLECTION_ICON` in `.env`. Tweak `EMBED_COLOR` (hex, `0x` prefix) to match the collection's brand.

## Files
| File | What it does |
|------|--------------|
| `bot.js` | Live websocket listener → posts each sale to Discord |
| `test.js` | Replays the latest real sale to verify the pipeline |
| `lib.js` | Normalizers + Discord embed builder + webhook poster |
| `.env.example` | Config template |

## Notes
- USD is computed from each token's spot price; if a price lookup ever fails the post still goes out with the ETH amount.
- Sales priced in WETH (OpenSea offers/bids) are shown with the `WETH` symbol — same value as ETH.
- The bot de-dupes by transaction hash so a sale is never double-posted.
