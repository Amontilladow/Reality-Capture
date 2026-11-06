import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RiskHeatmap } from './RiskHeatmap';
import type { Risk, RiskHeatmapCell } from '../../lib/risk.api';

const cell = (probability: number, impact: number, count: number, ids: string[] = []): RiskHeatmapCell => ({
  probability, impact, count, riskIds: ids, score: probability * impact,
  level: probability * impact >= 10 ? 'HIGH' : 'LOW',
});

const cells = [cell(1, 1, 3, ['a', 'b', 'c']), cell(2, 3, 1, ['d']), cell(4, 4, 0)];
const risks = [{ id: 'd', title: 'Rebar congestion' }] as Risk[];

describe('RiskHeatmap', () => {
  it('names each cell, and marks the highest-scoring occupied cell as the single focal cell', () => {
    render(<RiskHeatmap cells={cells} risks={risks} onSelectRisk={() => {}} onFilterCell={() => {}} />);
    const focal = screen.getByRole('button', { name: /Probability 2 \(Unlikely\) × Impact 3 \(Moderate\) = 6/ });
    expect(focal).toHaveClass('border-danger');
    expect(document.querySelectorAll('button.border-danger')).toHaveLength(1);
    expect(screen.getByText(/Highest-scoring cell with open risks \(score 6, 1 risk\)/)).toBeInTheDocument();
  });

  it('outlines high-severity cells and leaves empty cells disabled', () => {
    render(<RiskHeatmap cells={cells} risks={risks} onSelectRisk={() => {}} onFilterCell={() => {}} />);
    const severeEmpty = screen.getByRole('button', { name: /Probability 4 \(Likely\) × Impact 4 \(Major\) = 16 \(High\), no open risks/ });
    expect(severeEmpty).toHaveClass('border-dashed');
    expect(severeEmpty).toBeDisabled();
  });

  it('opens a single risk directly and filters the register for a multi-risk cell', async () => {
    const user = userEvent.setup();
    const onSelectRisk = vi.fn();
    const onFilterCell = vi.fn();
    render(<RiskHeatmap cells={cells} risks={risks} onSelectRisk={onSelectRisk} onFilterCell={onFilterCell} />);
    await user.click(screen.getByRole('button', { name: /Probability 2 \(Unlikely\) × Impact 3/ }));
    expect(onSelectRisk).toHaveBeenCalledWith('d');
    await user.click(screen.getByRole('button', { name: /Probability 1 \(Rare\) × Impact 1/ }));
    expect(onFilterCell).toHaveBeenCalledWith(['a', 'b', 'c'], 'Probability 1 × Impact 1');
  });
});
