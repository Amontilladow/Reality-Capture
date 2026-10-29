// "Main email icon" preference (requirement B/C): which webmail/app the
// user wants the main email icon to open their own mailbox in. Deliberately
// separate from email-integration.api.ts, which is a different feature
// (OAuth-connected Gmail/Outlook mailbox access for composing/sending
// *through* RC). This preference never touches the backend, never carries
// a credential, and is scoped to this browser only -- see the module
// comment on STORAGE_KEY below for why.

export type EmailProvider = 'outlook' | 'gmail' | 'default';

const VALID_PROVIDERS: readonly EmailProvider[] = ['outlook', 'gmail', 'default'];

// Deliberately a plain per-device key, not namespaced by user/company id:
// the requirement is "remember on this device," full stop -- not "remember
// per RC account on this device." A shared/kiosk machine remembering one
// provider choice across whoever is logged in is the intended behavior
// here, not a bug.
const STORAGE_KEY = 'rc.emailProvider';

// Fallback when localStorage throws (Safari private mode historically, or
// a browser/extension policy blocking storage) or simply isn't available.
// Session-only, cleared on reload -- acceptable degradation; see
// getStoredEmailProvider()'s own comment for why this is safe to do
// silently rather than surfacing a warning on every call.
let memoryFallback: EmailProvider | null = null;

function isEmailProvider(value: unknown): value is EmailProvider {
  return typeof value === 'string' && (VALID_PROVIDERS as readonly string[]).includes(value);
}

export function getStoredEmailProvider(): EmailProvider | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isEmailProvider(raw) ? raw : null;
  } catch {
    // Storage unavailable (private mode, blocked, or none of this ever
    // having been set before localStorage became reachable in this
    // session) -- fall back to whatever's in memory for this page load.
    // Not worth a user-facing warning on a read; setStoredEmailProvider()
    // is the one place that explains the limitation, because that's the
    // point where "this won't survive a refresh" actually matters.
    return memoryFallback;
  }
}

export function setStoredEmailProvider(provider: EmailProvider): { persisted: boolean } {
  memoryFallback = provider;
  try {
    window.localStorage.setItem(STORAGE_KEY, provider);
    return { persisted: true };
  } catch {
    return { persisted: false };
  }
}

export function clearStoredEmailProvider(): void {
  memoryFallback = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage was never reachable to begin with.
  }
}

// Outlook: outlook.com is Microsoft's own canonical entry point for
// Outlook on the web, routing a signed-in user to their mailbox regardless
// of whether their account is a Microsoft 365 work/school account or a
// personal outlook.com/Hotmail account, and prompting sign-in first when
// they aren't authenticated yet -- exactly the "don't assume already
// authenticated" behavior this feature needs, for free, because it's the
// same page a real Outlook user already signs into by hand.
// Gmail: mail.google.com is Google's own long-standing canonical Gmail web
// address, with the same sign-in-first behavior for an unauthenticated
// browser.
const PROVIDER_URLS: Record<'outlook' | 'gmail', string> = {
  outlook: 'https://outlook.com/mail/',
  gmail: 'https://mail.google.com/mail/',
};

export interface OpenProviderResult {
  ok: boolean;
  // Set only when ok is false and the cause is known -- lets the caller
  // show a specific, actionable message instead of a generic failure.
  reason?: 'popup-blocked';
}

// Opens the user's own mailbox for the chosen provider. Outlook/Gmail are
// real navigable web pages opened via window.open(), whose return value
// reliably signals a blocked popup (null, or a window already closed by
// the blocker) -- the one failure mode this function can actually detect
// and report. "default" has no such signal: clicking a mailto: anchor
// either hands off to whatever the OS/browser has registered (silently,
// with no JS-visible success/failure) or the browser shows its own "no
// app associated" dialog -- there is nothing for this function to catch
// either way, so it always reports ok for that branch rather than
// guessing. This also, correctly, never claims to open "the inbox" for
// the default-app case: a bare mailto: is the closest honest equivalent to
// "hand off to the registered default mail handler" that any browser
// exposes -- there is no cross-platform API to open an arbitrary unknown
// app's inbox specifically.
export function openEmailProvider(provider: EmailProvider): OpenProviderResult {
  if (provider === 'default') {
    // A real <a> click (not window.open, and not location.href), the
    // standard robust way to invoke a mailto: handler without risking an
    // extra blank tab being left open in browsers that open a new one for
    // window.open('mailto:...') before handing off to the external app.
    const anchor = document.createElement('a');
    anchor.href = 'mailto:';
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return { ok: true };
  }

  const win = window.open(PROVIDER_URLS[provider], '_blank', 'noopener,noreferrer');
  if (!win || win.closed) {
    return { ok: false, reason: 'popup-blocked' };
  }
  return { ok: true };
}
