/** The app's icon mark (public/logo-mark.png) -- a tight crop of the approved
 * "ribbon R" emblem from the official brand artwork (public/branding/
 * reality-capture-hero.webp is the untouched master; this is a separate,
 * purpose-built derivative since the full wide hero composition isn't
 * legible at icon sizes). Rendered as an iOS-style squircle tile, per the
 * app's Mobbin-derived design language (app-icon-squircle: 30% corner
 * radius). The same crop also backs favicon.png and apple-touch-icon.png. */
export function LogoMark({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <img
      src="/logo-mark.png"
      alt="Reality Capture"
      className={`${className} rounded-[30%] shrink-0`}
    />
  );
}
