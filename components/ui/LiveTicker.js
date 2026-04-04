'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

const FALLBACK = [
  { label: '24K GOLD', price: 72450, prev: 72450, unit: '/10g' },
  { label: '22K GOLD', price: 66413, prev: 66413, unit: '/10g' },
  { label: '18K GOLD', price: 54338, prev: 54338, unit: '/10g' },
];

function calcKarat(base24, k) {
  return Math.round(base24 * k / 24);
}

export default function LiveTicker() {
  const [rates, setRates] = useState(FALLBACK);
  const [flash, setFlash] = useState({});

  useEffect(() => {
    let prev24 = null;

    const load = async () => {
      const { data } = await supabase
        .from('gold_rates')
        .select('kalinga_sell_rate, fetched_at')
        .order('fetched_at', { ascending: false })
        .limit(1)
        .single();

      if (!data?.kalinga_sell_rate) return;

      const base = data.kalinga_sell_rate; // per 10g, 24k
      const r24 = base;
      const r22 = calcKarat(base, 22);
      const r18 = calcKarat(base, 18);

      const next = [
        { label: '24K', price: r24, prev: prev24 ?? r24, unit: '/10g' },
        { label: '22K', price: r22, prev: prev24 ? calcKarat(prev24, 22) : r22, unit: '/10g' },
        { label: '18K', price: r18, prev: prev24 ? calcKarat(prev24, 18) : r18, unit: '/10g' },
      ];

      next.forEach(r => {
        if (r.price !== r.prev) {
          const dir = r.price > r.prev ? 'up' : 'down';
          setFlash(f => ({ ...f, [r.label]: dir }));
          setTimeout(() => setFlash(f => {
            const n = { ...f }; delete n[r.label]; return n;
          }), 600);
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
      gap: '1px', background: 'rgba(201,168,76,0.1)',
      border: '1px solid rgba(201,168,76,0.2)',
      borderRadius: 4, overflow: 'hidden',
    }}>
      {rates.map(r => {
        const up   = r.price > r.prev;
        const down = r.price < r.prev;
        const diff = r.price - r.prev;
        return (
          <div
            key={r.label}
            style={{
              padding: '12px 16px',
              background: flash[r.label] === 'up'   ? 'rgba(74,222,128,0.12)' :
                          flash[r.label] === 'down' ? 'rgba(239,68,68,0.12)'  : '#0f0f0f',
              transition: 'background 0.3s ease',
            }}
          >
            <div style={{ fontSize: 9, letterSpacing: '0.15em', color: '#8B6914', marginBottom: 4 }}>
              {r.label}
            </div>
            <div style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em',
              color: flash[r.label] === 'up' ? '#4ade80' : flash[r.label] === 'down' ? '#f87171' : '#FFD700',
              transition: 'color 0.3s ease',
            }}>
              ₹{r.price.toLocaleString('en-IN')}
              <span style={{ fontSize: 9, color: '#8B6914', marginLeft: 4 }}>{r.unit}</span>
            </div>
            <div style={{ fontSize: 9, marginTop: 3, color: up ? '#4ade80' : down ? '#f87171' : '#8B6914' }}>
              {up ? '▲' : down ? '▼' : '—'} {diff !== 0 ? `₹${Math.abs(diff).toLocaleString('en-IN')}` : '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
