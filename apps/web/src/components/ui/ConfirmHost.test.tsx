import { describe as suite, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-useanimations', () => ({ default: () => <span /> }));
import { ConfirmHost } from './ConfirmHost';
import { confirmDialog, alertDialog, describe } from '../../store/confirm.store';

suite('confirm dialog wording', () => {
  it('splits a plain message into a question, a body and an action button', () => {
    expect(describe({ message: 'Delete 6 drawing(s) and their entire revision history? This cannot be undone.' })).toEqual({
      title: 'Delete 6 drawing(s) and their entire revision history?',
      body: 'This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    });
    expect(describe({ message: 'Close 3 issue(s)?' })).toMatchObject({ title: 'Close 3 issue(s)?', body: '', tone: 'default', confirmLabel: 'Close' });
    expect(describe({ message: 'Remove this import batch from the activity log? This does not delete any drawings.' })).toMatchObject({ tone: 'danger', confirmLabel: 'Remove' });
  });
});

suite('ConfirmHost', () => {
  it('asks, focuses Cancel for a delete, and resolves with the answer', async () => {
    const user = userEvent.setup();
    render(<ConfirmHost />);
    let answer: Promise<boolean>;
    act(() => { answer = confirmDialog('Delete this issue? This cannot be undone.'); });
    const dialog = await screen.findByRole('dialog', { name: 'Delete this issue?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await expect(answer!).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('treats Escape as cancel', async () => {
    const user = userEvent.setup();
    render(<ConfirmHost />);
    let answer: Promise<boolean>;
    act(() => { answer = confirmDialog('Delete this RFI? This cannot be undone.'); });
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await expect(answer!).resolves.toBe(false);
  });

  it('shows alerts with a single OK button', async () => {
    const user = userEvent.setup();
    render(<ConfirmHost />);
    let done: Promise<void>;
    act(() => { done = alertDialog('The server is busy.', "Couldn't reprocess the model"); });
    await screen.findByRole('alertdialog', { name: "Couldn't reprocess the model" });
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await expect(done!).resolves.toBeUndefined();
  });
});
