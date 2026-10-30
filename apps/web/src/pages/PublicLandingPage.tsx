import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { LogoMark } from '../components/ui/LogoMark';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { BrandPanel } from '../components/brand/BrandPanel';
import { DashCard, Glyph, NoirList, RadialGauge } from '../components/dash/Dash';

// Public marketing landing page -- what a signed-out visitor sees at "/"
// (App.tsx's RootRoute sends signed-in users straight to /projects).
//
// Drawn in the platform's dashboard theme, matching the sign-in screen: a
// logo pill and pill navigation, a split hero with the brand-artwork panel,
// capability cards built from the same dashboard primitives the app uses,
// and a noir call-to-action card.
//
// Every capability named below is real and already shipped (Captures and
// BuildLens; Issues, Snagging and RFIs on floor plans; the QAQC two-step
// close; the automated + human-assessed Risk Engine). Card visuals that
// show values are labelled as illustrative -- nothing here claims a
// customer metric or an integration that doesn't exist.
export default function PublicLandingPage() {
  useDocumentTitle('Reality Capture by EngineeringOS');

  return (
    <div className="min-h-screen text-ink-100">
      <SiteHeader />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 space-y-6 pb-6">
        <Hero />
        <Capabilities />
        <WorkflowSequence />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}

const NAV = [
  { href: '#capture', label: 'Capture' },
  { href: '#coordinate', label: 'Coordinate' },
  { href: '#resolve', label: 'Resolve' },
  { href: '#how-it-works', label: 'How it works' },
];

function BrandPill() {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-ink-500/50 pl-2 pr-6 py-2">
      <LogoMark className="w-8 h-8" />
      <span className="text-lg font-light tracking-tight">Reality Capture</span>
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex items-center justify-between gap-4">
      <BrandPill />
      <nav aria-label="Page sections" className="hidden lg:flex items-center gap-2 rounded-full bg-base-800/80 p-2">
        {NAV.map((n) => (
          <a key={n.href} href={n.href} className="px-4 h-9 inline-flex items-center whitespace-nowrap rounded-full text-sm text-ink-300 hover:bg-base-700 hover:text-ink-100 transition-colors">
            {n.label}
          </a>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <span className="w-11 h-11 rounded-full bg-base-800/80 inline-flex items-center justify-center"><ThemeToggle /></span>
        <Link to="/login" className="btn-primary !h-11 !px-6">Sign in</Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="grid gap-6 lg:grid-cols-2 lg:min-h-[42rem]">
      <div className="flex flex-col justify-center py-8 lg:py-16 lg:pr-6">
        <p className="text-sm text-ink-300 mb-4">Reality Capture by EngineeringOS</p>
        <h1 className="text-5xl sm:text-6xl font-light tracking-tight leading-[1.05]">Reality, understood.</h1>
        <p className="text-ink-300 text-base sm:text-lg leading-relaxed max-w-measure mt-6">
          Site documentation, BIM coordination, and issue tracking in one place: every capture,
          issue, and inspection tied to the exact building, level, and location it belongs to.
        </p>
        <div className="flex flex-wrap items-center gap-4 mt-8">
          <Link to="/login" className="btn h-12 px-8 bg-sun text-noir text-base hover:brightness-95">Sign in</Link>
          <Link to="/signup" className="btn-secondary !h-12 !px-8 text-base">Create an account</Link>
        </div>
        <p className="text-sm text-ink-500 mt-4">Creating an account needs your company’s signup code.</p>

        {/* The product's own loop as a pill row, in the theme's pill-bar grammar. */}
        <ul aria-label="Capture, coordinate, resolve" className="flex gap-2 mt-10 max-w-xl">
          {[
            { label: 'Capture', cls: 'bg-ink-100 text-base-800' },
            { label: 'Coordinate', cls: 'bg-sun text-noir' },
            { label: 'Resolve', cls: 'dash-stripes border border-base-600 text-ink-100' },
          ].map((s) => (
            <li key={s.label} className={`flex-1 h-11 rounded-full px-4 flex items-center text-xs font-medium ${s.cls}`}>{s.label}</li>
          ))}
        </ul>
      </div>
      <BrandPanel className="min-h-[24rem] lg:min-h-0" showThemeToggle={false} />
    </section>
  );
}

function Capabilities() {
  return (
    <section aria-label="What it does" className="grid gap-6 lg:grid-cols-3">
      <div id="capture" className="scroll-mt-6 min-w-0">
        <DashCard title="Capture" className="h-full">
          <p className="text-sm text-ink-300 leading-relaxed">
            Register 360° photos, standard photos, and video against a building, level, and precise
            location, not a loose folder of files. Every capture is tied to a place and a moment, so
            BuildLens can play back exactly how a location changed over time.
          </p>
          <div className="mt-auto pt-6 flex flex-wrap items-end gap-x-2 gap-y-2">
            <span className="text-6xl font-light tracking-tight leading-none">360°</span>
            <span className="text-sm text-ink-300 mb-2">photos, pinned in place</span>
          </div>
          <div className="flex gap-2 mt-4" aria-hidden="true">
            {['Building', 'Level', 'Room'].map((t, i) => (
              <span key={t} className={`flex-1 h-10 rounded-full px-4 flex items-center text-xs font-medium ${i === 2 ? 'bg-sun text-noir' : 'border border-ink-500/50'}`}>{t}</span>
            ))}
          </div>
        </DashCard>
      </div>

      <div id="coordinate" className="scroll-mt-6 min-w-0">
        <DashCard title="Coordinate" tone="noir" className="h-full">
          <p className="text-sm text-on-noir/80 leading-relaxed mb-4">
            Issues, snags, and RFIs live on the same floor plan as the capture that raised them. Drop a
            pin, assign an owner, set a deadline, and every open item stays on the drawing it belongs to.
          </p>
          <NoirList
            empty=""
            items={[
              { key: 'i', title: 'Issues', meta: 'Pinned to a drawing, with an owner and deadline', icon: <Glyph name="flag" />, state: 'flag' },
              { key: 's', title: 'Snags', meta: 'Fixed, then verified on site', icon: <Glyph name="check" />, state: 'idle' },
              { key: 'r', title: 'RFIs', meta: 'Answered, with drawing updates tracked', icon: <Glyph name="doc" />, state: 'idle' },
            ]}
          />
        </DashCard>
      </div>

      <div id="resolve" className="scroll-mt-6 min-w-0">
        <DashCard title="Resolve" className="h-full">
          <p className="text-sm text-ink-300 leading-relaxed">
            Non-conformance reports move through a real two-step close: issued, responded to, and
            confirmed by a different role. An automated Risk Engine scores exposure from real signals,
            and a human can assess or override every score.
          </p>
          <div className="mt-auto pt-4">
            <RadialGauge value={14} max={25} label="Illustrative risk score" caption="of 25" />
            <p className="text-xs text-ink-500 text-center mt-2">Illustrative score, human assessment available</p>
          </div>
        </DashCard>
      </div>
    </section>
  );
}

const WORKFLOW_STEPS = [
  { label: 'Capture', body: '360° photos, standard photos, and video, registered against a precise location.', cls: 'bg-ink-100 text-base-800' },
  { label: 'Coordinate', body: 'Issues, snags, and RFIs raised against the same drawing and location.', cls: 'bg-sun text-noir' },
  { label: 'Resolve', body: 'A two-step close: responded to, then confirmed by a different role.', cls: 'dash-stripes border border-base-600 text-ink-100' },
  { label: 'Report', body: 'Risk scores and progress reports built from what actually happened.', cls: 'border border-ink-500/50 text-ink-100' },
];

function WorkflowSequence() {
  return (
    <section id="how-it-works" className="panel p-6 sm:p-8 scroll-mt-6">
      <h2 className="text-3xl font-light tracking-tight mb-6">How it fits together</h2>
      <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {WORKFLOW_STEPS.map((step, i) => (
          <li key={step.label}>
            <div className={`h-12 rounded-full px-6 flex items-center justify-between text-sm font-medium ${step.cls}`}>
              <span>{step.label}</span>
              <span className="tabular-nums opacity-70">{i + 1}</span>
            </div>
            <p className="text-sm text-ink-300 leading-relaxed mt-4 px-2">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="dash-card-noir p-8 sm:p-12 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
      <div>
        <h2 className="text-4xl sm:text-5xl font-light tracking-tight text-on-noir">Bring your project into focus.</h2>
        <p className="text-on-noir/80 text-base mt-4 max-w-xl">
          Sign in to pick up where your team left off, or create an account with your company’s signup code.
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        <Link to="/login" className="btn h-12 px-8 bg-sun text-noir text-base hover:brightness-95">Sign in</Link>
        <Link to="/signup" className="btn h-12 px-8 border border-on-noir/40 text-on-noir text-base hover:bg-noir-hover">Create an account</Link>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
      <BrandPill />
      <p className="text-xs text-ink-500">&copy; {new Date().getFullYear()} EngineeringOS. All rights reserved.</p>
    </footer>
  );
}
