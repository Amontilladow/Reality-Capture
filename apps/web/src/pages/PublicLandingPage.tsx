import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { LogoMark } from '../components/ui/LogoMark';
import { ThemeToggle } from '../components/ui/ThemeToggle';

// Public marketing landing page -- the first real public/marketing surface
// this app has ever had (previously "/" redirected straight to /projects,
// which bounced an unauthenticated visitor to /login with nothing to read
// first). Lives outside AppShell/ProtectedRoute entirely; see App.tsx's
// RootRoute for the auth-aware routing that decides whether a visitor lands
// here or gets sent straight into the app.
//
// Every capability named below is real and already shipped (Captures/
// BuildLens, Issues/Snagging/RFIs/Floor Plans, QAQC two-step close, the
// automated + human-assessed Risk Engine) -- nothing on this page claims a
// feature, integration, or metric that doesn't exist. The "product preview"
// section reuses the same design-system classes (panel/tick-frame, status
// tones, the app's own icon set) as the real authenticated UI so it reads
// as an honest preview of the product's visual language, not a generic
// stock screenshot or a literal mount of authenticated, data-backed pages.
export default function PublicLandingPage() {
  useDocumentTitle('Reality Capture by EngineeringOS');

  return (
    <div className="min-h-screen bg-base-950 text-ink-100">
      <SiteHeader />
      <Hero />
      <CapabilityStory
        eyebrow="Capture"
        title="See what's actually there."
        body="Register 360° photos, standard photos, and video against a building, level, and precise location — not a loose folder of files. Every capture is tied to a place and a moment, so BuildLens can play back exactly how a location changed over time."
        visual={<CaptureVisual />}
      />
      <CapabilityStory
        eyebrow="Coordinate"
        reverse
        title="Coordinate without losing the thread."
        body="Issues, snags, and RFIs all live on the same floor plan as the capture that raised them. Drop a pin, assign an owner, set a deadline — every open item stays visible on the drawing it belongs to, not buried in a separate list no one checks."
        visual={<CoordinateVisual />}
      />
      <CapabilityStory
        eyebrow="Resolve"
        title="Catch risk before it becomes a problem."
        body="Non-conformance reports move through a real two-step close: issued, responded to, and confirmed by a different role than the one that responded. An automated Risk Engine scores exposure from real signals — overdue items, high-priority flags — and a human can assess or override every score directly."
        visual={<RiskVisual />}
      />
      <ProductPreview />
      <WorkflowSequence />
      <ClosingCta />
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-base-600/60 bg-base-950/90 backdrop-blur">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <BrandMark />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link to="/login" className="btn-secondary !py-1.5 !px-4 text-xs">
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}

function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const iconSize = size === 'lg' ? 'w-9 h-9' : 'w-7 h-7';
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className={iconSize} />
      <div className="leading-tight">
        <div className={`font-semibold tracking-tight ${size === 'lg' ? 'text-lg' : ''}`}>Reality Capture</div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500">by EngineeringOS</div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-base-600/60">
      <div className="absolute inset-0 bg-grid-fine bg-grid-fine opacity-60" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-base-950" />
      <div className="relative max-w-4xl mx-auto px-6 pt-20 pb-24 sm:pt-28 sm:pb-32 text-center">
        <div className="text-eyebrow font-mono uppercase text-blueprint mb-5">Construction &amp; BIM coordination</div>
        <h1 className="text-[clamp(2.25rem,6vw,4rem)] font-semibold tracking-tight leading-[1.05] mb-6">
          Reality, understood.
        </h1>
        <p className="text-ink-300 text-base sm:text-lg leading-relaxed max-w-2xl mx-auto mb-9">
          Site documentation, BIM coordination, and issue tracking in one place — every
          capture, issue, and inspection tied to the exact building, level, and location it
          belongs to.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link to="/login" className="btn-primary !px-6 !py-3 text-sm">
            Sign in
          </Link>
        </div>
        <p className="text-xs text-ink-500 mt-5">
          Have a company signup code? <Link to="/signup" className="text-blueprint hover:text-blueprint-hover">Create an account</Link>
        </p>
      </div>
    </section>
  );
}

function CapabilityStory({
  eyebrow, title, body, visual, reverse = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <section className="border-b border-base-600/60 bg-base-950 even:bg-base-900/40">
      <div className="max-w-6xl mx-auto px-6 py-16 sm:py-20 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className={reverse ? 'lg:order-2' : 'lg:order-1'}>
          <div className="text-eyebrow font-mono uppercase text-blueprint mb-4">{eyebrow}</div>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight mb-4">{title}</h2>
          <p className="text-ink-300 text-sm sm:text-base leading-relaxed max-w-md">{body}</p>
        </div>
        <div className={reverse ? 'lg:order-1' : 'lg:order-2'}>{visual}</div>
      </div>
    </section>
  );
}

// Illustrative compositions below reuse the real design system (panel,
// tick-frame, the app's own status-tone and icon vocabulary) with plausible
// example labels -- not literal screenshots (no browser tooling available
// to capture one) and not fabricated metrics or claims, just the product's
// actual visual language applied to representative content.

function CaptureVisual() {
  return (
    <div className="tick-frame panel p-5 aspect-[4/3] flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="badge bg-blueprint/10 text-blueprint">360° Photo</span>
        <span className="text-[10px] font-mono text-ink-500">Level 3 · Grid C-4</span>
      </div>
      <div className="flex-1 my-4 rounded border border-base-600 bg-gradient-to-br from-base-700 to-base-900 flex items-center justify-center">
        <CameraIcon className="w-10 h-10 text-ink-500" />
      </div>
      <div className="flex items-center gap-2 text-xs text-ink-500">
        <span className="w-1.5 h-1.5 rounded-full bg-signal" />
        3 captures over 6 weeks — play back in BuildLens
      </div>
    </div>
  );
}

function CoordinateVisual() {
  return (
    <div className="tick-frame panel p-5 aspect-[4/3] space-y-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-ink-100">Floor Plan — Level 3</span>
        <span className="text-[10px] font-mono text-ink-500">4 open pins</span>
      </div>
      <div className="rounded border border-base-600 bg-base-900/60 h-32 relative mb-1 overflow-hidden">
        <div className="absolute inset-0 bg-grid-fine bg-grid-fine opacity-40" />
        {[['28%', '35%'], ['62%', '55%'], ['45%', '72%']].map(([left, top], i) => (
          <span
            key={i}
            className="absolute w-2.5 h-2.5 rounded-full bg-signal border-2 border-signal-hover"
            style={{ left, top }}
          />
        ))}
      </div>
      {[
        { label: 'Cracked slab, Level 3', tone: 'text-danger' },
        { label: 'RFI — ductwork clash', tone: 'text-warn' },
      ].map((row) => (
        <div key={row.label} className="flex items-center gap-2 text-xs">
          <span className={`w-1.5 h-1.5 rounded-full bg-current ${row.tone}`} />
          <span className="text-ink-300">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

function RiskVisual() {
  return (
    <div className="tick-frame panel p-5 aspect-[4/3] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-medium text-ink-100">NCR-014</span>
        <span className="badge bg-warn/10 text-warn">Pending confirmation</span>
      </div>
      <div className="flex items-end gap-3 mb-4">
        <span className="text-kpi font-semibold tabular-nums text-signal">14</span>
        <span className="text-xs text-ink-500 mb-1.5">/ 25 risk score</span>
      </div>
      <div className="flex-1 flex items-end gap-1.5">
        {[3, 5, 4, 7, 6, 8, 5].map((h, i) => (
          <div key={i} className="flex-1 bg-blueprint/50 rounded-t" style={{ height: `${h * 10}%` }} />
        ))}
      </div>
      <p className="text-[10px] text-ink-500 mt-3">Automated score · human assessment available</p>
    </div>
  );
}

function ProductPreview() {
  return (
    <section className="border-b border-base-600/60 bg-base-900/40">
      <div className="max-w-5xl mx-auto px-6 py-16 sm:py-20">
        <div className="text-center mb-10">
          <div className="text-eyebrow font-mono uppercase text-blueprint mb-4">Inside the workspace</div>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Built for the people running the job, not a dashboard for show.
          </h2>
        </div>
        <div className="tick-frame panel p-2 sm:p-3">
          <div className="rounded bg-base-900 border border-base-600 overflow-hidden">
            <div className="h-9 flex items-center gap-1.5 px-3 border-b border-base-600 bg-base-800/60">
              <span className="w-2.5 h-2.5 rounded-full bg-base-600" />
              <span className="w-2.5 h-2.5 rounded-full bg-base-600" />
              <span className="w-2.5 h-2.5 rounded-full bg-base-600" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-base-600">
              <PreviewColumn icon={<FlagIcon className="w-4 h-4" />} label="Issues" rows={[['Open', '12'], ['High priority', '3']]} />
              <PreviewColumn icon={<QaqcIcon className="w-4 h-4" />} label="QAQC" rows={[['NCR open', '2'], ['Pending confirm', '1']]} />
              <PreviewColumn icon={<ShieldIcon className="w-4 h-4" />} label="Risk" rows={[['Critical', '0'], ['High', '2']]} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PreviewColumn({
  icon, label, rows,
}: {
  icon: React.ReactNode;
  label: string;
  rows: [string, string][];
}) {
  return (
    <div className="p-4 sm:p-5">
      <div className="flex items-center gap-2 text-xs text-ink-500 mb-3">
        {icon}
        {label}
      </div>
      <div className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-sm">
            <span className="text-ink-300">{k}</span>
            <span className="font-mono font-medium text-ink-100">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const WORKFLOW_STEPS = [
  { n: '01', label: 'Capture', body: '360° photos, standard photos, and video, registered against a precise location.' },
  { n: '02', label: 'Coordinate', body: 'Issues, snags, and RFIs raised against the same drawing and location.' },
  { n: '03', label: 'Resolve', body: 'A two-step close — responded to, then confirmed by a different role.' },
  { n: '04', label: 'Report', body: 'Risk scores and progress reports built from what actually happened.' },
];

function WorkflowSequence() {
  return (
    <section className="border-b border-base-600/60">
      <div className="max-w-6xl mx-auto px-6 py-16 sm:py-20">
        <div className="text-eyebrow font-mono uppercase text-blueprint mb-4">How it fits together</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-4">
          {WORKFLOW_STEPS.map((step, i) => (
            <div key={step.n} className={`relative pt-4 ${i > 0 ? 'lg:border-l lg:border-base-600 lg:pl-6' : ''}`}>
              <div className="font-mono text-xs text-signal mb-2">{step.n}</div>
              <div className="text-base font-semibold mb-1.5">{step.label}</div>
              <p className="text-sm text-ink-500 leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="border-b border-base-600/60 bg-base-900/40">
      <div className="max-w-2xl mx-auto px-6 py-16 sm:py-20 text-center">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-4">
          Bring your project into focus.
        </h2>
        <p className="text-ink-300 text-sm sm:text-base mb-8">
          Sign in to pick up where your team left off, or create an account with your
          company's signup code.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link to="/login" className="btn-primary !px-6 !py-3 text-sm">
            Sign in
          </Link>
          <Link to="/signup" className="btn-secondary !px-6 !py-3 text-sm">
            Create an account
          </Link>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer>
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <BrandMark />
        <p className="text-xs text-ink-500">&copy; {new Date().getFullYear()} EngineeringOS. All rights reserved.</p>
      </div>
    </footer>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 8h3l2-2h6l2 2h3v11H4z" strokeLinejoin="round" /><circle cx="12" cy="13.5" r="3.2" />
    </svg>
  );
}
function FlagIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 3v18" strokeLinecap="round" /><path d="M5 4h13l-3 4 3 4H5" strokeLinejoin="round" />
    </svg>
  );
}
function QaqcIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" strokeLinejoin="round" />
      <path d="M12 9v4" strokeLinecap="round" />
      <circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z" strokeLinejoin="round" />
      <path d="M12 8v5" strokeLinecap="round" />
      <circle cx="12" cy="16" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
