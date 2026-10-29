import { ThemeToggle } from '../ui/ThemeToggle';

// The brand visual shared by the auth screens and the public landing page:
// the official artwork (public/branding/reality-capture-hero.webp) on its
// own black field, with floating capability chips in the dashboard theme.
// The right-hand visual: the brand artwork on its own black field, full
// width at its natural aspect (never cropped, so the full wordmark always
// shows) with its top and bottom edges faded into the field, and chips
// naming what the product actually does -- no invented meetings or people.
export function BrandPanel({ className = '', showThemeToggle = true }: { className?: string; showThemeToggle?: boolean }) {
  return (
    <div className={`relative rounded-[2.5rem] overflow-hidden bg-black ${className}`}>
      <img
        src="/branding/reality-capture-hero.webp"
        alt="Reality Capture by EngineeringOS: capture, analyze, automate, single source of truth"
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full h-auto [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]"
      />

      {/* Theme toggle in the panel's top-right corner, on a light disc. */}
      {showThemeToggle && (
        <div className="absolute top-5 right-5 w-14 h-14 rounded-full bg-base-950 flex items-center justify-center">
          <ThemeToggle />
        </div>
      )}

      {/* Stacked chips, top left: a sun card over a noir one. */}
      <div aria-hidden="true" className="absolute top-8 left-8">
        <div className="relative w-64 rounded-2xl bg-sun text-noir px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <span className="text-sm font-medium">360° site captures</span>
            <span className="w-2 h-2 rounded-full bg-noir mt-1.5" />
          </div>
          <span className="block text-xs mt-1 opacity-80">Pinned to building, level and room</span>
        </div>
        <div className="ml-8 -mt-2 w-60 rounded-b-2xl bg-noir text-on-noir px-4 pt-4 pb-3 flex items-center justify-between">
          <span className="text-xs text-on-noir/80">Linked to BIM elements</span>
          <span className="w-2 h-2 rounded-full bg-sun" />
        </div>
      </div>

      {/* Hatched strip and a white card, bottom left. */}
      <div aria-hidden="true" className="absolute bottom-10 left-8 right-8 flex items-end gap-4">
        <div className="w-64 rounded-2xl bg-base-800 text-ink-100 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <span className="text-sm font-medium">Issues, RFIs and snags</span>
            <span className="w-2 h-2 rounded-full bg-sun mt-1.5" />
          </div>
          <span className="block text-xs text-ink-300 mt-1">Tracked against what was actually built</span>
          <div className="flex gap-1.5 mt-3">
            {['Capture', 'Analyze', 'Automate'].map((t) => (
              <span key={t} className="badge bg-base-700 text-ink-300">{t}</span>
            ))}
          </div>
        </div>
        <div className="flex-1 h-16 rounded-2xl dash-stripes-light" />
      </div>
    </div>
  );
}
