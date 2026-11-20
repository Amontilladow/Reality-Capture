import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Hidden">
        <p>content</p>
      </Modal>,
    );
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('renders the title and children when open', () => {
    render(
      <Modal open onClose={() => {}} title="Example modal">
        <p>Body text</p>
      </Modal>,
    );
    expect(screen.getByText('Example modal')).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open onClose={onClose} title="Example modal">
        <p>Body text</p>
      </Modal>,
    );
    await user.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open onClose={onClose} title="Example modal">
        <p>Body text</p>
      </Modal>,
    );
    // Rendered at the top of the page (a portal), not inside the caller.
    const backdrop = document.body.querySelector('.absolute.inset-0');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is a labelled dialog at the top of the page, closes on Escape, and returns focus', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container, rerender } = render(<button>Opener</button>);
    screen.getByText('Opener').focus();
    rerender(
      <>
        <button>Opener</button>
        <Modal open onClose={onClose} title="Example modal"><input aria-label="Name" /></Modal>
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Example modal' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(container.contains(dialog)).toBe(false);
    await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<><button>Opener</button><Modal open={false} onClose={onClose} title="Example modal"><input aria-label="Name" /></Modal></>);
    expect(screen.getByText('Opener')).toHaveFocus();
  });
});
