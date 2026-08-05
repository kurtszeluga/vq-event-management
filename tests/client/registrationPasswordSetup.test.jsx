import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/firebase.js', () => ({ auth: {} }));
vi.mock('firebase/auth', () => ({ signInWithCustomToken: vi.fn() }));

const { RegistrationCompletion } = await import('../../src/pages/RegisterPage.jsx');

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
