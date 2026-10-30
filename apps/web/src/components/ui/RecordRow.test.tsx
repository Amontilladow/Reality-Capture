import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordList, RecordRow } from './RecordRow';

describe('RecordRow', () => {
  it('reads as one button: title, context, due and owner', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <RecordList label="Level 3">
        <RecordRow marker="bg-danger" title="Missing edge protection" meta="MGT-B-STR-0001 · Critical · Structural" due="Overdue 2d" dueTone="danger" owner="Sam Okafor" onClick={onClick} />
        <RecordRow title="Sprinkler clash" meta="MGT-B-MEP-0001 · Medium" onClick={() => {}} />
      </RecordList>,
    );
    expect(screen.getByRole('list', { name: 'Level 3' })).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /Missing edge protection.*Critical.*Overdue 2d.*Assigned to Sam Okafor/ });
    await user.click(row);
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByRole('img', { name: 'Unassigned' })).toBeInTheDocument();
  });
});
