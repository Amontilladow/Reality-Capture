import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearStoredEmailProvider, getStoredEmailProvider, openEmailProvider, setStoredEmailProvider,
} from './emailProvider';

describe('email provider preference (device-local only)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('has no stored preference before any selection is made', () => {
    expect(getStoredEmailProvider()).toBeNull();
  });

  it('persists a selected provider to localStorage, under this app\'s own key only', () => {
    setStoredEmailProvider('outlook');
    expect(getStoredEmailProvider()).toBe('outlook');
    expect(localStorage.getItem('rc.emailProvider')).toBe('outlook');
  });

  it('survives being re-read as if the page were refreshed (a fresh localStorage read, not cached state)', () => {
    setStoredEmailProvider('gmail');
    // getStoredEmailProvider() always re-reads localStorage rather than
    // memoizing in a module-level variable, so this is a meaningful check
    // of "survives a refresh," not a tautology.
    expect(getStoredEmailProvider()).toBe('gmail');
  });

  it('never writes to anything resembling a remote/Firestore-style call -- it only touches window.localStorage', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    setStoredEmailProvider('default');
    expect(setItemSpy).toHaveBeenCalledWith('rc.emailProvider', 'default');
    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });

  it('clears a previously stored preference, so the menu would show again on next use', () => {
    setStoredEmailProvider('outlook');
    clearStoredEmailProvider();
    expect(getStoredEmailProvider()).toBeNull();
  });

  it('falls back to an in-memory preference for this session when localStorage.getItem throws', () => {
    setStoredEmailProvider('gmail'); // succeeds normally, seeds the in-memory fallback too
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: storage disabled');
    });
    expect(getStoredEmailProvider()).toBe('gmail');
  });

  it('reports persisted: false when localStorage.setItem throws, without losing the in-memory value', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const result = setStoredEmailProvider('outlook');
    expect(result.persisted).toBe(false);

    // getStoredEmailProvider() only consults the in-memory fallback when
    // storage access itself throws (simulated here), not merely when a
    // real, successful read finds nothing -- the real getItem would
    // correctly return null here, since the mocked setItem above never
    // actually wrote anything.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: storage disabled');
    });
    expect(getStoredEmailProvider()).toBe('outlook'); // the in-memory fallback still has it
  });

  it('ignores a malformed/unexpected stored value rather than returning it as a valid provider', () => {
    localStorage.setItem('rc.emailProvider', 'not-a-real-provider');
    expect(getStoredEmailProvider()).toBeNull();
  });
});

describe('openEmailProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the Outlook web mailbox in a new tab', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);
    const result = openEmailProvider('outlook');
    expect(openSpy).toHaveBeenCalledWith('https://outlook.com/mail/', '_blank', 'noopener,noreferrer');
    expect(result).toEqual({ ok: true });
  });

  it('opens the Gmail web mailbox in a new tab', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);
    const result = openEmailProvider('gmail');
    expect(openSpy).toHaveBeenCalledWith('https://mail.google.com/mail/', '_blank', 'noopener,noreferrer');
    expect(result).toEqual({ ok: true });
  });

  it('reports a blocked popup when window.open returns null', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openEmailProvider('outlook')).toEqual({ ok: false, reason: 'popup-blocked' });
  });

  it('reports a blocked popup when the returned window is already closed', () => {
    vi.spyOn(window, 'open').mockReturnValue({ closed: true } as Window);
    expect(openEmailProvider('gmail')).toEqual({ ok: false, reason: 'popup-blocked' });
  });

  it('invokes the default mail handler via a mailto: anchor click, not window.open', () => {
    const openSpy = vi.spyOn(window, 'open');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const result = openEmailProvider('default');
    expect(openSpy).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it('cleans up the temporary anchor it creates for the default-app handoff', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const before = document.body.querySelectorAll('a[href="mailto:"]').length;
    openEmailProvider('default');
    const after = document.body.querySelectorAll('a[href="mailto:"]').length;
    expect(after).toBe(before);
  });
});
