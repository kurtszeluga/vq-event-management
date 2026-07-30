import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Verifies the actual interactive checkbox behavior (mutual exclusivity,
// Cost/Service Fee visibility, and the "Allow cash/check payment later"
// sub-toggle only appearing under Online) that buildEventPayload-level
// tests (eventFormPaymentType.test.jsx) cannot exercise, since
// handlePaymentTypeSelection is not exported.

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {}, firebaseConfigured: true }));
vi.mock('../../src/services/eventService.js', () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn()
}));
vi.mock('../../src/services/storageService.js', () => ({
  deleteEventFile: vi.fn(),
  uploadEventImage: vi.fn(),
  uploadEventPdf: vi.fn()
}));
vi.mock('../../src/services/configurationService.js', () => ({
  subscribeToActiveEventLocationDefaults: (onNext) => {
    onNext([]);
    return () => {};
  },
  subscribeToActiveEventTimeDefaults: (onNext) => {
    onNext([]);
    return () => {};
  },
  subscribeToPaymentSettings: (onNext) => {
    onNext({ defaultServiceFee: 1 });
    return () => {};
  }
}));

const { default: EventForm } = await import('../../src/components/admin/EventForm.jsx');

afterEach(cleanup);

async function renderWorkshopForm() {
  const user = userEvent.setup();
  render(<EventForm onCancelEdit={vi.fn()} onSaved={vi.fn()} userProfile={{ id: 'admin-1' }} />);

  await user.selectOptions(screen.getByLabelText(/Event Type/), 'Workshop');

  return user;
}

describe('EventForm payment type checkboxes', () => {
  it('are mutually exclusive - checking one unchecks the others', async () => {
    const user = await renderWorkshopForm();

    const online = screen.getByRole('checkbox', { name: 'Online (Credit Card)' });
    const cashCheckOnly = screen.getByRole('checkbox', { name: 'Cash/Check Only' });
    const free = screen.getByRole('checkbox', { name: 'Free' });

    await user.click(online);
    expect(online).toBeChecked();
    expect(cashCheckOnly).not.toBeChecked();
    expect(free).not.toBeChecked();

    await user.click(cashCheckOnly);
    expect(cashCheckOnly).toBeChecked();
    expect(online).not.toBeChecked();
    expect(free).not.toBeChecked();

    await user.click(free);
    expect(free).toBeChecked();
    expect(online).not.toBeChecked();
    expect(cashCheckOnly).not.toBeChecked();
  });

  it('shows Cost and Service Fee for Online, only Cost for Cash/Check Only, and neither for Free', async () => {
    const user = await renderWorkshopForm();

    await user.click(screen.getByRole('checkbox', { name: 'Online (Credit Card)' }));
    expect(screen.getByLabelText(/^Cost/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Service Fee/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Cash/Check Only' }));
    expect(screen.getByLabelText(/^Cost/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Service Fee/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Free' }));
    expect(screen.queryByLabelText(/^Cost/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Service Fee/)).not.toBeInTheDocument();
  });

  it('preserves the entered cost when switching Online -> Free -> Online instead of silently zeroing it', async () => {
    const user = await renderWorkshopForm();

    await user.click(screen.getByRole('checkbox', { name: 'Online (Credit Card)' }));
    await user.clear(screen.getByLabelText(/^Cost/));
    await user.type(screen.getByLabelText(/^Cost/), '70');

    await user.click(screen.getByRole('checkbox', { name: 'Free' }));
    await user.click(screen.getByRole('checkbox', { name: 'Online (Credit Card)' }));

    expect(screen.getByLabelText(/^Cost/)).toHaveValue(70);
  });

  it('only offers the "Allow cash/check payment later" sub-toggle under Online, not Cash/Check Only', async () => {
    const user = await renderWorkshopForm();

    await user.click(screen.getByRole('checkbox', { name: 'Online (Credit Card)' }));
    expect(screen.getByRole('checkbox', { name: /Allow cash\/check payment later/ })).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Cash/Check Only' }));
    expect(screen.queryByRole('checkbox', { name: /Allow cash\/check payment later/ })).not.toBeInTheDocument();
  });

  it('checking Cash/Check Only after Online does not leave a stray "Allow cash/check" checkbox visible', async () => {
    const user = await renderWorkshopForm();

    await user.click(screen.getByRole('checkbox', { name: 'Online (Credit Card)' }));
    await user.click(screen.getByRole('checkbox', { name: /Allow cash\/check payment later/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Cash/Check Only' }));

    expect(screen.queryByRole('checkbox', { name: /Allow cash\/check payment later/ })).not.toBeInTheDocument();
  });

  it('switching Cash/Check Only -> Online does not leave "Allow cash/check payment later" checked', async () => {
    // Cash/Check Only forces allowCashCheckPayment true (it has no other way
    // to accept payment). That must not survive into Online, which starts
    // from a plain, unchecked sub-toggle unless the admin turns it on again.
    const user = await renderWorkshopForm();

    await user.click(screen.getByRole('checkbox', { name: 'Cash/Check Only' }));
    await user.click(screen.getByRole('checkbox', { name: 'Online (Credit Card)' }));

    expect(screen.getByRole('checkbox', { name: /Allow cash\/check payment later/ })).not.toBeChecked();
  });
});
