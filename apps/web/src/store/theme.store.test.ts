import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useThemeStore } from './theme.store';

// theme.store.ts applies its initial theme to <html> and persists to
// localStorage as a side effect of module load, outside any component --
// so these tests drive the store directly rather than through a render.
describe('theme.store', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    // Leave both store and DOM in the state other test files' modules
    // expect when they import useThemeStore fresh (light, no persisted
    // choice), since the store itself is a module-level singleton.
    localStorage.clear();
    useThemeStore.setState({ theme: 'light' });
    document.documentElement.setAttribute('data-theme', 'light');
  });

  it('setTheme updates the store and the <html data-theme> attribute', () => {
    useThemeStore.getState().setTheme('dark');
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    useThemeStore.getState().setTheme('light');
    expect(useThemeStore.getState().theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('setTheme persists the choice to localStorage', () => {
    useThemeStore.getState().setTheme('dark');
    expect(localStorage.getItem('rc-theme')).toBe('dark');

    useThemeStore.getState().setTheme('light');
    expect(localStorage.getItem('rc-theme')).toBe('light');
  });

  it('toggleTheme flips between light and dark', () => {
    useThemeStore.setState({ theme: 'light' });
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('dark');

    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('setTheme briefly adds and removes the theme-transition class', async () => {
    useThemeStore.getState().setTheme('dark');
    expect(document.documentElement.classList.contains('theme-transition')).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(document.documentElement.classList.contains('theme-transition')).toBe(false);
  });
});
