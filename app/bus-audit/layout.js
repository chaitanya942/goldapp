// app/bus-audit/layout.js
// Loads the display face for the bus-audit module only, so the rest of GoldApp
// doesn't pay the download cost. Bricolage Grotesque carries headings/numbers;
// Plus Jakarta (from the root layout) stays the UI workhorse.

import { Bricolage_Grotesque } from 'next/font/google'

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

export default function BusAuditLayout({ children }) {
  // Full-bleed background lives here so it covers the whole viewport on desktop
  // — the centred content column can't paint the area beside it.
  return (
    <div className={display.variable} style={{ minHeight: '100dvh', background: '#F6F7F9' }}>
      {children}
    </div>
  )
}
