/** The app's icon mark (public/logo-mark.png): the rose-gold "ribbon R",
 * a still frame of the liquid-metal logo (components/brand/liquid) on an
 * espresso tile. Rendered as an iOS-style squircle (30% corner radius).
 * favicon.png and apple-touch-icon.png are the same tile at their sizes.
 * A faint ring keeps the espresso tile's edge visible on the dark theme's
 * espresso canvas, where it would otherwise dissolve into the page. */
export function LogoMark({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <img
      src="/logo-mark.png"
      alt="Reality Capture"
      className={`${className} rounded-[30%] shrink-0 ring-1 ring-ink-100/15`}
    />
  );
}

/** The logo with the product name beside it, for the public and sign-in
 * pages. A real lockup (a 44px mark with a two-line name) rather than a
 * small mark inside an outlined pill, which read as a button. */
export function BrandLockup({ size = 'lg' }: { size?: 'md' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <div className="inline-flex items-center gap-2">
      <LogoMark className={lg ? 'w-11 h-11' : 'w-9 h-9'} />
      <div className="leading-tight">
        <div className={`${lg ? 'text-xl' : 'text-base'} font-semibold tracking-tight text-ink-100`}>Reality Capture</div>
        <div className="text-xs text-ink-500">by EngineeringOS</div>
      </div>
    </div>
  );
}
