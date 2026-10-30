import { useMemo } from 'react';
import { useThemeStore } from '../store/theme.store';

const TOKEN_NAMES = [
  'base-950', 'base-900', 'base-800', 'base-700', 'base-600', 'base-500',
  'ink-100', 'ink-300', 'ink-500',
  'signal', 'signal-hover', 'signal-muted',
  'blueprint', 'blueprint-hover', 'blueprint-muted',
  'ok', 'warn', 'danger', 'high', 'noir',
] as const;

export type ThemeColors = Record<typeof TOKEN_NAMES[number], string>;

// index.css stores each --rc-* color as space-separated "R G B" channel
// numbers (Tailwind's own documented pattern for a CSS-variable color that
// still supports its opacity-modifier syntax, e.g. bg-danger/10 -- see
// tailwind.config.js's header comment), not a hex string. Consumers here
// (recharts SVG props, an inline style's `color`/`fill`, the `${color}XX`
// hex-alpha-suffix trick used in a few status chips) all want a normal
// #rrggbb string, so this converts the resolved triplet back to one rather
// than making every call site parse "R G B" itself.
function tripletToHex(triplet: string): string {
  const channels = triplet.trim().split(/\s+/).map(Number);
  if (channels.length !== 3 || channels.some((n) => Number.isNaN(n))) return '#000000';
  return `#${channels.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`;
}

// Resolves the same --rc-* custom properties index.css defines, as actual
// #rrggbb color strings -- for the handful of spots that need a literal
// color value rather than a Tailwind class: recharts SVG props (axis/grid/
// tooltip colors aren't settable via className), inline-style status chips
// built from a dynamic palette, canvas/WebGL surfaces. Re-reads on every
// theme change, since by the time the theme store's value updates, <html
// data-theme> (and so every --rc-* value) has already flipped synchronously
// -- see theme.store.ts's applyTheme().
export function useThemeColors(): ThemeColors {
  const theme = useThemeStore((s) => s.theme);
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string) => tripletToHex(style.getPropertyValue(`--rc-${name}`));
    return Object.fromEntries(TOKEN_NAMES.map((t) => [t, read(t)])) as ThemeColors;
    // theme is read only to retrigger this memo when it changes -- the
    // actual values always come from the DOM, never from the theme string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}
