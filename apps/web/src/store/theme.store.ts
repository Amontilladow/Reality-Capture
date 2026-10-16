import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'rc-theme';
// Matches index.css's .theme-transition rule -- see its own comment for why
// this is scoped to a brief window around the switch rather than left on.
const TRANSITION_MS = 200;

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Mirrors the inline bootstrap script in index.html (which runs before any
// JS module loads, so the <html data-theme> attribute is already correct
// before first paint -- see that script's own comment on why) -- this just
// re-derives the same decision so the store's initial state agrees with
// what's already on the page, instead of disagreeing for one render.
function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage unavailable (private browsing, disabled) -- fall through
  }
  return systemTheme();
}

function applyTheme(theme: Theme, { animate = false }: { animate?: boolean } = {}) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), TRANSITION_MS);
  }
  root.setAttribute('data-theme', theme);
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readInitialTheme(),
  setTheme: (theme) => {
    // No animated flash on the very first application (module load, before
    // any component mounted) -- only an explicit user action should
    // trigger the transition.
    applyTheme(theme, { animate: true });
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Store/DOM still update even if persistence isn't available.
    }
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));

// Keep <html data-theme> in sync with the store's initial value in case
// index.html's inline bootstrap script didn't run (a stale cached HTML
// shell, a test harness that renders main.tsx directly) -- a no-op
// attribute write when it already matches.
applyTheme(useThemeStore.getState().theme);

// Live-follow OS theme changes, but only until the user makes an explicit
// choice of their own -- once setTheme()/toggleTheme() has persisted a
// value, readInitialTheme() is never consulted again, so this listener
// stops affecting the app rather than fighting the user's pick.
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return; // explicit choice already made
    } catch {
      return;
    }
    const theme: Theme = e.matches ? 'dark' : 'light';
    applyTheme(theme, { animate: true });
    useThemeStore.setState({ theme });
  });
}
