import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ eventId: 'evt-1' }),
  useLocation: () => ({ state: null })
}));

let hasPermissionResult = true;

vi.mock('../../src/context/useAuth.js', () => ({
  useAuth: () => ({ hasPermission: () => hasPermissionResult })
}));

const EVENT = {
  id: 'evt-1',
  capacity: 4,
  cost: 25,
  date: '2026-08-01',
  eventType: 'Workshop',
  isPaid: true,
  location: 'Guild Hall',
  title: 'Quilt Basics'
};
const REGISTRATIONS = [
  {
    id: 'reg-1',
    amountPaid: 25,
    email: 'ada@example.com',
    eventId: 'evt-1',
    name: 'Ada Lovelace',
    paymentStatus: 'Paid',
    registrationDate: '2026-07-01',
    status: 'Registered'
  },
  {
    id: 'reg-2',
    amountPaid: 0,
    email: 'grace@example.com',
    eventId: 'evt-1',
    name: 'Grace Hopper',
    paymentStatus: 'Pending',
    registrationDate: '2026-07-02',
    status: 'Waitlisted'
  }
];

let getEventResult = EVENT;
let getRegistrationsResult = REGISTRATIONS;

vi.mock('../../src/services/eventService.js', () => ({
  getEvent: () => Promise.resolve(getEventResult)
}));
vi.mock('../../src/services/registrationService.js', () => ({
  getRegistrationsForEvent: () => Promise.resolve(getRegistrationsResult)
}));

const { default: RegistrationListPrintPage } = await import('../../src/pages/RegistrationListPrintPage.jsx');

afterEach(() => {
  cleanup();
  hasPermissionResult = true;
  getEventResult = EVENT;
  getRegistrationsResult = REGISTRATIONS;
});

describe('RegistrationListPrintPage', () => {
  it('lists every registrant, including one who is waitlisted', async () => {
    render(<RegistrationListPrintPage />);

    expect(await screen.findByText('Quilt Basics')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
    expect(screen.getByText('Waitlisted')).toBeTruthy();
  });

  it('shows capacity, registered, waitlisted, and total paid stats', async () => {
    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');

    expect(screen.getByText('1/4 filled (3 open)')).toBeTruthy();
    expect(screen.getByText('1 Registered')).toBeTruthy();
    expect(screen.getByText('1 Waitlisted')).toBeTruthy();
    expect(screen.getByText('$25.00 Total Paid')).toBeTruthy();
  });

  it('never shows a Total Paid figure for a free event', async () => {
    getEventResult = { ...EVENT, isPaid: false };

    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');

    expect(screen.queryByText(/Total Paid/)).toBeNull();
  });

  it('refuses to load registrant data without the viewRegistrations permission', async () => {
    hasPermissionResult = false;

    render(<RegistrationListPrintPage />);

    expect(await screen.findByText('Permission required')).toBeTruthy();
    expect(screen.queryByText('Quilt Basics')).toBeNull();
  });
});
