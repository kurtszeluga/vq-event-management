import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/firebase.js', () => ({ auth: {} }));
vi.mock('firebase/auth', () => ({ signInWithCustomToken: vi.fn() }));

const { RegistrationCompletion } = await import('../../src/pages/RegisterPage.jsx');
const { default: ConfirmDialog } = await import('../../src/components/ConfirmDialog.jsx');

const EVENT = {
  date: '2026-09-14',
  endTime: '15:00',
  eventType: 'Workshop',
  id: 'event-a',
  startTime: '13:00',
  title: 'Open Sew'
};

const CONFIRMATION = { paymentStatus: 'Paid', status: 'Registered' };

afterEach(cleanup);

function renderCard(overrides = {}) {
  return render(
    <RegistrationCompletion
      closeMessage=""
      confirmation={CONFIRMATION}
      event={EVENT}
      passwordSetupError=""
      passwordSetupPending={false}
      onReturn={() => {}}
      onSetUpPassword={null}
      {...overrides}
    />
  );
}

describe('the password offer on the completion screen', () => {
  it('is absent for someone who did not ask for it', () => {
    renderCard();

    expect(screen.queryByRole('button', { name: /create your password/i })).toBeNull();
    expect(screen.getByRole('button', { name: /return to list/i })).toBeTruthy();
  });

  it('appears when they opted in and a token was minted', () => {
    renderCard({ onSetUpPassword: () => {} });

    expect(screen.getByRole('button', { name: /create your password/i })).toBeTruthy();
  });

  it('hands off when clicked', async () => {
    const onSetUpPassword = vi.fn();
    const user = userEvent.setup();
    renderCard({ onSetUpPassword });

    await user.click(screen.getByRole('button', { name: /create your password/i }));

    expect(onSetUpPassword).toHaveBeenCalledTimes(1);
  });

  it('shows a busy label and blocks a second click while opening', async () => {
    const onSetUpPassword = vi.fn();
    const user = userEvent.setup();
    renderCard({ onSetUpPassword, passwordSetupPending: true });

    const button = screen.getByRole('button', { name: /opening/i });

    expect(button).toBeDisabled();
    await user.click(button);
    expect(onSetUpPassword).not.toHaveBeenCalled();
  });

  it('reports a failure without implying the registration failed', () => {
    // The registration already succeeded by this point - the message has to
    // point at another route to a password, not read as a lost registration.
    renderCard({
      onSetUpPassword: () => {},
      passwordSetupError: 'We could not open the password page. You can still set a password from the sign-in page using "Forgot password".'
    });

    expect(screen.getByText(/could not open the password page/i)).toBeTruthy();
    expect(screen.getByText(/registration confirmed/i)).toBeTruthy();
  });
});

// The offer used to be an inline card, which was easy to scroll straight past
// on the way to the rest of the form. It is a modal now, so it has to be
// answered before the member carries on. ConfirmDialog is the app's existing
// dialog, so what matters here is that both answers are present and distinct.
describe('the password offer dialog', () => {
  function renderDialog(overrides = {}) {
    return render(
      <ConfirmDialog
        cancelLabel="No Thanks"
        confirmLabel="Yes, Set Up A Password"
        description="This account has no password yet, which is why you signed in with a code."
        open
        title="Set Up A Password?"
        onCancel={() => {}}
        onConfirm={() => {}}
        {...overrides}
      />
    );
  }

  it('puts the question in front of the member with both answers', () => {
    renderDialog();

    expect(screen.getByRole('heading', { name: /set up a password/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /yes, set up a password/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /no thanks/i })).toBeTruthy();
  });

  it('renders nothing at all when closed', () => {
    renderDialog({ open: false });

    expect(screen.queryByRole('heading', { name: /set up a password/i })).toBeNull();
  });

  it('reports which answer was given', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onCancel, onConfirm });

    await user.click(screen.getByRole('button', { name: /yes, set up a password/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /no thanks/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
