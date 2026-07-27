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
