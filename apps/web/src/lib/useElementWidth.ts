import { useLayoutEffect, useRef, useState } from 'react';

// Tracks an element's rendered width so an SVG can be laid out in real
// pixels (text stays at its true size) instead of being scaled through a
// viewBox. Falls back to `fallback` until the first measurement, and in
// environments without layout (jsdom) where the width reads as 0.
export function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.round(w));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
