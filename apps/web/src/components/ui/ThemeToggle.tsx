import { useThemeStore } from '../../store/theme.store';
import { Tooltip } from './Tooltip';

// Single global toggle, rendered from AppShell/AuthLayout/PublicLandingPage
// only -- every screen behind those shared layouts inherits it for free
// rather than needing its own copy. Sized/styled to match
// NotificationBell/MessagesBell's own header icon buttons (w-9 h-9, rounded,
// ink-300 -> ink-100 on hover) so it reads as one more item in that same
// row, not a bolted-on control.
export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={label}
        className={`relative w-9 h-9 shrink-0 inline-flex items-center justify-center rounded text-ink-300 hover:bg-base-700 hover:text-ink-100 transition-colors ${className}`}
      >
        {/* Both icons are always mounted and crossfade -- swapping which
            one renders would lose the transition and could show neither
            for a frame. Dark mode shows the sun (switch to light); light
            mode shows the moon (switch to dark), per spec. */}
        <IconSun
          className={`w-4 h-4 absolute transition-[opacity,transform] duration-200 ${
            theme === 'dark' ? 'opacity-100 scale-100 rotate-0' : 'opacity-0 scale-50 rotate-90'
          }`}
        />
        <IconMoon
          className={`w-4 h-4 absolute transition-[opacity,transform] duration-200 ${
            theme === 'dark' ? 'opacity-0 scale-50 -rotate-90' : 'opacity-100 scale-100 rotate-0'
          }`}
        />
      </button>
    </Tooltip>
  );
}

function IconSun({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMoon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20.5 14.7A8.5 8.5 0 1 1 9.3 3.5a7 7 0 0 0 11.2 11.2z" strokeLinejoin="round" />
    </svg>
  );
}
