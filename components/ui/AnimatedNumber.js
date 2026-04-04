'use client';
import { useState, useEffect } from 'react';

export default function AnimatedNumber({
  target,
  prefix = '',
  suffix = '',
  decimals = 0,
  duration = 1200,
  style = {},
}) {
  const [value, setValue] = useState(0);
  const [key, setKey] = useState(0);

  useEffect(() => {
    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setValue(target * ease);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, key, duration]);

  const display = decimals > 0
    ? value.toFixed(decimals)
    : Math.floor(value).toLocaleString('en-IN');

  return (
    <span
      key={key}
      style={{ animation: 'countUp 0.4s ease', cursor: 'pointer', ...style }}
      onClick={() => setKey(k => k + 1)}
      title="Click to replay"
    >
      {prefix}{display}{suffix}
    </span>
  );
}
