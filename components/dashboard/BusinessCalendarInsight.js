'use client'

// BusinessCalendarInsight — "Today's Business Insight" dashboard panel.
// Reads the South Indian Panchangam-aware heuristic in
// lib/businessCalendarInsight.js and surfaces today's expected
// gold-SELLING activity level (Low / Low–Normal / Normal), with the list
// of contributing occasions (Amavasya, Akshaya Tritiya, Aadi Masam, wedding
// season, Tuesday/Friday, etc.) so ops can see WHY, not just a bare label.
//
// Pure client-side computation — no fetch, no loading state needed.

import { istToday } from '../../lib/dateIst'
import { getDayInsight } from '../../lib/businessCalendarInsight'

const LEVEL_META = {
  low:          { label: 'Low',          accent: t => t.red,               note: 'Multiple auspicious-day factors overlap today — expect lighter walk-in selling.' },
  'low-normal': { label: 'Low – Normal', accent: t => t.orange || '#d98a3a', note: 'One mild factor today — selling may run a touch quieter than usual.' },
  normal:       { label: 'Normal',       accent: t => t.green,              note: 'No auspicious/inauspicious occasion today — a typical business day.' },
}

export default function BusinessCalendarInsight({ t }) {
  const today    = istToday()
  const insight  = getDayInsight(today)
  const meta     = LEVEL_META[insight.level]
  const accent   = meta.accent(t)
  const dateLabel = new Date(`${today}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px',
        background: `linear-gradient(90deg, ${accent}12, transparent)`,
        borderBottom: `1px solid ${t.border}`,
      }}>
        <span style={{ width: 3, height: 14, borderRadius: 2, background: accent }} />
        <span style={{ fontSize: 11, color: accent, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase' }}>
          Today's Business Insight
        </span>
        <span style={{ fontSize: 10, color: t.text4, marginLeft: 4 }}>· {dateLabel}</span>
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 21, fontWeight: 800, color: accent, letterSpacing: '-.01em' }}>{meta.label}</span>
          <span style={{ fontSize: 11.5, color: t.text3 }}>expected selling activity</span>
        </div>

        {insight.factors.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {insight.factors.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 7, fontSize: 12, color: t.text2 }}>
                <span style={{ color: accent, flexShrink: 0 }}>•</span>
                <span>{f.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: t.text3 }}>{meta.note}</div>
        )}

        {!insight.dataAvailable && (
          <div style={{ fontSize: 10.5, color: t.text4, fontStyle: 'italic' }}>
            Panchangam calendar for {today.slice(0, 4)} isn't curated yet — only the weekly Tuesday/Friday pattern is reflected above. Update lib/businessCalendarInsight.js with that year's festival/Amavasya dates.
          </div>
        )}

        <div style={{ fontSize: 10, color: t.text4, borderTop: `1px solid ${t.border}`, paddingTop: 8, marginTop: 2 }}>
          Advisory based on South Indian Panchangam custom (auspicious-for-buying days tend to see lighter selling) — not a statistical forecast from this business's own data.
        </div>
      </div>
    </div>
  )
}
