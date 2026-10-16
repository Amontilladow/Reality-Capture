/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Mobbin-inspired gallery-white palette — same token names/roles as
        // before (every component already reaches for these names, never a
        // raw hex), only the values moved from the old dark "blueprint
        // technical" scheme to a light, near-monochrome one: ink-black text
        // on white/soft-white surfaces, one electric-blue accent.
        base: {
          950: '#FFFFFF', // page background (canvas)
          900: '#F3F3F3', // chrome bars / secondary surface (canvas-soft)
          800: '#F3F3F3', // panel surface (canvas-soft)
          700: '#F0F0F0', // raised surface / hover (field)
          600: '#E0E0E0', // borders (hairline)
          500: '#F0F0F0', // muted borders / dividers (hairline-soft)
        },
        ink: {
          100: '#141414', // primary text
          300: '#707070', // secondary text
          500: '#ADADAD', // muted / placeholder
        },
        signal: {
          // primary action — ink-black fill, matches Mobbin's button-primary
          DEFAULT: '#141414',
          hover: '#262626',
          muted: '#707070',
        },
        blueprint: {
          // electric blue — Mobbin's one accent. The spec reserves it for
          // commercial signals only; this app repurposes it as the general
          // interactive/info accent (links, active states, status badges)
          // since a working dashboard needs more color differentiation than
          // a marketing page. Focus rings use ink instead, per the spec.
          DEFAULT: '#0066FF',
          hover: '#3385FF',
          muted: '#E6F0FF',
        },
        ok: '#16A34A',
        warn: '#D97706',
        danger: '#DC2626',
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
        'grid-fine': `linear-gradient(rgba(20,20,20,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(20,20,20,0.04) 1px, transparent 1px)`,
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
