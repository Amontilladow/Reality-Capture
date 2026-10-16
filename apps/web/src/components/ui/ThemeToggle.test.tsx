import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './ThemeToggle';
import { useThemeStore } from '../../store/theme.store';

describe('ThemeToggle', () => {
  beforeEach(() => {
    act(() => {
      useThemeStore.setState({ theme: 'light' });
    });
    document.documentElement.setAttribute('data-theme', 'light');
  });

  afterEach(() => {
    localStorage.clear();
    act(() => {
      useThemeStore.setState({ theme: 'light' });
    });
    document.documentElement.setAttribute('data-theme', 'light');
  });

  it('labels itself "Switch to dark mode" in light mode', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });

  it('labels itself "Switch to light mode" in dark mode', () => {
    act(() => {
      useThemeStore.setState({ theme: 'dark' });
    });
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('toggles the theme and its own label when clicked', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    const button = screen.getByRole('button', { name: 'Switch to dark mode' });
    await user.click(button);

    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('shows an accessible tooltip on focus', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.tab();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Switch to dark mode');
  });
});
