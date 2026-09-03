// app/api/gold-news/route.js
// Read-only Gold News feed (V1) — DIRECT RSS AGGREGATOR.
//
// ISOLATION: this route is deliberately standalone. It does NOT touch Supabase,
// the OLD/NEW CRMs, purchases, consignments, cal_quotas, ClearTax, goldapp-cron,
// or any database. Its ONLY external dependency is public RSS from reputable
// publishers/institutions, reached over HTTPS with NO API key. A failure here
// can never affect any operational module — worst case is an empty news list.
//
// Google News RSS was removed: it returned HTTP 429 / consent HTML to Railway's
// datacenter IP. This aggregator reads direct publisher/institution feeds that
// serve normal clients. No Google News request remains. No API key. No scraping.
//
// Parser: intentionally dependency-free (no XML lib). Handles RSS <item> and
// Atom <entry>, common date/description variants, CDATA, entities, whitespace.

import { requireAuthForPage } from '../../../lib/apiAuth'

// ── Feed registry (direct publisher / institution RSS) ──────────────────────
// goldFocused feeds are already gold-scoped, so broad categories accept all
// their items; non-goldFocused feeds must pass gold-relevance for broad
// categories. `source` is the fallback attribution when an item lacks its own.
const FEEDS = {
  bl_gold:   { url: 'https://www.thehindubusinessline.com/markets/gold/feeder/default.rss', source: 'BusinessLine',          goldFocused: true  },
  livemint:  { url: 'https://www.livemint.com/rss/markets',                                 source: 'Mint',                  goldFocused: false },
  fed:       { url: 'https://www.federalreserve.gov/feeds/press_monetary.xml',              source: 'Federal Reserve',       goldFocused: false },
  rbi:       { url: 'https://www.rbi.org.in/pressreleases_rss.xml',                         source: 'Reserve Bank of India', goldFocused: false },
  investing: { url: 'https://www.investing.com/rss/news_11.rss',                            source: 'Investing.com',         goldFocused: false },
}

// ── Relevance vocabularies ──────────────────────────────────────────────────
// Broad categories (latest/india/global) require an explicit GOLD term so the
// feed stays gold — pure macro/FX items are NOT enough here (they belong to
// Fed & Macro). Items from a goldFocused feed pass by design.
const GOLD_TERMS = [
  'gold', 'bullion', 'xau', 'mcx', 'precious metal', 'sovereign gold bond', 'sgb',
  'gold etf', 'gold reserve', 'gold import', 'gold recycl', 'recycled gold', 'scrap gold',
  'jewellery', 'jewelry', 'hallmark', 'gold loan', 'gold demand', 'gold price', 'gold rate',
  'gold futures', 'gold bond', 'gold monetis', 'gold monetiz',
]
// Fed & Macro gates on macro drivers (these directly move gold); an item need
// not mention gold to qualify.
const FED_TERMS = [
  'federal reserve', 'the fed', "fed's", 'fomc', 'powell', 'monetary policy', 'interest rate',
  'rate cut', 'rate hike', 'rate decision', 'treasury yield', 'bond yield',
  'us dollar', 'dollar index', 'dxy', 'inflation', 'cpi', 'pce', 'payroll', 'jackson hole',
]
// Central Banks: must be gold IN a central-bank context — this deliberately
// excludes generic RBI/Fed regulatory items (repo auctions, enforcement, etc.).
const CB_BANK_TOKENS = [
  'central bank', 'reserve bank', 'rbi', 'pboc', 'ecb', 'bank of england', 'imf',
  'reserves', 'tonne', 'tonnes',
]
const centralBankGate = (hay) => hay.includes('gold') && CB_BANK_TOKENS.some(t => hay.includes(t))
// Gold Recycling: gold-specific recycling / jewellery / demand phrases only, so
// unrelated items (a stray "import"/"scrap" in a description) don't leak in.
const RECYCLE_TERMS = [
  'gold recycl', 'recycled gold', 'scrap gold', 'gold scrap', 'jewellery', 'jewelry',
  'gold demand', 'gold import', 'gold loan', 'sovereign gold bond', 'sgb', 'gold monetis',
  'gold monetiz', 'hallmark', 'old gold', 'pledged gold', 'gold jewellery',
]

// ── Category model ──────────────────────────────────────────────────────────
// `require` gates a specialised category: an array (match any term) or a
// predicate(hay)->bool. When null, the broad gold-relevance gate applies.
const CATEGORIES = {
  latest:        { label: 'Latest',         feeds: ['bl_gold', 'livemint', 'investing'], require: null },
  india:         { label: 'India',          feeds: ['bl_gold', 'livemint', 'rbi'],       require: null },
  global:        { label: 'Global',         feeds: ['bl_gold', 'investing'],             require: null },
  fed_macro:     { label: 'Fed & Macro',    feeds: ['fed', 'bl_gold'],                   require: FED_TERMS },
  central_banks: { label: 'Central Banks',  feeds: ['bl_gold', 'rbi', 'fed'],            require: centralBankGate },
  recycling:     { label: 'Gold Recycling', feeds: ['bl_gold', 'livemint', 'rbi'],       require: RECYCLE_TERMS },
}
const DEFAULT_CATEGORY = 'latest'

const CACHE_TTL_MS = 10 * 60 * 1000
const FEED_TIMEOUT_MS = 8000
const MAX_ARTICLES = 12
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const feedCache = new Map()     // feed url -> { items, ts }
const categoryCache = new Map() // category  -> { data, ts }

// ── Text cleaners ───────────────────────────────────────────────────────────
function decodeEntities(str) {
  if (!str) return ''
  return str
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)) } catch { return '' } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)) } catch { return '' } })
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
}
const stripHtml = (s) => (s ? s.replace(/<[^>]*>/g, ' ') : '')
const unwrapCdata = (s) => { const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s || ''); return m ? m[1] : (s || '') }
const clean = (s) => decodeEntities(stripHtml(decodeEntities(unwrapCdata(String(s || ''))))).replace(/\s+/g, ' ').trim()

// First <tag ...>inner</tag> content (namespaced names like content:encoded ok).
function tagContent(block, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block)
  return m ? m[1] : ''
}
function firstNonEmpty(block, tags) {
  for (const t of tags) { const v = clean(tagContent(block, t)); if (v) return v }
  return ''
}
// Link works for RSS (<link>url</link>) and Atom (<link href="url" .../>).
function extractLink(block) {
  const text = clean(tagContent(block, 'link'))
  if (text) return text
  const hrefs = [...block.matchAll(/<link\b([^>]*)>/gi)].map(m => m[1])
  const pick = hrefs.find(a => /rel=["']alternate["']/i.test(a)) || hrefs.find(a => !/rel=["']self["']/i.test(a)) || hrefs[0]
  if (pick) { const h = /href=["']([^"']+)["']/i.exec(pick); if (h) return decodeEntities(h[1]).trim() }
  return ''
}

function parseFeed(xml, feed) {
  const isAtom = /<entry\b/i.test(xml) && !/<item\b/i.test(xml)
  const blockRe = isAtom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi
  const out = []
  let m
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[0]
    const title = clean(tagContent(block, 'title'))
    const url = extractLink(block)
    if (!title || !url) continue
    const rawDate = firstNonEmpty(block, ['pubDate', 'dc:date', 'published', 'updated', 'date'])
    let published_at = null
    if (rawDate) { const d = new Date(rawDate); if (!Number.isNaN(d.getTime())) published_at = d.toISOString() }
    let description = firstNonEmpty(block, ['description', 'summary', 'content:encoded', 'content'])
    if (description && description.toLowerCase().startsWith(title.toLowerCase())) description = ''
    if (description.length > 300) description = description.slice(0, 297).trimEnd() + '…'
    const itemSource = clean(tagContent(block, 'source'))
    out.push({
      id: url,
      title,
      description,
      url,
      source: itemSource || feed.source,
      published_at,
      image: null,
      _goldFocused: feed.goldFocused,
    })
  }
  return out
}

// Fetch + validate one feed. Throws if the response is not a healthy feed
// (bad status, non-feed body, or zero parsed items) so it is NOT counted as
// a successful/empty feed.
async function fetchAndParse(feed) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    })
    if (!res.ok) throw new Error(`http_${res.status}`)
    const body = await res.text()
    if (!/<rss\b|<feed\b|<item\b|<entry\b/i.test(body)) throw new Error('not_a_feed')
    const items = parseFeed(body, feed)
    if (items.length === 0) throw new Error('empty_feed')
    return items
  } finally {
    clearTimeout(timer)
  }
}

// Cached feed fetch: fresh cache → reuse; on failure → serve stale cache if any,
// else rethrow so the feed counts as failed.
async function getFeedItems(key) {
  const feed = FEEDS[key]
  const cached = feedCache.get(feed.url)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.items
  try {
    const items = await fetchAndParse(feed)
    feedCache.set(feed.url, { items, ts: Date.now() })
    return items
  } catch (err) {
    if (cached) return cached.items // transient failure — reuse last good items
    throw err
  }
}

function passesFilters(item, conf) {
  // Match on the HEADLINE only. Publisher feed descriptions often carry stray
  // "also read" link blocks that cause false positives; the title is the clean
  // relevance signal.
  const hay = item.title.toLowerCase()
  if (typeof conf.require === 'function') return conf.require(hay)
  if (Array.isArray(conf.require)) return conf.require.some(t => hay.includes(t))
  // Broad category: keep it gold-relevant. Gold-focused feeds pass by design.
  if (item._goldFocused) return true
  return GOLD_TERMS.some(t => hay.includes(t))
}

// Build one category. Returns { articles, rawCount, feedsOk, feedsTotal }.
// Throws 'all_feeds_failed' only when EVERY mapped feed failed (no items at all).
async function buildCategory(categoryKey) {
  const conf = CATEGORIES[categoryKey] || CATEGORIES[DEFAULT_CATEGORY]
  const settled = await Promise.allSettled(conf.feeds.map(getFeedItems))
  const ok = settled.filter(s => s.status === 'fulfilled')
  if (ok.length === 0) throw new Error('all_feeds_failed')

  const merged = ok.flatMap(s => s.value)
  const relevant = merged.filter(a => passesFilters(a, conf))

  // De-duplicate by canonical url AND normalized title.
  const seenUrl = new Set(), seenTitle = new Set(), deduped = []
  for (const a of relevant) {
    const uk = (a.url || '').split('?')[0].replace(/\/$/, '')
    const tk = a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (uk && seenUrl.has(uk)) continue
    if (tk && seenTitle.has(tk)) continue
    if (uk) seenUrl.add(uk)
    if (tk) seenTitle.add(tk)
    deduped.push(a)
  }

  deduped.sort((a, b) => {
    const ta = a.published_at ? new Date(a.published_at).getTime() : 0
    const tb = b.published_at ? new Date(b.published_at).getTime() : 0
    return tb - ta
  })

  // Strip internal marker before returning.
  const articles = deduped.slice(0, MAX_ARTICLES).map(({ _goldFocused, ...rest }) => rest)
  return { articles, rawCount: merged.length, feedsOk: ok.length, feedsTotal: conf.feeds.length }
}

export async function GET(req) {
  // Delegable page permission: super_admin keeps god-mode; a role granted
  // page.gold-news in Role Management is accepted; falls back to static
  // ROLE_PAGES for roles without DB rows.
  const auth = await requireAuthForPage(req, 'gold-news')
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const requested = searchParams.get('category') || DEFAULT_CATEGORY
  const category = CATEGORIES[requested] ? requested : DEFAULT_CATEGORY

  const cached = categoryCache.get(category)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return Response.json({ ...cached.data, cached: true })
  }

  try {
    const { articles, rawCount, feedsOk, feedsTotal } = await buildCategory(category)

    if (articles.length > 0) {
      const data = {
        category,
        articles,
        count: articles.length,
        updated_at: new Date().toISOString(),
        error: null,
        partial: feedsOk < feedsTotal || undefined,
      }
      categoryCache.set(category, { data, ts: Date.now() }) // cache only real content
      return Response.json(data)
    }

    // Feeds responded but produced no relevant stories. This is a LEGITIMATE
    // empty result — not a provider failure. Do NOT overwrite good stale cache
    // and do NOT cache the empty (so the next request re-checks); rawCount>0
    // proves parsing worked.
    void rawCount
    if (cached) return Response.json({ ...cached.data, cached: true, stale: true })
    return Response.json({ category, articles: [], count: 0, updated_at: new Date().toISOString(), error: null })
  } catch {
    // Every feed failed. Never cache this as an empty success. Prefer good
    // stale cache; otherwise surface a real error state to the UI.
    if (cached) return Response.json({ ...cached.data, cached: true, stale: true })
    return Response.json({ category, articles: [], count: 0, updated_at: null, error: 'provider_error' })
  }
}
