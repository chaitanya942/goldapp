'use client';

const COLORS = {
  gold:    { bg: 'rgba(255,215,0,0.1)',    border: 'rgba(255,215,0,0.3)',    text: '#FFD700' },
  green:   { bg: 'rgba(74,222,128,0.1)',   border: 'rgba(74,222,128,0.3)',   text: '#4ade80' },
  red:     { bg: 'rgba(239,68,68,0.1)',    border: 'rgba(239,68,68,0.3)',    text: '#f87171' },
  blue:    { bg: 'rgba(58,143,191,0.1)',   border: 'rgba(58,143,191,0.3)',   text: '#3a8fbf' },
  orange:  { bg: 'rgba(201,152,31,0.1)',   border: 'rgba(201,152,31,0.3)',   text: '#c9981f' },
  purple:  { bg: 'rgba(140,90,200,0.1)',   border: 'rgba(140,90,200,0.3)',   text: '#8c5ac8' },
  dim:     { bg: 'rgba(139,99,20,0.1)',    border: 'rgba(139,99,20,0.3)',    text: '#8B6914' },
};

export default function Badge({ label, color = 'gold', style = {} }) {
  const c = COLORS[color] || COLORS.gold;
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 2,
      background: c.bg, border: `1px solid ${c.border}`,
      color: c.text, fontSize: 9, letterSpacing: '0.12em',
      textTransform: 'uppercase', fontWeight: 400,
      whiteSpace: 'nowrap',
      ...style,
    }}>
      {label}
    </span>
  );
}
