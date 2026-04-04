'use client';

export default function GoldSpinner({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ animation: 'spin 1s linear infinite' }}>
      <circle cx="16" cy="16" r="12" fill="none" stroke="rgba(201,168,76,0.15)" strokeWidth="2" />
      <circle cx="16" cy="16" r="12" fill="none" stroke="#FFD700" strokeWidth="2"
        strokeDasharray="20 56" strokeLinecap="round" />
    </svg>
  );
}
