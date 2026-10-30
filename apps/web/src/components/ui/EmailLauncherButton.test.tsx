import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailLauncherButton } from './EmailLauncherButton';
import { ToastViewport } from './Toast';
import { useToastStore } from '../../store/toast.store';

describe('EmailLauncherButton', () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => {
      useToastStore.setState({ items: [] });
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows the provider selection menu on first use (no stored preference)', async () => {
    const user = userEvent.setup();
    render(<EmailLauncherButton />);

    await user.click(screen.getByRole('button', { name: 'Open email' }));

    const menu = screen.getByRole('menu', { name: 'Choose email app' });
    expect(within(menu).getByRole('menuitemradio', { name: /Outlook/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: /Gmail/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: /Default Email App/ })).toBeInTheDocument();
  });

  it('selecting Outlook opens the Outlook web mailbox and remembers the choice', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);
    const user = userEvent.setup();
    render(<EmailLauncherButton />);

    await user.click(screen.getByRole('button', { name: 'Open email' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Outlook/ }));

    expect(openSpy).toHaveBeenCalledWith('https://outlook.com/mail/', '_blank', 'noopener,noreferrer');
    expect(localStorage.getItem('rc.emailProvider')).toBe('outlook');
  });

  it('selecting Gmail opens the Gmail web mailbox and remembers the choice', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);
    const user = userEvent.setup();
    render(<EmailLauncherButton />);

    await user.click(screen.getByRole('button', { name: 'Open email' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Gmail/ }));

    expect(openSpy).toHaveBeenCalledWith('https://mail.google.com/mail/', '_blank', 'noopener,noreferrer');
    expect(localStorage.getItem('rc.emailProvider')).toBe('gmail');
  });

  it('selecting Default Email App invokes the default mail handler, not a provider URL', async () => {
    const openSpy = vi.spyOn(window, 'open');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<EmailLauncherButton />);

    await user.click(screen.getByRole('button', { name: 'Open email' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Default Email App/ }));

    expect(openSpy).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('rc.emailProvider')).toBe('default');
  });

  it('on a later click, opens the previously selected provider directly -- no menu shown again', async () => {
    localStorage.setItem('rc.emailProvider', 'gmail');
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);
    const user = userEvent.setup();
    render(<EmailLauncherButton />);

    await user.click(screen.getByRole('button', { name: 'Open email (Gmail)' }));

    expect(openSpy).toHaveBeenCalledWith('https://mail.google.com/mail/', '_blank', 'noopener,noreferrer');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('the preference survives a fresh mount, as a stand-in for "survives a page refresh"', () => {
    localStorage.setItem('rc.emailProvider', 'outlook');
    render(<EmailLauncherButton />);
    expect(screen.getByRole('button', { name: 'Open email (Outlook)' })).toBeInTheDocument();
  });

  it('never writes the preference anywhere but localStorage -- no fetch/XHR call is made on selection', async () => {
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
    const user = userEvent.setup();
    render(<EmailLauncherButton />);

    await user.click(screen.getByRole('button', { name: 'Open email' }));
    await user.click(screen.getByRole('menuitemradio', { name: /Outlook/ }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lets the user change a previously selected provider via the "Change email app" control', async () => {
    localStorage.setItem('rc.emailProvider', 'outlook');
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);
    const user = userEvent.setup();
    render(<EmailLauncherButton />);

    // The main button alone would launch Outlook directly (per the test
    // above) -- the separate "Change email app" control is what reopens
    // the menu despite a preference already being stored.
    await user.click(screen.getByRole('button', { name: 'Change email app' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /Outlook/ })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('menuitemradio', { name: /Gmail/ }));

    expect(openSpy).toHaveBeenLastCalledWith('https://mail.google.com/mail/', '_blank', 'noopener,noreferrer');
    expect(localStorage.getItem('rc.emailProvider')).toBe('gmail');
    expect(screen.getByRole('button', { name: 'Open email (Gmail)' })).toBeInTheDocument();
  });

  it('closes the menu without changing the preference when clicking outside it', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <div data-testid="outside">elsewhere</div>
        <EmailLauncherButton />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Open email' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(localStorage.getItem('rc.emailProvider')).toBeNull();
  });

  it('closes the menu on Escape', async () => {
    const user = userEvent.setup();
    render(<EmailLauncherButton />);

    await user.click(screen.getByRole('button', { name: 'Open email' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('shows a helpful, non-crashing message when the provider pop-up is blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    render(
      <>
        <EmailLauncherButton />
        <ToastViewport />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Open email' }));
    await act(async () => {
      await user.click(screen.getByRole('menuitemradio', { name: /Outlook/ }));
    });

    expect(await screen.findByText(/pop-up/i)).toBeInTheDocument();
    // The choice is still remembered even though the window couldn't open --
    // "retry" on a later click should work without going through the menu again.
    expect(localStorage.getItem('rc.emailProvider')).toBe('outlook');
  });
});

describe('EmailLauncherButton row variant', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('lays out as a labelled menu row whose provider list opens inline', async () => {
    const user = userEvent.setup();
    render(<EmailLauncherButton variant="row" />);
    const main = screen.getByRole('button', { name: 'Open email' });
    expect(main).toHaveTextContent('Open my email');

    await user.click(screen.getByRole('button', { name: 'Change email app' }));
    const menu = screen.getByRole('menu', { name: 'Choose email app' });
    expect(menu.className).not.toMatch(/absolute/);
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(3);
  });
});
