/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Every token below resolves through a CSS custom property
        // (--rc-*, defined in index.css) instead of a literal hex value --
        // that's what makes dark mode a data-theme attribute flip rather
        // than a rebuild. Component code is completely unaffected: every
        // existing bg-base-950/text-ink-100/bg-signal/etc. class still
        // compiles to the exact same utility, it just now resolves to
        // whichever value index.css's :root or :root[data-theme="dark"]
        // block currently has in scope. See index.css for the light and
        // dark values themselves and the reasoning behind each.
        //
        // Wrapped as rgb(var(--rc-x) / <alpha-value>) rather than a plain
        // var(--rc-x) -- Tailwind's documented pattern for a CSS-variable
        // color that still supports its own opacity-modifier syntax
        // (bg-danger/10, border-blueprint/40, ...), which the existing
        // design system already relies on throughout (.btn-danger,
        // .panel-interactive, Modal's backdrop...). This is why index.css
        // stores each --rc-* color as "R G B" channel numbers, not a hex
        // string -- <alpha-value> can only substitute into that shape.
        base: {
          950: 'rgb(var(--rc-base-950) / <alpha-value>)', // page background (canvas)
          900: 'rgb(var(--rc-base-900) / <alpha-value>)', // chrome bars / secondary surface (canvas-soft)
          800: 'rgb(var(--rc-base-800) / <alpha-value>)', // panel surface (canvas-soft)
          700: 'rgb(var(--rc-base-700) / <alpha-value>)', // raised surface / hover (field)
          600: 'rgb(var(--rc-base-600) / <alpha-value>)', // borders (hairline)
          500: 'rgb(var(--rc-base-500) / <alpha-value>)', // muted borders / dividers (hairline-soft)
        },
        ink: {
          100: 'rgb(var(--rc-ink-100) / <alpha-value>)', // primary text
          300: 'rgb(var(--rc-ink-300) / <alpha-value>)', // secondary text
          500: 'rgb(var(--rc-ink-500) / <alpha-value>)', // muted / placeholder
        },
        signal: {
          // primary action fill -- mirrors ink-100 exactly, light or dark
          // (an ink-black button on white in light mode, a near-white
          // button on charcoal in dark mode), same as it always has.
          DEFAULT: 'rgb(var(--rc-signal) / <alpha-value>)',
          hover: 'rgb(var(--rc-signal-hover) / <alpha-value>)',
          muted: 'rgb(var(--rc-signal-muted) / <alpha-value>)',
        },
        blueprint: {
          // electric blue — Mobbin's one accent. The spec reserves it for
          // commercial signals only; this app repurposes it as the general
          // interactive/info accent (links, active states, status badges)
          // since a working dashboard needs more color differentiation than
          // a marketing page. Focus rings use ink instead, per the spec.
          DEFAULT: 'rgb(var(--rc-blueprint) / <alpha-value>)',
          hover: 'rgb(var(--rc-blueprint-hover) / <alpha-value>)',
          muted: 'rgb(var(--rc-blueprint-muted) / <alpha-value>)',
        },
        ok: 'rgb(var(--rc-ok) / <alpha-value>)',
        warn: 'rgb(var(--rc-warn) / <alpha-value>)',
        danger: 'rgb(var(--rc-danger) / <alpha-value>)',
      },
      fontFamily: {
        // "Outfit" stands in for the requested "Grift" (38-lineart, paid,
        // no free/CDN license) -- a free geometric sans in the same rounded,
        // circular-dot family. Swap this one token for the real Grift
        // files via @font-face if/when a license is purchased.
        sans: ['"Outfit"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // Type scale. Tailwind's own text-xs/sm/base/lg/xl cover the vast
      // majority of the app already and are used as-is -- the convention is:
      //   text-xs  + text-ink-500   captions, table cells, metadata, field hints
      //   text-sm                   body copy, labels, buttons, most headings (font-semibold)
      //   text-base + font-semibold page/section titles (PageHeader, Card title)
      //   text-lg+                  rare, a dashboard/report's single dominant number
      // The two tokens below are the only sizes that weren't already on
      // Tailwind's scale and had drifted into one-off text-[10px]/text-[11px]
      // arbitrary values across pages (PageHeader's eyebrow, issue numbers) --
      // named here so new code reaches for a token instead of another magic number.
      fontSize: {
        eyebrow: ['0.625rem', { lineHeight: '1rem', letterSpacing: '0.08em' }], // 10px -- uppercase mono section/page labels
        kpi: ['1.75rem', { lineHeight: '2rem', letterSpacing: '-0.01em' }], // 28px -- dashboard/report stat-tile numbers
      },
      backgroundImage: {
        // --rc-grid-line flips from a faint dark line (light mode) to a
        // faint light line (dark mode) in index.css -- a literal dark hex
        // here would be invisible against the dark-mode canvas.
        'grid-fine': `linear-gradient(var(--rc-grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--rc-grid-line) 1px, transparent 1px)`,
      },
      backgroundSize: {
        'grid-fine': '24px 24px',
      },
      borderRadius: {
        sm: '16px',
        DEFAULT: '16px',
        md: '24px',
      },
    },
  },
  plugins: [],
};
