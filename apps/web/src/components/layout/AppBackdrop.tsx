// The signed-in app's backdrop: broad silk-like sheets sweeping diagonally
// across the canvas, each shaded across its width, with a faint Cherry Red
// rim light along their edges. It gives the glass sidebar something to
// frost. Colours come from the theme tokens, so it is graphite on Jet Black
// in the dark theme and pale grey in the light one, and kept low-contrast
// so it never competes with page content.
const sheet = (token: string, alpha = 1) => ({ stopColor: `rgb(var(${token}) / ${alpha})` });

export function AppBackdrop() {
  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
      <svg viewBox="0 0 1200 1100" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
        <defs>
          <linearGradient id="rc-bd-a" x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" style={sheet('--rc-base-700')} />
            <stop offset="1" style={sheet('--rc-base-950')} />
          </linearGradient>
          <linearGradient id="rc-bd-b" x1="0" y1="0" x2="0.25" y2="1">
            <stop offset="0" style={sheet('--rc-base-900')} />
            <stop offset="0.5" style={sheet('--rc-base-950')} />
            <stop offset="1" style={sheet('--rc-base-900')} />
          </linearGradient>
          <linearGradient id="rc-bd-c" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" style={sheet('--rc-base-800')} />
            <stop offset="1" style={sheet('--rc-base-950')} />
          </linearGradient>
          <filter id="rc-bd-soft"><feGaussianBlur stdDeviation="6" /></filter>
          <filter id="rc-bd-glow"><feGaussianBlur stdDeviation="3" /></filter>
          <filter id="rc-bd-ridge"><feGaussianBlur stdDeviation="14" /></filter>
        </defs>
        <rect width="1200" height="1100" style={{ fill: 'rgb(var(--rc-base-950))' }} />
        <path d="M-100,-100 H1300 V120 C1050,260 900,520 600,560 C340,595 120,470 -100,560 Z" fill="url(#rc-bd-a)" filter="url(#rc-bd-soft)" />
        <path d="M-100,560 C120,470 340,595 600,560 C900,520 1050,260 1300,120 V470 C1080,560 930,760 640,800 C380,836 150,720 -100,820 Z" fill="url(#rc-bd-b)" />
        <path d="M-100,820 C150,720 380,836 640,800 C930,760 1080,560 1300,470 V760 C1100,860 940,1010 660,1040 C420,1066 160,980 -100,1060 Z" fill="url(#rc-bd-c)" filter="url(#rc-bd-soft)" />
        <path d="M-100,1060 C160,980 420,1066 660,1040 C940,1010 1100,860 1300,760 V1200 H-100 Z" fill="url(#rc-bd-b)" />
        <g fill="none" style={{ stroke: 'rgb(var(--rc-signal))' }}>
          <path d="M-100,540 C120,450 340,575 600,540 C900,500 1050,240 1300,100" strokeOpacity="0.22" strokeWidth="10" filter="url(#rc-bd-ridge)" />
          <path d="M-100,560 C120,470 340,595 600,560 C900,520 1050,260 1300,120" strokeOpacity="0.35" strokeWidth="2" filter="url(#rc-bd-glow)" />
          <path d="M-100,820 C150,720 380,836 640,800 C930,760 1080,560 1300,470" strokeOpacity="0.22" strokeWidth="2" filter="url(#rc-bd-glow)" />
          <path d="M-100,1060 C160,980 420,1066 660,1040 C940,1010 1100,860 1300,760" strokeOpacity="0.28" strokeWidth="2" filter="url(#rc-bd-glow)" />
        </g>
      </svg>
    </div>
  );
}
