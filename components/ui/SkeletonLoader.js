'use client';

export default function SkeletonLoader({ rows = 3, style = {} }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, ...style }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ height: 10, width: `${60 + i * 15}%` }} />
            <div className="skeleton" style={{ height: 8, width: `${40 + i * 10}%` }} />
          </div>
          <div className="skeleton" style={{ width: 60, height: 20, borderRadius: 2 }} />
        </div>
      ))}
    </div>
  );
}
