'use client';

export default function BarChart({ data = [], animKey = 0, height = 80 }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.v || 0));

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height }}>
      {data.map((d, i) => (
        <div key={`${animKey}-${i}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{
            width: '100%',
            height: `${((d.v || 0) / (max || 1)) * (height - 16)}px`,
            background: 'linear-gradient(180deg, #FFD700, #8B6914)',
            borderRadius: '2px 2px 0 0',
            transformOrigin: 'bottom',
            animation: `barGrow 0.6s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.07}s both`,
            opacity: 0.85,
          }} />
          <div style={{ fontSize: 9, color: '#8B6914', letterSpacing: '0.05em' }}>{d.l}</div>
        </div>
      ))}
    </div>
  );
}
