/** The app's icon mark (public/logo-mark.png) -- the chrome building/point-cloud
 * graphic, replacing the old inline-SVG orange/cyan square+cross mark that used
 * to be duplicated (with its hardcoded brand hex values) across five separate
 * files. Rendered as an iOS-style squircle tile, per the app's Mobbin-derived
 * design language (app-icon-squircle: 30% corner radius). */
export function LogoMark({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <img
      src="/logo-mark.png"
      alt="Reality Capture"
      className={`${className} rounded-[30%] shrink-0`}
    />
  );
}
