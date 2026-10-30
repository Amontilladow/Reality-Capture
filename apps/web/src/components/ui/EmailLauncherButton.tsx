import { useEffect, useRef, useState } from 'react';
import { Tooltip } from './Tooltip';
import { showToast } from '../../store/toast.store';
import {
  type EmailProvider, getStoredEmailProvider, openEmailProvider, setStoredEmailProvider,
} from '../../lib/emailProvider';

const PROVIDER_LABELS: Record<EmailProvider, string> = {
  outlook: 'Outlook',
  gmail: 'Gmail',
  default: 'Default Email App',
};
const PROVIDER_ORDER: EmailProvider[] = ['outlook', 'gmail', 'default'];

// Requirement B/C: "the main email icon" -- opens the user's OWN mailbox
// (never a compose window; see EmailLink.tsx for addressing someone
// else's). A split button: the envelope launches directly once a
// provider is known (first use shows the menu instead), and the small
// chevron beside it always reopens the menu so the choice stays
// changeable without a separate settings screen, per the brief's own
// "a small 'Change email app' action in the same menu" suggestion.
//
// No Graph/Gmail API, no OAuth, no server round-trip: this only reads/
// writes a per-device localStorage key (lib/emailProvider.ts) and opens a
// plain web URL or mailto: link in response to the click that's already
// happening -- never assumes the user is signed in to whichever provider
// they picked.
export function EmailLauncherButton({ className = '' }: { className?: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [current, setCurrent] = useState<EmailProvider | null>(() => getStoredEmailProvider());
  const rootRef = useRef<HTMLDivElement>(null);

  // Mirrors Listbox.tsx's own outside-click-closes pattern (not extracted
  // into a shared hook -- this is the only other place that needs it, and
  // Listbox's version is itself inline, not a hook).
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  function launch(provider: EmailProvider) {
    const result = openEmailProvider(provider);
    // Only the Outlook/Gmail (window.open) path can actually detect this;
    // see openEmailProvider's own comment for why "default" never reports
    // a failure one way or the other.
    if (!result.ok && result.reason === 'popup-blocked') {
      showToast(`Your browser blocked the pop-up for ${PROVIDER_LABELS[provider]}. Allow pop-ups for this site, then try again.`, 'danger');
    }
  }

  function handleMainClick() {
    if (current) {
      launch(current);
    } else {
      setMenuOpen(true);
    }
  }

  function handleSelect(provider: EmailProvider) {
    const { persisted } = setStoredEmailProvider(provider);
    setCurrent(provider);
    setMenuOpen(false);
    launch(provider);
    // Explained only here, when it actually happened -- not on every
    // read, and not pre-emptively before anything has gone wrong.
    if (!persisted) {
      showToast("This browser couldn't remember your email app choice, so you may be asked again next time.", 'info');
    }
  }

  const mainLabel = current ? `Open email (${PROVIDER_LABELS[current]})` : 'Open email';

  return (
    <div ref={rootRef} className={`relative inline-flex ${className}`}>
      <div className="inline-flex items-center rounded overflow-hidden">
        <Tooltip label={mainLabel}>
          <button
            type="button"
            onClick={handleMainClick}
            aria-label={mainLabel}
            className="w-9 h-9 inline-flex items-center justify-center text-ink-300 hover:bg-base-700 hover:text-ink-100 transition-colors"
          >
            <IconMail className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip label="Change email app">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Change email app"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="w-6 h-9 inline-flex items-center justify-center text-ink-500 hover:bg-base-700 hover:text-ink-100 transition-colors"
          >
            <IconChevronDown className="w-3 h-3" />
          </button>
        </Tooltip>
      </div>

      {menuOpen && (
        <div
          role="menu"
          aria-label="Choose email app"
          className="absolute top-full right-0 mt-1 w-52 rounded border border-base-600 bg-base-800 shadow-lg z-20 py-1"
        >
          <div className="px-3 py-1.5 text-[11px] font-medium text-ink-500">Open email with</div>
          {PROVIDER_ORDER.map((provider) => (
            <button
              key={provider}
              role="menuitemradio"
              aria-checked={current === provider}
              type="button"
              onClick={() => handleSelect(provider)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-base-700 transition-colors ${
                current === provider ? 'text-ink-100 font-medium' : 'text-ink-300'
              }`}
            >
              {PROVIDER_LABELS[provider]}
              {current === provider && <IconCheck className="w-3.5 h-3.5 text-blueprint shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Same envelope silhouette AppShell.tsx's own nav IconMail uses, for the
// same "this reads as an email affordance" reason -- this button lives in
// that same header row.
function IconMail({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
