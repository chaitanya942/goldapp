'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../lib/context';

const FALLBACK = [
  { label: '24K', price: 72450, prev: 72450, unit: '/10g' },
  { label: '22K', price: 66413, prev: 66413, unit: '/10g' },
  { label: '18K', price: 54338, prev: 54338, unit: '/10g' },
];

const T = {
  dark:  { bg: '#0f0f0f', label: '#7a5a20', price: '#c9a84c', dim: '#4a3a1a', border: 'rgba(201,168,76,0.15)', sep: 'rgba(201,168,76,0.08)' },
  light: { bg: '#faf7f2', label: '#9a7228', price: '#7a5010', dim: '#a09070', border: 'rgba(154,114,40,0.2)',  sep: 'rgba(154,114,40,0.1)'  },
};

function calcKarat(base24, k) { return Math.round(base24 * k / 24) }

export default function LiveTicker() {
  const { theme } = useApp();
  const t = T[theme] || T.dark;
  const [rates, setRates] = useState(FALLBACK);
  const [flash, setFlash] = useState({});

  useEffect(() => {
    let prev24 = null;
    const load = async () => {
      const { data } = await supabase
        .from('gold_rates').select('kalinga_sell_rate, fetched_at')
        .order('fetched_at', { ascending: false }).limit(1).single();
      if (!data?.kalinga_sell_rate) return;
      const base = data.kalinga_sell_rate;
      const next = [
        { label: '24K', price: base,               prev: prev24 ?? base,                    unit: '/10g' },
        { label: '22K', price: calcKarat(base, 22), prev: prev24 ? calcKarat(prev24, 22) : calcKarat(base, 22), unit: '/10g' },
        { label: '18K', price: calcKarat(base, 18), prev: prev24 ? calcKarat(prev24, 18) : calcKarat(base, 18), unit: '/10g' },
      ];
      next.forEach(r => {
        if (r.price !== r.prev) {
          const dir = r.price > r.prev ? 'up' : 'down';
          setFlash(f => ({ ...f, [r.label]: dir }));
          setTimeout(() => setFlash(f => { const n = { ...f }; delete n[r.label]; return n; }), 800);
        }
      });
      prev24 = base;
      setRates(next);
    };
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
      background: t.bg,
      border: `1px solid ${t.border}`,
      borderRadius: '12px', overflow: 'hidden',
      transition: 'background 0.22s ease, border-color 0.22s ease',
    }}>
      {rates.map((r, i) => {
        const up   = r.price > r.prev;
        const down = r.price < r.prev;
        const diff = r.price - r.prev;
        const flashBg = flash[r.label] === 'up'   ? 'rgba(58,170,106,0.12)' :
                        flash[r.label] === 'down' ? 'rgba(224,85,85,0.12)'   : t.bg;
        return (
          <div key={r.label} style={{
            padding: '14px 20px',
            background: flashBg,
            borderRight: i < 2 ? `1px solid ${t.sep}` : 'none',
            transition: 'background 0.3s ease',
          }}>
            <div style={{ fontSize: '.55rem', letterSpacing: '.18em', textTransform: 'uppercase', color: t.label, marginBottom: '6px', fontWeight: 600 }}>
              {r.label} GOLD
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1,
              color: flash[r.label] === 'up' ? '#3aaa6a' : flash[r.label] === 'down' ? '#e05555' : t.price,
              transition: 'color 0.3s ease', fontVariantNumeric: 'tabular-nums',
            }}>
              ₹{r.price.toLocaleString('en-IN')}
              <span style={{ fontSize: '.6rem', color: t.dim, marginLeft: '4px', fontWeight: 400 }}>{r.unit}</span>
            </div>
            <div style={{ fontSize: '.6rem', marginTop: '4px', color: up ? '#3aaa6a' : down ? '#e05555' : t.dim, display: 'flex', alignItems: 'center', gap: '3px' }}>
              <span>{up ? '▲' : down ? '▼' : '—'}</span>
              <span>{diff !== 0 ? `₹${Math.abs(diff).toLocaleString('en-IN')}` : 'No change'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
