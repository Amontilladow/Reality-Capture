import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { LiveClock } from './LiveClock';

// A fixed instant with an unambiguous UTC-vs-Asia/Dubai (UTC+4) difference,
// so a test that accidentally rendered the local/UTC time instead of the
// Dubai time would show a different hour and fail loudly rather than
// coincidentally matching.
const FIXED_UTC = new Date('2026-03-01T10:15:30.000Z'); // 14:15:30 in Asia/Dubai

describe('LiveClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_UTC);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the Asia/Dubai time, not UTC or the test runner\'s local time', () => {
    render(<LiveClock />);
    expect(screen.getByText('14:15:30')).toBeInTheDocument();
  });

  it('renders the Asia/Dubai date alongside the timezone label', () => {
    render(<LiveClock />);
    // Split across two text nodes (date, then "· Asia/Dubai"), so match
    // against the whole container's text rather than a single node.
    expect(screen.getByTitle('Abu Dhabi / Dubai time (UTC+4)').textContent).toMatch(/Sun 01 Mar.*Asia\/Dubai/);
  });

  it('updates once per second without a page refresh', () => {
    render(<LiveClock />);
    expect(screen.getByText('14:15:30')).toBeInTheDocument();

    // advanceTimersByTime both moves vitest's mocked Date forward and fires
    // the interval callback at that new time -- a separate setSystemTime
    // call here would double-advance the clock.
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('14:15:31')).toBeInTheDocument();
  });

  it('clears its timer on unmount, leaving no running interval behind', () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const { unmount } = render(<LiveClock />);
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    // Advancing time after unmount must not throw or touch a detached DOM
    // node -- this is the concrete symptom a leaked interval would cause.
    act(() => {
      vi.setSystemTime(new Date(FIXED_UTC.getTime() + 5000));
      vi.advanceTimersByTime(5000);
    });
  });

  it('mounting and unmounting twice leaves exactly one interval active at a time (no duplicate timers)', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const first = render(<LiveClock />);
    first.unmount();
    render(<LiveClock />);

    expect(setIntervalSpy).toHaveBeenCalledTimes(2); // one per mount, not accumulating
  });

  it('refreshes immediately when the tab becomes visible again, not waiting for the next tick', () => {
    render(<LiveClock />);

    // Simulate a large, unobserved jump (tab was hidden/throttled, then
    // resumed) -- the visibilitychange listener should pick it up right
    // away rather than waiting up to a full second for the next tick.
    vi.setSystemTime(new Date(FIXED_UTC.getTime() + 60_000));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(screen.getByText('14:16:30')).toBeInTheDocument();
  });
});
