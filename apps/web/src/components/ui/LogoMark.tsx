/** The app's icon mark (public/logo-mark.png): the rose-gold "ribbon R",
 * a still frame of the liquid-metal logo (components/brand/liquid) on an
 * espresso tile. Rendered as an iOS-style squircle (30% corner radius).
 * favicon.png and apple-touch-icon.png are the same tile at their sizes. */
export function LogoMark({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <img
      src="/logo-mark.png"
      alt="Reality Capture"
      className={`${className} rounded-[30%] shrink-0`}
    />
  );
}
