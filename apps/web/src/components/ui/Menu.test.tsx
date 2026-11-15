import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu } from './Menu';

function setup(onEdit = vi.fn()) {
  render(
    <Menu
      label="More actions"
      buttonContent="More"
      sections={[
        { items: [{ label: 'Edit', onSelect: onEdit }, { label: 'Email', onSelect: vi.fn() }] },
        { heading: 'Danger', items: [{ label: 'Delete', onSelect: vi.fn(), danger: true }] },
      ]}
    />,
  );
  return { onEdit };
}

describe('Menu', () => {
  it('opens a list of actions from its button', async () => {
    setup();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Edit', 'Email', 'Delete']);
    expect(screen.getByText('Danger')).toBeInTheDocument();
  });

  it('runs the chosen action and closes', async () => {
    const { onEdit } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('moves with the arrow keys and closes on Escape, back on its button', async () => {
    setup();
    const button = screen.getByRole('button', { name: 'More actions' });
    await userEvent.click(button);
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Email' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});
