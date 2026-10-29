import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Listbox } from './Listbox';
import type { ListboxChangeEvent } from './Listbox';

function Controlled({ onChange, initial = 'open' }: { onChange?: (e: ListboxChangeEvent) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="status">Status</label>
      <Listbox
        id="status"
        value={value}
        onChange={(e) => { setValue(e.target.value); onChange?.(e); }}
      >
        <option value="">All statuses</option>
        <option value="open">Open</option>
        <option value="closed" disabled>Closed</option>
        {['resolved', 'reopened'].map((s) => (
          <option key={s} value={s}>{s === 'resolved' ? 'Resolved' : 'Reopened'}</option>
        ))}
      </Listbox>
    </>
  );
}

// The trigger also holds invisible copies of every label (width
// reservation), so read only the visible value span.
function shownValue(combo: HTMLElement) {
  return combo.querySelector('span > span:not([aria-hidden])')?.textContent;
}

describe('Listbox', () => {
  it('is a combobox named by its <label> and shows the current option', () => {
    render(<Controlled />);
    const combo = screen.getByRole('combobox', { name: 'Status' });
    expect(shownValue(combo)).toBe('Open');
    expect(combo).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on click, marks the selected option, and commits a clicked option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    const list = screen.getByRole('listbox', { name: 'Status' });
    expect(list).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Open' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: 'Resolved' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: 'resolved' }) }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(shownValue(screen.getByRole('combobox'))).toBe('Resolved');
    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('moves with arrows, skips disabled options, and commits on Enter', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const combo = screen.getByRole('combobox');
    combo.focus();
    await user.keyboard('{ArrowDown}');
    expect(combo).toHaveAttribute('aria-expanded', 'true');
    // Active starts on the selected option; Closed is disabled, so one
    // step down lands on Resolved.
    await user.keyboard('{ArrowDown}');
    const active = document.getElementById(combo.getAttribute('aria-activedescendant')!);
    expect(active).toHaveTextContent('Resolved');
    await user.keyboard('{Enter}');
    expect(shownValue(combo)).toBe('Resolved');
    expect(combo).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape without changing the value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const combo = screen.getByRole('combobox');
    combo.focus();
    await user.keyboard('{ArrowDown}{End}{Escape}');
    expect(combo).toHaveAttribute('aria-expanded', 'false');
    expect(shownValue(combo)).toBe('Open');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('supports typeahead from the closed state', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const combo = screen.getByRole('combobox');
    combo.focus();
    await user.keyboard('re');
    const active = document.getElementById(combo.getAttribute('aria-activedescendant')!);
    expect(active).toHaveTextContent('Resolved');
    await user.keyboard('{Enter}');
    expect(shownValue(combo)).toBe('Resolved');
  });

  it('falls back to the first option when the value matches none, like a native select', () => {
    render(<Controlled initial="missing" />);
    expect(shownValue(screen.getByRole('combobox'))).toBe('All statuses');
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    render(
      <Listbox aria-label="Level" value="" disabled>
        <option value="">Pick a building first</option>
      </Listbox>,
    );
    const combo = screen.getByRole('combobox', { name: 'Level' });
    expect(combo).toBeDisabled();
    await user.click(combo);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('works uncontrolled from defaultValue and posts its value through a hidden input', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Listbox aria-label="Type" name="type" defaultValue="b">
        <option value="a">Alpha</option>
        <option value="b">Bravo</option>
      </Listbox>,
    );
    expect(shownValue(screen.getByRole('combobox'))).toBe('Bravo');
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Alpha' }));
    expect(container.querySelector('input[type="hidden"][name="type"]')).toHaveValue('a');
  });
});
