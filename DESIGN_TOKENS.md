# WhiteGold Dashboard — Design Tokens

Shareable spec for replicating the WhiteGold dashboard look in another app. Covers fonts, full colour palettes (dark + light), the KPI card recipe, and the region accent map.

---

## Fonts (Google Fonts, free)

- **Body / UI / Headings → Plus Jakarta Sans**
- **Numbers, codes, monospace bits → DM Mono**

Both loaded via `next/font/google`:

```jsx
import { Plus_Jakarta_Sans, DM_Mono } from 'next/font/google'

const plusJakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets:  ['latin'],
  weight:   ['300','400','500','600','700','800'],
  display:  'swap',
})

const dmMono = DM_Mono({
  variable: '--font-dm-mono',
  subsets:  ['latin'],
  weight:   ['300','400','500'],
  display:  'swap',
})
```

Body CSS:

```css
body {
  font-family: var(--font-jakarta), 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  letter-spacing: -0.01em;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: 'kern' 1, 'liga' 1, 'calt' 1;
}

h1, h2, h3, h4, h5, h6 {
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.font-mono, code, kbd, pre {
  font-family: var(--font-dm-mono), 'DM Mono', monospace;
  letter-spacing: 0;
}

table { font-variant-numeric: tabular-nums; }
```

---

## Colour palette — DARK theme (default, shown in screenshots)

| Token       | Hex        | Where it's used                                  |
| ----------- | ---------- | ------------------------------------------------ |
| `bg`        | `#0a0a0a`  | Page background                                  |
| `card`      | `#111111`  | Card / panel background                          |
| `card2`     | `#161616`  | Inset / secondary surface                        |
| `card3`     | `#1d1c19`  | Tertiary / hover surface                         |
| `text1`     | `#f0e6c8`  | Primary text (warm cream)                        |
| `text2`     | `#c8b89a`  | Secondary text                                   |
| `text3`     | `#9a8a6a`  | Tertiary / labels                                |
| `text4`     | `#6a5a3a`  | Quietest text / placeholders                     |
| `gold`      | `#c9a84c`  | **Brand accent** — KPIs, highlights, focused state |
| `goldText`  | `#1a0a00`  | Text on gold buttons / pills                     |
| `border`    | `#1e1e1e`  | Default border                                   |
| `border2`   | `#252525`  | Stronger border / divider                        |
| `green`     | `#3aaa6a`  | Positive / success                               |
| `red`       | `#e05555`  | Negative / destructive                           |
| `blue`      | `#3a8fbf`  | Info / in-transit                                |
| `orange`    | `#c9981f`  | Warning / pending                                |
| `purple`    | `#8c5ac8`  | Analytics / reports accent                       |

Drop shadow (used on elevated cards):

```
shadow: 0 2px 8px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.03);
```

---

## Colour palette — LIGHT theme

| Token       | Hex        |
| ----------- | ---------- |
| `bg`        | `#f5f0e8`  |
| `card`      | `#faf7f2`  |
| `card2`     | `#e0d9cc`  |
| `card3`     | `#ede5d8`  |
| `text1`     | `#1a1208`  |
| `text2`     | `#3a2a10`  |
| `text3`     | `#7a6a4a`  |
| `text4`     | `#9a8a6a`  |
| `gold`      | `#9a7228`  |
| `goldText`  | `#ffffff`  |
| `border`    | `#e0dace`  |
| `border2`   | `#c5bca8`  |
| `green`     | `#2a8a5a`  |
| `red`       | `#c03030`  |
| `blue`      | `#2a6a9a`  |
| `orange`    | `#a07010`  |
| `purple`    | `#6a3a9a`  |
| `shadow`    | `0 2px 8px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.8)` |

Theme switching is driven by `data-theme="dark"` / `data-theme="light"` on `<html>`.

---

## Drop-in JS theme module

Copy this verbatim — same object the WhiteGold app reads at runtime.

```js
export const THEMES = {
  dark: {
    bg:       '#0a0a0a',
    card:     '#111111',
    card2:    '#161616',
    card3:    '#1d1c19',
    text1:    '#f0e6c8',
    text2:    '#c8b89a',
    text3:    '#9a8a6a',
    text4:    '#6a5a3a',
    gold:     '#c9a84c',
    goldText: '#1a0a00',
    border:   '#1e1e1e',
    border2:  '#252525',
    green:    '#3aaa6a',
    red:      '#e05555',
    blue:     '#3a8fbf',
    orange:   '#c9981f',
    purple:   '#8c5ac8',
    shadow:   '0 2px 8px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.03)',
  },
  light: {
    bg:       '#f5f0e8',
    card:     '#faf7f2',
    card2:    '#e0d9cc',
    card3:    '#ede5d8',
    text1:    '#1a1208',
    text2:    '#3a2a10',
    text3:    '#7a6a4a',
    text4:    '#9a8a6a',
    gold:     '#9a7228',
    goldText: '#ffffff',
    border:   '#e0dace',
    border2:  '#c5bca8',
    green:    '#2a8a5a',
    red:      '#c03030',
    blue:     '#2a6a9a',
    orange:   '#a07010',
    purple:   '#6a3a9a',
    shadow:   '0 2px 8px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.8)',
  },
}
```

---

## KPI card recipe (the cards in screenshot #2)

```jsx
// Card shell
{
  background:   `linear-gradient(135deg, ${accent}10 0%, ${t.card} 60%)`,
  border:       `1px solid ${accent}30`,
  borderRadius: '12px',
  padding:      '14px 16px',
  position:     'relative',
  overflow:     'hidden',
}

// Top accent stripe
<div style={{
  position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
  background: `linear-gradient(90deg, ${accent} 0%, ${accent}40 60%, transparent 100%)`,
}} />

// Label
<span style={{
  fontSize: '9px', color: t.text4,
  letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600,
}}>TOTAL BILLS</span>

// Big value
<div style={{
  fontSize: '22px', color: accent, fontWeight: 700,
  fontFamily: 'monospace', lineHeight: 1.1, letterSpacing: '-.01em',
  marginTop: '6px',
}}>48</div>

// Sub
<div style={{ fontSize: '10px', color: t.text4, marginTop: '6px' }}>Today</div>
```

`accent` swaps per card:

- `t.gold` — headline number (Total Bills)
- `t.green` — net weight / positive metrics
- `t.blue` — rate / info
- `t.purple` — purity / analytics
- `t.red` — service charge / negative

---

## Region accent map (used in by-region rows)

```js
'Bangalore':         '#c9a84c'   // gold
'Rest of Karnataka': '#c9a84c'   // gold
'Andhra Pradesh':    '#3a8fbf'   // blue
'Telangana':         '#8c5ac8'   // purple
'Kerala':            '#3aaa6a'   // green
'Tamil Nadu':        '#c9981f'   // orange
```

---

That's the complete kit. The live source of truth in the WhiteGold app is `lib/consignmentTheme.js` — the `CONSIGNMENT_THEMES` object can be copied verbatim.
