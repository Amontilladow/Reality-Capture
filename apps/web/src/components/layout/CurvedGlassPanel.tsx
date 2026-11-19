import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// The sidebar's frosted glass panel: rounded corners and long sides that
// curve gently inward toward the middle. The outline is a real path built
// from the panel's measured size (so corners and curves never stretch),
// used three ways: to clip the glass, to trace a light along its edge, and
// as a soft drop shadow underneath.
//
// Anything that must float outside the panel (menus, tooltips) has to
// render through a portal, since the clip cuts off whatever crosses it.

const RADIUS = 28;
// How far each long side dips in at its midpoint is half of this (the
// quadratic curve's control point), so 28 gives a 14px waist.
const BOW = 28;

function curvedPanelPath(w: number, h: number, r = RADIUS, bow = BOW): string {
  const my = h / 2;
  return [
    `M${r},0 H${w - r} Q${w},0 ${w},${r}`,
    `Q${w - bow},${my} ${w},${h - r}`,
    `Q${w},${h} ${w - r},${h} H${r} Q0,${h} 0,${h - r}`,
    `Q${bow},${my} 0,${r} Q0,0 ${r},0 Z`,
  ].join(' ');
}

export function CurvedGlassPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: Math.round(width), h: Math.round(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const d = size ? curvedPanelPath(size.w, size.h) : null;
  const box = size ? `0 0 ${size.w} ${size.h}` : undefined;

  return (
    <div ref={ref} className={`relative ${className}`}>
      {d && (
        <svg aria-hidden="true" viewBox={box} className="absolute inset-0 w-full h-full translate-y-4 blur-2xl opacity-60 pointer-events-none">
          <path d={d} style={{ fill: 'rgb(var(--rc-shadow))' }} />
        </svg>
      )}
      {/* Until measured (first paint, or no ResizeObserver) the glass is a
          plain rounded panel, so it's never unclipped and square. */}
      <div
        className="glass-panel absolute inset-0 rounded-[28px] overflow-hidden"
        style={d ? { clipPath: `path('${d}')`, borderRadius: 0 } : undefined}
      >
        {children}
      </div>
      {d && (
        <svg aria-hidden="true" viewBox={box} className="absolute inset-0 w-full h-full pointer-events-none">
          <defs>
            <linearGradient id="rc-glass-edge" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'rgb(var(--rc-edge) / calc(0.75 * var(--rc-edge-a)))' }} />
              <stop offset="0.5" style={{ stopColor: 'rgb(var(--rc-edge) / calc(0.22 * var(--rc-edge-a)))' }} />
              <stop offset="1" style={{ stopColor: 'rgb(var(--rc-signal) / 0.7)' }} />
            </linearGradient>
          </defs>
          <path d={d} fill="none" stroke="url(#rc-glass-edge)" strokeWidth="2" />
        </svg>
      )}
    </div>
  );
}
