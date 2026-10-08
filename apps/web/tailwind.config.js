/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Blueprint-dark technical palette — surveying/drafting instrument feel
        base: {
          950: '#0A141C', // deepest background
          900: '#0F1B25',
          800: '#182631', // panel surface
          700: '#22323F', // raised surface / hover
          600: '#324656', // borders
          500: '#4A6178', // muted borders / dividers
        },
        ink: {
          100: '#EAF0F4', // primary text
          300: '#B7C4CE', // secondary text
          500: '#7E8F9C', // muted / placeholder
        },
        signal: {
          // "safety orange" — primary action, matches hi-vis site equipment
          DEFAULT: '#FF7A29',
          hover: '#FF8F4D',
          muted: '#7A4022',
        },
        blueprint: {
          // cyan linework — info, links, secondary accents
          DEFAULT: '#4FB6E8',
          hover: '#72C6ED',
          muted: '#20475A',
        },
        ok: '#4ADE80',
        warn: '#FBBF24',
        danger: '#F87171',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
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
        'grid-fine': `linear-gradient(rgba(79,182,232,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(79,182,232,0.06) 1px, transparent 1px)`,
      },
      backgroundSize: {
        'grid-fine': '24px 24px',
      },
      borderRadius: {
        sm: '2px',
        DEFAULT: '3px',
        md: '4px',
      },
    },
  },
  plugins: [],
};
