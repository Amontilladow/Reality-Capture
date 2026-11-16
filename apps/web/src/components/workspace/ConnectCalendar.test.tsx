import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectCalendar } from './ConnectCalendar';

const api = vi.hoisted(() => ({
  listCalendarConnections: vi.fn(),
  getCalendarAuthorizeUrl: vi.fn(),
  disconnectCalendar: vi.fn(),
}));
vi.mock('../../lib/workspace.api', async (orig) => ({ ...(await orig<typeof import('../../lib/workspace.api')>()), ...api }));

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ConnectCalendar /></QueryClientProvider>);
}

describe('ConnectCalendar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers configured providers, disables unconfigured ones, and goes to the consent page', async () => {
    api.listCalendarConnections.mockResolvedValue([
      { provider: 'google_calendar', configured: true, connected: false, connectedAt: null, lastUsedAt: null },
      { provider: 'outlook_calendar', configured: false, connected: false, connectedAt: null, lastUsedAt: null },
    ]);
    api.getCalendarAuthorizeUrl.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Connect calendar' }));
    expect(screen.getByRole('menuitem', { name: 'Outlook: not set up yet' })).toBeDisabled();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Google Calendar' }));
    expect(api.getCalendarAuthorizeUrl).toHaveBeenCalledWith('google_calendar');
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'));
    vi.unstubAllGlobals();
  });

  it('shows what is connected and lets you disconnect it', async () => {
    api.listCalendarConnections.mockResolvedValue([
      { provider: 'google_calendar', configured: true, connected: false, connectedAt: null, lastUsedAt: null },
      { provider: 'outlook_calendar', configured: true, connected: true, connectedAt: '2026-11-16T00:00:00Z', lastUsedAt: null },
    ]);
    api.disconnectCalendar.mockResolvedValue({});
    renderIt();
    const button = await screen.findByRole('button', { name: 'Connect calendar' });
    expect(button).toHaveTextContent('Outlook connected');
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Disconnect Outlook' }));
    expect(api.disconnectCalendar).toHaveBeenCalledWith('outlook_calendar');
  });
});
