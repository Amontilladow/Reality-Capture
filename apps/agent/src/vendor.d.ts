// Minimal ambient declarations for the two native dependencies with no
// published types (no @types/* package exists for either). Only the
// surface this package actually calls is declared.

declare module 'desktop-idle' {
  const desktopIdle: {
    // Seconds since the last user input, system-wide -- the OS idle-time
    // API only, never a keyboard/mouse hook.
    getIdleTime(): number;
  };
  export default desktopIdle;
}

declare module 'screenshot-desktop' {
  interface ScreenshotOptions {
    format?: 'jpg' | 'png';
    screen?: string;
  }
  function screenshot(options?: ScreenshotOptions): Promise<Buffer>;
  export default screenshot;
}
