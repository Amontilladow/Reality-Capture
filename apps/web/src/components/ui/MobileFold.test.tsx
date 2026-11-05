import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileFold } from './MobileFold';
import { SectionHeader } from './SectionHeader';
import { NoirList } from '../dash/Dash';

// jsdom has no matchMedia, which useMediaQuery reads as the phone layout;
// stubbing it in makes the desktop case explicit.
function asDesktop() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {},
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MobileFold', () => {
  it('folds a section to its title and summary on a phone, opening on tap', async () => {
    const user = userEvent.setup();
    render(
      <MobileFold title="Issues" summary="2 critical out of 8 issues">
        <SectionHeader title="Issues" />
        <p>Issue charts</p>
      </MobileFold>,
    );
    const toggle = screen.getByRole('button', { name: /^Issues\s*2 critical out of 8 issues$/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Issue charts')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Issue charts')).toBeInTheDocument();
    // The fold already names the section; the inner header steps aside.
    expect(screen.queryByRole('heading', { name: 'Issues' })).not.toBeInTheDocument();
  });

  it('renders the section unchanged on desktop', () => {
    asDesktop();
    render(
      <MobileFold title="Issues" summary="2 critical">
        <SectionHeader title="Issues" />
        <p>Issue charts</p>
      </MobileFold>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Issues' })).toBeInTheDocument();
    expect(screen.getByText('Issue charts')).toBeInTheDocument();
  });
});

describe('NoirList on a phone', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ key: String(i), icon: null, title: `Risk ${i + 1}`, meta: '', state: 'idle' as const }));

  it('shows three rows and a "Show all" toggle', async () => {
    const user = userEvent.setup();
    render(<NoirList items={items} empty="None" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Show all 5' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('shows every row on desktop', () => {
    asDesktop();
    render(<NoirList items={items} empty="None" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });
});
