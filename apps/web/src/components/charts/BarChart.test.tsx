import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarChart } from './BarChart';

const rows = [
  { key: 'critical', label: 'Critical', value: 2 },
  { key: 'high', label: 'High', value: 5 },
  { key: 'low', label: 'Low', value: 0 },
];

describe('BarChart', () => {
  it('is an accessible figure whose description spells out every value', () => {
    render(<BarChart title="Issues by priority" unit="issues" data={rows} />);
    const figure = screen.getByRole('img', { name: /Issues by priority \(issues\)/ });
    expect(figure).toHaveAccessibleDescription('Critical: 2, High: 5, Low: 0.');
  });

  it('accents only the focal bar, and only when it has a value', () => {
    const { container, rerender } = render(<BarChart title="t" data={rows} focalKey="critical" focalTone="danger" />);
    expect(container.querySelectorAll('rect.stroke-danger')).toHaveLength(1);
    rerender(<BarChart title="t" data={rows} focalKey="low" focalTone="danger" />);
    expect(container.querySelectorAll('rect.stroke-danger')).toHaveLength(0);
  });

  it('draws no bar for a zero value but still prints the 0', () => {
    const { container } = render(<BarChart title="t" data={rows} />);
    expect(container.querySelectorAll('rect')).toHaveLength(2);
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('folds more than 8 categories into a disclosed "Other" bar', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ key: `t${i}`, label: `Trade ${i}`, value: 10 - i }));
    render(<BarChart title="Snags by trade" data={many} />);
    expect(screen.getByText('Other (3)')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleDescription(/Other combines Trade 7 \(3\), Trade 8 \(2\), Trade 9 \(1\)\./);
  });

  it('turns rows into buttons when onSelect is given', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<BarChart title="t" unit="open risks" data={rows} onSelect={onSelect} selectLabel="Filter the register to" />);
    await user.click(screen.getByRole('button', { name: 'Filter the register to: High, 5 open risks' }));
    expect(onSelect).toHaveBeenCalledWith('high');
  });

  it('shows an empty state instead of an all-zero chart', () => {
    render(<BarChart title="t" data={[{ key: 'a', label: 'A', value: 0 }]} />);
    expect(screen.getByText('No data yet.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
