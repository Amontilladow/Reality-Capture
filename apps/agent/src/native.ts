// Thin adapters over the three native/OS-level packages this agent uses.
// Kept as plain, individually-importable functions (rather than calling
// active-win/desktop-idle/screenshot-desktop inline everywhere) so the
// orchestration logic elsewhere (ActivityTracker, the screenshot cycle)
// takes these as injected function parameters and can be unit-tested with
// fakes, without needing the real native modules -- or a real display --
// present. See README.md's "How this was tested" section: these functions
// themselves are NOT covered by the unit tests in this repo, since running
// them for real requires an actual Windows/macOS machine with a display.
import { activeWindow } from 'active-win';
import desktopIdle from 'desktop-idle';
import screenshot from 'screenshot-desktop';

// active-win's own idle-detection heuristics aside, we only need
// owner.name -- the OS-reported application name, not any window content.
export async function getActiveApplicationName(): Promise<string | undefined> {
  const result = await activeWindow();
  return result?.owner?.name;
}

// OS idle-time API only (Windows: GetLastInputInfo via desktop-idle's
// native binding) -- never a keyboard/mouse hook, and never keystroke
// content. Seconds since the last user input, system-wide.
export function getIdleSeconds(): number {
  return desktopIdle.getIdleTime();
}

// Cross-platform screen capture to a JPEG buffer. No keystroke or window-
// content inspection beyond the raw pixels a human looking at the screen
// would also see.
export async function captureScreenshot(): Promise<Buffer> {
  return screenshot({ format: 'jpg' });
}
