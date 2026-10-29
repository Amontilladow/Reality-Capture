import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ColumnBars, DashCard, NoirList, RadialGauge, SegmentBar } from './Dash';

describe('SegmentBar', () => {
  it('computes shares from string counts as numbers, not concatenated text', () => {
    // The reports API returns Postgres bigint counts as strings.
    const segs = [
      { key: 'open', label: 'Open', value: '6' as unknown as number, style: 'sun' as const },
      { key: 'fixed', label: 'Fixed', value: '3' as unknown as number, style: 'noir' as const },
      { key: 'verified', label: 'Verified', value: '1' as unknown as number, style: 'outline' as const },
    ];
    render(<SegmentBar label="Snag items by status" segments={segs} />);
    expect(screen.getByRole('list', { name: 'Snag items by status, 10 total' })).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('10%')).toBeInTheDocument();
  });

  it('leaves zero categories out and says so when everything is zero', () => {
    const { rerender } = render(
      <SegmentBar label="Risks" segments={[{ key: 'a', label: 'A', value: 2, style: 'noir' }, { key: 'b', label: 'B', value: 0, style: 'sun' }]} />,
    );
    expect(screen.queryByText('B')).not.toBeInTheDocument();
    rerender(<SegmentBar label="Risks" segments={[{ key: 'a', label: 'A', value: 0, style: 'noir' }]} />);
    expect(screen.getByText('Risks: nothing open.')).toBeInTheDocument();
  });
});

describe('ColumnBars', () => {
  it('spells the data out for assistive tech and marks only the focal column', () => {
    render(
      <ColumnBars
        title="Issues by priority" unit="issues" focalKey="critical"
        data={[{ key: 'critical', label: 'Critical', value: 2 }, { key: 'low', label: 'Low', value: 5 }]}
      />,
    );
    expect(screen.getByRole('figure', { name: 'Issues by priority (issues): Critical 2, Low 5.' })).toBeInTheDocument();
    expect(document.querySelectorAll('.bg-sun')).toHaveLength(2); // the focal bar and its value pill
  });

  it('drills down when a column label is pressed', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ColumnBars title="t" unit="open risks" data={[{ key: 'STR', label: 'Structural', short: 'Str', value: 3 }]} onSelect={onSelect} selectLabel="Filter to" />);
    await user.click(screen.getByRole('button', { name: 'Filter to: Structural, 3 open risks' }));
    expect(onSelect).toHaveBeenCalledWith('STR');
  });
});

describe('RadialGauge', () => {
  it('is an image named with its value', () => {
    render(<RadialGauge value={23} label="Project risk index" caption="Low" />);
    expect(screen.getByRole('img', { name: 'Project risk index: 23 of 100, Low' })).toBeInTheDocument();
  });
});

describe('DashCard + NoirList', () => {
  it('renders an arrow link and clickable rows with their state', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <MemoryRouter>
        <DashCard tone="noir" title="Requires attention" to="/risk" openLabel="Open risk page">
          <NoirList
            empty="Nothing"
            items={[{ key: 'r1', title: 'Rebar congestion', meta: 'R-1 · No owner', icon: null, state: 'flag', onClick }]}
          />
        </DashCard>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Open risk page' })).toHaveAttribute('href', '/risk');
    expect(screen.getByLabelText('Needs action')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Rebar congestion/ }));
    expect(onClick).toHaveBeenCalled();
  });
});
