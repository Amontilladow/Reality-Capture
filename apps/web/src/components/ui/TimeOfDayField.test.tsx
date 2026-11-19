import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimeOfDayField } from './TimeOfDayField';

// The thing this field replaces a native <input type="time"> to fix:
// that control's picker style (circular dial vs digital spinner) and its
// 12h-AM/PM-vs-24h display both follow the device's own OS/locale setting,
// which a web page can't override. This is a fully app-controlled
// replacement, so these tests cover the one place that can still go
// wrong: round-tripping a 24-hour "HH:MM" value through 12-hour + AM/PM
// and back.

function Controlled({ onChange, initial = '' }: { onChange?: (v: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <TimeOfDayField
      label="Time"
      value={value}
      onChange={(next) => { setValue(next); onChange?.(next); }}
    />
  );
}

// Same reasoning as Listbox.test.tsx's own shownValue helper: the trigger
// also holds invisible copies of every option's label (width reservation),
// so reading its full textContent would trivially "contain" almost any
// digit regardless of what's actually selected. Only the visible value
// span is the real current selection.
function shownValue(combo: HTMLElement) {
  return combo.querySelector('span > span:not([aria-hidden])')?.textContent;
}

describe('TimeOfDayField', () => {
  it('shows all three parts blank ("--") when the stored value is empty', () => {
    render(<Controlled />);
    expect(shownValue(screen.getByRole('combobox', { name: 'Time — hour' }))).toBe('--');
    expect(shownValue(screen.getByRole('combobox', { name: 'Time — minute' }))).toBe('--');
    expect(shownValue(screen.getByRole('combobox', { name: 'Time — AM or PM' }))).toBe('--');
  });

  it('parses a 24-hour afternoon value into 12-hour + PM', () => {
    render(<Controlled initial="14:30" />);
    expect(shownValue(screen.getByRole('combobox', { name: 'Time — hour' }))).toBe('2');
    expect(shownValue(screen.getByRole('combobox', { name: 'Time — minute' }))).toBe('30');
    expect(shownValue(screen.getByRole('combobox', { name: 'Time — AM or PM' }))).toBe('PM');
  });

  it('parses midnight (00:00) as 12 AM', () => {
    render(<Controlled initial="00:00" />);
    expect(shownValue(screen.getByRole('combobox', { name: 'Time — hour' }))).toBe('12');
    expect(shownValue(screen.getByRole('combobox', { name: 'Time — AM or PM' }))).toBe('AM');
  });

  it('parses noon (12:00) as 12 PM', () => {
    render(<Controlled initial="12:00" />);
    expect(shownValue(screen.getByRole('combobox', { name: 'Time — hour' }))).toBe('12');
    expect(shownValue(screen.getByRole('combobox', { name: 'Time — AM or PM' }))).toBe('PM');
  });

  it('picking just the hour on an unset field fills in a default minute and AM/PM, composing a full 24-hour value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Time — hour' }));
    await user.click(screen.getByRole('option', { name: '9' }));

    expect(onChange).toHaveBeenLastCalledWith('09:00');
  });

  it('composes 12 AM as 00:00 and 12 PM as 12:00 (the classic 24-hour edge cases)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial="05:15" onChange={onChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Time — hour' }));
    await user.click(screen.getByRole('option', { name: '12' }));
    expect(onChange).toHaveBeenLastCalledWith('00:15'); // still AM from the initial value

    await user.click(screen.getByRole('combobox', { name: 'Time — AM or PM' }));
    await user.click(screen.getByRole('option', { name: 'PM' }));
    expect(onChange).toHaveBeenLastCalledWith('12:15');
  });

  it('changing the minute preserves the already-chosen hour and AM/PM', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial="17:05" onChange={onChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Time — minute' }));
    await user.click(screen.getByRole('option', { name: '45' }));

    expect(onChange).toHaveBeenLastCalledWith('17:45');
  });

  it('disables all three parts when disabled is set', () => {
    render(<TimeOfDayField label="Time" value="" onChange={() => {}} disabled />);
    expect(screen.getByRole('combobox', { name: 'Time — hour' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Time — minute' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Time — AM or PM' })).toBeDisabled();
  });
});
