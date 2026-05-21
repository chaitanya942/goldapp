# Live Gold Rates — Developer Prompt

## What this does

Fetches live **Gold 999 (with GST)** sell rates from 3 Indian bullion price broadcast feeds, stores them to a Supabase database every minute, and reads them back for display.

This is what Augmont's `spot.augmont.com/liverates` shows as "Gold with GST". These 3 feeds provide the same underlying market rate.

---

## Data Sources

### 1. Kalinga Kawad (server-side, HTTP GET, every 60s)
```
URL: https://bcast.kalingakawad.com:7768/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/kalingabanglore?_={timestamp}
Headers: { Referer: 'https://kalingakawad.com/', Accept: 'text/plain' }
```
- Returns plain text, one rate per line
- Find the line containing both `GOLD 999` and `WITH GST FOR REF`
- Extract the 3rd number from that line — that is the **sell rate**
- Sanity check: must be > 100000 (gold is always above ₹1 lakh per 10g)

### 2. Ambicaa / RSBL via Firebase (server-side, HTTP GET, every 60s)
```
URL: https://rsbl-spot-gold-silver-prices.firebaseio.com/liverates/GOLDBLR999IND.json
No auth required — Firebase public read
```
- Returns JSON
- Read `.Sell` or `.Ask` field
- Sanity check: must be > 100000

### 3. Aamlin Spot (browser-side WebSocket, truly live / real-time)
```
Socket.IO server: http://starlinebulltech.in:10001
After connect: socket.emit('room', 'aamlinspot')
Listen: 'message' events
```
- Parse `data.Rate[]` array
- Find item where `Symbol` matches regex `/gold\s*999\s*ind/i`
- Read `.Ask` field
- Sanity check: must be > 100000
- **This runs directly in the browser — no server proxy needed**
- Install: `npm install socket.io-client`

---

## Database Schema (Supabase / PostgreSQL)

```sql
CREATE TABLE gold_rates (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  kalinga_sell_rate float,
  ambica_sell_rate  float,
  aamlin_sell_rate  float
);
```

- Kalinga + Ambicaa are inserted together by the server API every minute
- Aamlin updates the latest row's `aamlin_sell_rate` from the browser every minute

---

## Architecture

```
Every 60 seconds:
  Server cron → GET /api/gold-rates
    → fetch Kalinga (HTTP)
    → fetch Ambicaa (Firebase JSON)
    → INSERT one row to gold_rates table

Browser (on page load):
  → Connect socket.io to Aamlin
  → On rate received: UPDATE latest gold_rates row with aamlin_sell_rate
  → Every 60s: SELECT last 60 min of gold_rates rows → display
```

---

## How to Schedule (Railway)

Add this to your Railway project's cron job settings:
```
Command: curl -s -X GET https://your-app.up.railway.app/api/gold-rates -H "Authorization: Bearer YOUR_CRON_SECRET"
Schedule: * * * * *   (every minute)
```

Or in `next.config.mjs` / `vercel.json`:
```json
{ "path": "/api/gold-rates", "schedule": "* * * * *" }
```

---

## Price Format

- All values are **₹ per 10 grams**
- Typical range: ₹88,000 – ₹95,000 (varies with market)
- Indian locale display: `Number(rate).toLocaleString('en-IN')`
- These are **sell rates** (what you buy gold at — includes GST)

---

## Files in this folder

| File | Purpose |
|------|---------|
| `fetch-rates.js` | Standalone Node.js script — run directly with `node fetch-rates.js` |
| `api-route.js` | Next.js App Router API route — drop into `app/api/gold-rates/route.js` |
| `PROMPT.md` | This file — full explanation for developers |

---

## Env Vars Needed

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
CRON_SECRET=any_random_secret_string   # optional but recommended
```
