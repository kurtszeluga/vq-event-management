import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '../../src/components/ConfirmDialog.jsx';

afterEach(cleanup);

function setup(overrides = {}) {
  const props = {
    description: 'Archive this event?',
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    open: true,
    title: 'Archive Event',
    ...overrides
  };

  const opener = document.createElement('button');
  opener.textContent = 'Open dialog';
  document.body.appendChild(opener);
  opener.focus();

  const view = render(<ConfirmDialog {...props} />);

  return { opener, props, ...view };
}

describe('ConfirmDialog', () => {
  it('renders as a modal dialog and moves focus to the cancel button', () => {
    setup();

    expect(screen.getByRole('dialog', { name: 'Archive Event' })).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    setup();

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm' }));

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('calls onCancel on Escape', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.keyboard('{Escape}');

    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the opener when it closes', () => {
    const { opener, rerender } = setup();

    rerender(
      <ConfirmDialog
        description="Archive this event?"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        open={false}
        title="Archive Event"
      />
    );

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
