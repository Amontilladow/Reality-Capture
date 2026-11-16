import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { greetingFor, monthGrid, zonedParts, monthRange, weekOf } from './time';
import { dayMarks } from './hooks';
import { MiniCalendar } from './MiniCalendar';
import { dueLabel, recordHref } from '../../lib/record-links';
import type { AgendaItem } from '../../lib/workspace.api';

describe('greeting and clock', () => {
  it('greets by local hour', () => {
    expect(greetingFor(5)).toBe('Good morning');
    expect(greetingFor(11)).toBe('Good morning');
    expect(greetingFor(12)).toBe('Good afternoon');
    expect(greetingFor(17)).toBe('Good afternoon');
    expect(greetingFor(18)).toBe('Good evening');
    expect(greetingFor(2)).toBe('Good evening');
  });
  it('reads the hour and date in the chosen zone, not the device zone', () => {
    const at = new Date('2026-11-15T22:30:00Z');
    expect(zonedParts(at, 'Asia/Dubai', false)).toMatchObject({ hour: 2, date: '2026-11-16' });
    expect(zonedParts(at, 'America/New_York', false)).toMatchObject({ hour: 17, date: '2026-11-15' });
  });
});

describe('calendar grid', () => {
  it('starts on Monday and covers six whole weeks', () => {
    const g = monthGrid(2026, 10); // November 2026
    expect(g).toHaveLength(42);
    expect(g[0]).toBe('2026-10-26');
    expect(g).toContain('2026-11-30');
    expect(monthRange('2026-11-16')).toEqual({ from: '2026-10-26', to: '2026-12-06' });
    expect(weekOf('2026-11-16')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  });

  it('marks overdue days, and highlights today separately from the selected day', async () => {
    const item = (date: string, done = false): AgendaItem => ({
      key: date + done, source: 'issue', id: 'x', category: 'my_tasks', title: 't', reference: null, date, time: null,
      status: 'open', priority: null, done, mine: true, projectId: 'p', projectName: null,
    });
    const marks = dayMarks([item('2026-11-10'), item('2026-11-20'), item('2026-11-21', true)], '2026-11-16');
    expect(marks.get('2026-11-10')).toEqual({ open: 1, done: 0, overdue: true });
    expect(marks.get('2026-11-20')).toEqual({ open: 1, done: 0, overdue: false });
    expect(marks.get('2026-11-21')).toEqual({ open: 0, done: 1, overdue: false });

    const onSelect = vi.fn();
    const onMonthChange = vi.fn();
    render(<MiniCalendar today="2026-11-16" selected="2026-11-20" month="2026-11-16" marks={marks} onSelect={onSelect} onMonthChange={onMonthChange} />);
    expect(screen.getByRole('gridcell', { name: /Monday, 16 November|Monday, November 16/ })).toHaveAttribute('aria-current', 'date');
    expect(screen.getByRole('gridcell', { name: /20/ , selected: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('gridcell', { name: /Tuesday, 24 November|Tuesday, November 24/ }));
    expect(onSelect).toHaveBeenCalledWith('2026-11-24');
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onMonthChange).toHaveBeenCalledWith('2026-12-01');
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onSelect).toHaveBeenLastCalledWith('2026-11-16');
  });
});

describe('due labels and links', () => {
  it('says overdue only for a past date', () => {
    expect(dueLabel('2026-11-14', null, '2026-11-16')).toBe('Overdue by 2 days');
    expect(dueLabel(null, null, '2026-11-16')).toBe('No due date');
    expect(dueLabel('2026-11-16', null, '2026-11-16')).toBe('Today');
    expect(dueLabel('2026-11-17', null, '2026-11-16')).toBe('Tomorrow');
  });
  it('links each record type to its own page', () => {
    expect(recordHref('issue', 'p', 'i')).toBe('/projects/p/issues?issueId=i');
    expect(recordHref('rfi', 'p', 'r')).toBe('/projects/p/rfis/r');
    expect(recordHref('qaqc', 'p', 'q', 'ncr')).toBe('/projects/p/qaqc/ncr/q');
    expect(recordHref('task', null, 't')).toBe('/projects/my-tasks?task=t');
    expect(recordHref('issue', null, 'i')).toBeNull();
  });
});
