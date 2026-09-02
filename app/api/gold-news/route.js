// app/api/gold-news/route.js
// Read-only Gold News feed (V1) — RSS provider.
//
// ISOLATION: this route is deliberately standalone. It does NOT touch Supabase,
// the OLD/NEW CRMs, purchases, consignments, cal_quotas, ClearTax, goldapp-cron,
// or any database. Its ONLY external dependency is public RSS (Google News RSS
// search feeds), reached over HTTPS with NO API key. A failure here can never
// affect any operational module — the worst case is an empty Gold News list.
//
// Provider: Google News RSS search (https://news.google.com/rss/search). No
// credential required. Feeds are defined per category below. To change/extend
// sources, edit CATEGORIES — nothing else in the app depends on the provider.
//
// Parser: intentionally dependency-free. Google News RSS is well-formed and
// stable, so a small tag extractor is safer than pulling in an XML library.

import { requireAuthForPage } from '../../../lib/apiAuth'

// ── Category → RSS feed definitions ─────────────────────────────────────────
// Each category is one or more Google News RSS search queries. Multiple feeds
// per category are supported (results are merged + de-duplicated). `hl/gl/ceid`
// pick the locale (India vs US editions). No credentials — RSS needs none.
const CATEGORIES = {
  latest: {
    label: 'Latest',
    feeds: [
      { q: 'gold OR XAUUSD OR bullion price', hl: 'en-IN', gl: 'IN', ceid: 'IN:en' },
    ],
  },
  india: {
    label: 'India',
    feeds: [
      { q: 'India gold price OR MCX gold OR gold rate India', hl: 'en-IN', gl: 'IN', ceid: 'IN:en' },
    ],
  },
  global: {
    label: 'Global',
    feeds: [
      { q: 'gold price OR bullion OR XAUUSD OR spot gold OR gold ETF', hl: 'en-US', gl: 'US', ceid: 'US:en' },
    ],
  },
  fed_macro: {
    label: 'Fed & Macro',
    feeds: [
      { q: 'gold Federal Reserve OR Treasury yields OR US dollar OR inflation', hl: 'en-US', gl: 'US', ceid: 'US:en' },
    ],
  },
  central_banks: {
    label: 'Central Banks',
    feeds: [
      { q: 'central bank gold purchases OR gold reserves OR RBI gold', hl: 'en-US', gl: 'US', ceid: 'US:en' },
    ],
  },
  recycling: {
    label: 'Gold Recycling',
    feeds: [
      { q: 'India gold recycling OR scrap gold OR gold jewellery demand', hl: 'en-IN', gl: 'IN', ceid: 'IN:en' },
    ],
  },
}

const DEFAULT_CATEGORY = 'latest'

// ── Relevance gate ──────────────────────────────────────────────────────────
// Gold News must not drift into a generic feed. Keep an article only if its
// title or description mentions something materially tied to gold or a macro
// driver that directly moves gold. Conservative allowlist.
const RELEVANCE_TERMS = [
  'gold', 'bullion', 'xau', 'mcx', 'ounce', 'precious metal',
  'federal reserve', 'the fed', 'treasury yield', 'us dollar', 'dollar index',
  'inflation', 'central bank', 'gold reserves', 'gold etf',
  'gold recycling', 'scrap gold', 'jewellery', 'jewelry', 'rbi',
]
function isRelevant(article) {
  const hay = `${article.title} ${article.description}`.toLowerCase()
  return RELEVANCE_TERMS.some(term => hay.includes(term))
}

// ── In-memory cache (per category) ──────────────────────────────────────────
// Shared across all users of this server instance so we don't hammer the RSS
// source. 10-minute freshness is plenty for news. On a fetch failure we fall
// back to stale cache if present.
const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map() // category -> { data, ts }

const FEED_TIMEOUT_MS = 8000
const MAX_ARTICLES = 12

// ── Tiny HTML / entity cleaners ─────────────────────────────────────────────
function decodeEntities(str) {
  if (!str) return ''
  return str
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)) } catch { return '' } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)) } catch { return '' } })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
}
function stripHtml(str) {
  if (!str) return ''
  return str.replace(/<[^>]*>/g, ' ')
}
function clean(str) {
  return decodeEntities(stripHtml(decodeEntities(String(str || ''))))
    .replace(/\s+/g, ' ')
    .trim()
}
function unwrapCdata(str) {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(str || '')
  return m ? m[1] : (str || '')
}

// Extract the first <tag>...</tag> inner content from an item block.
function tagContent(block, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block)
  return m ? unwrapCdata(m[1]) : ''
}

// ── RSS parse ───────────────────────────────────────────────────────────────
function parseRss(xml) {
  const items = []
  const itemRe = /<item\b[\s\S]*?<\/item>/gi
  let m
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[0]
    const rawTitle = clean(tagContent(block, 'title'))
    const link = clean(tagContent(block, 'link'))
    const pubDate = clean(tagContent(block, 'pubDate'))
    const rawDesc = clean(tagContent(block, 'description'))
    const sourceTag = clean(tagContent(block, 'source'))

    // Google News titles are "Headline - Source". Prefer the <source> element;
    // fall back to the trailing " - Source" segment, then strip it from title.
    let source = sourceTag
    let title = rawTitle
    if (!source) {
      const dash = rawTitle.lastIndexOf(' - ')
      if (dash > 0) source = rawTitle.slice(dash + 3).trim()
    }
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, title.length - source.length - 3).trim()
    }

    // Google News descriptions are link-list HTML — often just repeats the
    // headline/source. Blank it out when it collapses to the title.
    let description = rawDesc
    if (!description || description.toLowerCase().startsWith(title.toLowerCase())) description = ''

    let published_at = null
    if (pubDate) {
      const d = new Date(pubDate)
      if (!Number.isNaN(d.getTime())) published_at = d.toISOString()
    }

    if (!title || !link) continue
    items.push({
      id: link,
      title,
      description,
      url: link,
      source: source || 'Google News',
      published_at,
      image: null, // Google News RSS does not carry reliable thumbnails
    })
  }
  return items
}

async function fetchFeed({ q, hl, gl, ceid }) {
  const params = new URLSearchParams({ q, hl, gl, ceid })
  const url = `https://news.google.com/rss/search?${params.toString()}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GoldApp-GoldNews/1.0)' },
    })
    if (!res.ok) throw new Error(`rss_${res.status}`)
    const xml = await res.text()
    return parseRss(xml)
  } finally {
    clearTimeout(timer)
  }
}

// Normalized-title key for de-duplication.
function dedupeKey(a) {
  return a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

async function buildCategory(categoryKey) {
  const cat = CATEGORIES[categoryKey] || CATEGORIES[DEFAULT_CATEGORY]

  // Fetch all feeds for the category; a single feed failing must not sink the
  // rest. If every feed fails, throw so the caller can serve stale/empty.
  const results = await Promise.allSettled(cat.feeds.map(fetchFeed))
  const ok = results.filter(r => r.status === 'fulfilled')
  if (ok.length === 0) throw new Error('all_feeds_failed')

  const merged = ok.flatMap(r => r.value)

  // Relevance filter, then de-duplicate by normalized title AND canonical url.
  const seenTitle = new Set()
  const seenUrl = new Set()
  const deduped = []
  for (const a of merged) {
    if (!isRelevant(a)) continue
    const tk = dedupeKey(a)
    const uk = (a.url || '').split('?')[0]
    if (tk && seenTitle.has(tk)) continue
    if (uk && seenUrl.has(uk)) continue
    if (tk) seenTitle.add(tk)
    if (uk) seenUrl.add(uk)
    deduped.push(a)
  }

  // Newest-first; undated items sink to the bottom.
  deduped.sort((a, b) => {
    const ta = a.published_at ? new Date(a.published_at).getTime() : 0
    const tb = b.published_at ? new Date(b.published_at).getTime() : 0
    return tb - ta
  })

  return deduped.slice(0, MAX_ARTICLES)
}

export async function GET(req) {
  // Gold News is a delegable page permission (page.gold-news). Gate the API by
  // that permission (not a fixed role group) so a role granted the page in Role
  // Management is accepted — and super_admin keeps god-mode. Falls back to the
  // static ROLE_PAGES map when a role has no DB rows.
  const auth = await requireAuthForPage(req, 'gold-news')
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const requested = searchParams.get('category') || DEFAULT_CATEGORY
  const category = CATEGORIES[requested] ? requested : DEFAULT_CATEGORY

  // Serve fresh cache if we have it.
  const cached = cache.get(category)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return Response.json({ ...cached.data, cached: true })
  }

  try {
    const articles = await buildCategory(category)
    const data = {
      category,
      articles,
      count: articles.length,
      updated_at: new Date().toISOString(),
      error: null,
    }
    cache.set(category, { data, ts: Date.now() })
    return Response.json(data)
  } catch {
    // Never propagate a hard failure — the dashboard must keep working and this
    // screen must degrade to a graceful empty/error state. Prefer stale cache.
    if (cached) {
      return Response.json({ ...cached.data, cached: true, stale: true })
    }
    return Response.json({
      category,
      articles: [],
      count: 0,
      updated_at: null,
      error: 'provider_error',
    })
  }
}
