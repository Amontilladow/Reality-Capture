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
          // the interactive/info accent (links, active states, info badges):
          // deep amber in light mode, the sun yellow in dark mode -- see
          // index.css. Focus rings use --rc-focus, not this.
          DEFAULT: 'rgb(var(--rc-blueprint) / <alpha-value>)',
          hover: 'rgb(var(--rc-blueprint-hover) / <alpha-value>)',
          muted: 'rgb(var(--rc-blueprint-muted) / <alpha-value>)',
        },
        // Dashboard-canvas accents (Risk + Reports); see index.css.
        sun: 'rgb(var(--rc-sun) / <alpha-value>)',
        noir: {
          DEFAULT: 'rgb(var(--rc-noir) / <alpha-value>)',
          hover: 'rgb(var(--rc-noir-hover) / <alpha-value>)',
        },
        'on-noir': 'rgb(var(--rc-on-noir) / <alpha-value>)',
        ok: 'rgb(var(--rc-ok) / <alpha-value>)',
        warn: 'rgb(var(--rc-warn) / <alpha-value>)',
        danger: 'rgb(var(--rc-danger) / <alpha-value>)',
        high: 'rgb(var(--rc-high) / <alpha-value>)',
        teal: {
          // Data/stat/section accent. Shares blueprint's warm amber under the
          // dashboard theme (one accent platform-wide); never used for
          // status/priority semantics (those stay on ok/warn/danger).
          DEFAULT: 'rgb(var(--rc-teal) / <alpha-value>)',
          hover: 'rgb(var(--rc-teal-hover) / <alpha-value>)',
          muted: 'rgb(var(--rc-teal-muted) / <alpha-value>)',
        },
        orange: {
          // Reserved narrowly for AI-generated content -- never a status
          // color, never mixed with warn's meaning.
          DEFAULT: 'rgb(var(--rc-orange) / <alpha-value>)',
          hover: 'rgb(var(--rc-orange-hover) / <alpha-value>)',
          muted: 'rgb(var(--rc-orange-muted) / <alpha-value>)',
        },
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
        // One modular scale, ratio 1.25 (major third), anchored on 14px body
        // text (text-sm). Each step is the one below times 1.25:
        //   xs 11.2 / sm 14 / base 17.5 / xl 21.9 / 2xl 27.3 / 3xl 34.2 /
        //   4xl 42.7 / 5xl 53.4 / 6xl 66.8 / 7xl 83.4  (px)
        // lg shares base's step and caption/axis/eyebrow share xs's, so no
        // size exists off the scale. Line heights land on the 4px half-grid.
        xs: ['0.7rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1.09375rem', { lineHeight: '1.5rem' }],
        lg: ['1.09375rem', { lineHeight: '1.5rem' }],
        xl: ['1.3671875rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.708984375rem', { lineHeight: '2rem' }],
        // Display sizes resolve through --rc-fs-* (index.css): on a phone
        // each one steps down the same scale (5xl/6xl/7xl by two steps),
        // so a KPI number or hero line never dwarfs the text around it.
        '3xl': ['var(--rc-fs-3xl)', { lineHeight: '1.2' }],
        '4xl': ['var(--rc-fs-4xl)', { lineHeight: '1.15' }],
        '5xl': ['var(--rc-fs-5xl)', { lineHeight: '1' }],
        '6xl': ['var(--rc-fs-6xl)', { lineHeight: '1' }],
        '7xl': ['var(--rc-fs-7xl)', { lineHeight: '1' }],
        eyebrow: ['0.7rem', { lineHeight: '1rem', letterSpacing: '0.08em' }], // uppercase mono section/page labels
        kpi: ['1.708984375rem', { lineHeight: '2rem', letterSpacing: '-0.01em' }], // dashboard/report stat-tile numbers (2xl step)
        caption: ['0.7rem', { lineHeight: '1rem' }], // chart value labels, dense metadata (xs step)
        axis: ['0.7rem', { lineHeight: '1rem' }], // chart tick labels (xs step)
      },
      // Shadows are tinted with --rc-shadow (espresso in light, a deep warm
      // brown in dark) -- never Tailwind's flat black.
      boxShadow: {
        sm: '0 1px 2px 0 rgb(var(--rc-shadow) / 0.06)',
        DEFAULT: '0 1px 3px 0 rgb(var(--rc-shadow) / 0.10), 0 1px 2px -1px rgb(var(--rc-shadow) / 0.10)',
        md: '0 4px 8px -2px rgb(var(--rc-shadow) / 0.10), 0 2px 4px -2px rgb(var(--rc-shadow) / 0.08)',
        lg: '0 8px 24px -4px rgb(var(--rc-shadow) / 0.14), 0 4px 8px -4px rgb(var(--rc-shadow) / 0.08)',
        xl: '0 16px 32px -8px rgb(var(--rc-shadow) / 0.18), 0 8px 16px -8px rgb(var(--rc-shadow) / 0.10)',
        '2xl': '0 24px 48px -12px rgb(var(--rc-shadow) / 0.28)',
        inner: 'inset 0 2px 4px 0 rgb(var(--rc-shadow) / 0.06)',
        none: 'none',
      },
      backgroundImage: {
        // --rc-grid-line flips from a faint dark line (light mode) to a
        // faint light line (dark mode) in index.css -- a literal dark hex
        // here would be invisible against the dark-mode canvas.
        'grid-fine': `linear-gradient(var(--rc-grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--rc-grid-line) 1px, transparent 1px)`,
      },
      maxWidth: {
        measure: 'var(--rc-measure)', // running text: at most ~75 characters a line
      },
      backgroundSize: {
        'grid-fine': '24px 24px',
      },
      // Resolve through index.css's --rc-radius-* so the radius scale has one
      // source, like the colors above. Tight radii (6/8/12) suit a dense
      // engineering tool; the old 16/24 made every surface read as a bubble.
      borderRadius: {
        sm: 'var(--rc-radius-sm)',
        DEFAULT: 'var(--rc-radius-md)',
        md: 'var(--rc-radius-md)',
        lg: 'var(--rc-radius-lg)',
        card: 'var(--rc-radius-card)',
      },
    },
  },
  plugins: [],
};
