'use client';
import { useState, useEffect, useRef } from 'react';

// Count-up number.
//
// Default behaviour (unchanged — existing dashboard/flashcard callers rely
// on it): sweep 0 → target on mount and on every target change, with a
// click-to-replay affordance.
//
// Opt-in props for live/polled surfaces (e.g. the Bidding Volume KPI strip,
// which re-renders every 10s):
//   fromPrevious    tween from the last shown value to the new one (a delta
//                   tick) instead of sweeping up from 0.
//   animateOnMount  when false, the first render shows `target` immediately
//                   with no sweep — only subsequent changes animate.
//   replayable      when false, drop the pointer/click-to-replay affordance
//                   (wrong for a dense, non-interactive metric tile).
//
// prefers-reduced-motion is always respected: the value jumps straight to
// target with no tween, regardless of the props above.
export default function AnimatedNumber({
  target,
  prefix = '',
  suffix = '',
  decimals = 0,
  duration = 1200,
  fromPrevious = false,
  animateOnMount = true,
  replayable = true,
  style = {},
}) {
  const [value, setValue] = useState(animateOnMount ? 0 : target);
  const [key, setKey] = useState(0);
  const prevRef = useRef(animateOnMount ? 0 : target);
  const mountedRef = useRef(false);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const firstRun = !mountedRef.current;
    mountedRef.current = true;

    // Jump (no tween) when: reduced motion, or first mount with
    // animateOnMount=false. A manual replay (key > 0) always animates.
    if (reduce || (firstRun && !animateOnMount && key === 0)) {
      setValue(target);
      prevRef.current = target;
      return;
    }

    const from = fromPrevious ? prevRef.current : 0;
    const delta = target - from;

    // Polled surface that didn't move: skip the tween so the strip doesn't
    // flicker on every tick when nothing changed (float jitter included).
    if (fromPrevious && key === 0) {
      const eps = decimals > 0 ? 0.5 * Math.pow(10, -decimals) : 0.5;
      if (Math.abs(delta) < eps) {
        setValue(target);
        prevRef.current = target;
        return;
      }
    }

    let raf;
    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setValue(from + delta * ease);
      if (p < 1) raf = requestAnimationFrame(step);
      else prevRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [target, key, duration, fromPrevious, animateOnMount, decimals]);

  const display = decimals > 0
    ? value.toFixed(decimals)
    : Math.floor(value).toLocaleString('en-IN');

  return (
    <span
      key={key}
      style={{
        animation: 'countUp 0.4s ease',
        ...(replayable ? { cursor: 'pointer' } : null),
        ...style,
      }}
      onClick={replayable ? () => setKey(k => k + 1) : undefined}
      title={replayable ? 'Click to replay' : undefined}
    >
      {prefix}{display}{suffix}
    </span>
  );
}
