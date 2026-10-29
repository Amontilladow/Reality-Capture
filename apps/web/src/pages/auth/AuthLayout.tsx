import type { ReactNode } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { LogoMark } from '../../components/ui/LogoMark';
import { ThemeToggle } from '../../components/ui/ThemeToggle';

// Shared frame for every auth screen (sign in, sign up, invitation,
// password reset), in the dashboard theme: the form sits on the page
// gradient at left, and the right half is a large rounded panel carrying
// the official brand artwork (public/branding/reality-capture-hero.webp)
// with a few floating capability chips over it. Inputs and the submit
// button take the auth-form variants defined in index.css.
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  useDocumentTitle(title);

  return (
    <div className="min-h-screen p-3 sm:p-5 lg:grid lg:grid-cols-2 lg:gap-5">
      <div className="min-h-[calc(100vh-1.5rem)] sm:min-h-[calc(100vh-2.5rem)] flex flex-col px-3 py-4 sm:px-8 sm:py-6">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2.5 rounded-full border border-ink-500/50 pl-2 pr-5 py-1.5">
            <LogoMark className="w-8 h-8" />
            <span className="text-lg font-light tracking-tight text-ink-100">Reality Capture</span>
          </div>
          <ThemeToggle className="lg:hidden" />
        </div>

        <div className="flex-1 flex items-center justify-center py-10">
          <div className="auth-form w-full max-w-sm">
            <div className="text-center mb-8">
              <h1 className="text-4xl font-light tracking-tight text-ink-100">{title}</h1>
              <p className="text-sm text-ink-300 mt-2">{subtitle}</p>
            </div>
            {children}
          </div>
        </div>

        <p className="text-xs text-ink-500">Reality Capture by EngineeringOS</p>
      </div>

      <BrandPanel />
    </div>
  );
}

// The right-hand visual: the brand artwork on its own black field, full
// width at its natural aspect (never cropped, so the full wordmark always
// shows) with its top and bottom edges faded into the field, and chips
// naming what the product actually does -- no invented meetings or people.
function BrandPanel() {
  return (
    <div className="hidden lg:block relative rounded-[2.5rem] overflow-hidden bg-black">
      <img
        src="/branding/reality-capture-hero.webp"
        alt="Reality Capture by EngineeringOS: capture, analyze, automate, single source of truth"
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full h-auto [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]"
      />

      {/* Theme toggle in the panel's top-right corner, on a light disc. */}
      <div className="absolute top-5 right-5 w-14 h-14 rounded-full bg-base-950 flex items-center justify-center">
        <ThemeToggle />
      </div>

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
