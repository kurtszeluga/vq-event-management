import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>
}));

const { default: EventList } = await import('../../src/components/admin/EventList.jsx');

// Registration has to be open, or the card is not offering a waitlist either
// and both controls correctly keep their ordinary wording.
const OPEN_EVENT = {
  capacity: 2,
  date: '2026-12-01',
  eventType: 'Workshop',
  id: 'evt-1',
  registrationCloseAt: new Date(Date.now() + 86_400_000).toISOString(),
  registrationMode: 'now',
  registrationOpenAt: new Date(Date.now() - 86_400_000).toISOString(),
  status: 'Published',
  title: 'Curved Seams'
};

function renderList(counts, overrides = {}) {
  return render(
    <EventList
      canRegisterOthers
      canViewRegistrations
      events={[{ ...OPEN_EVENT, ...overrides }]}
      onDelete={() => {}}
      onEdit={() => {}}
      onRegisterMember={() => {}}
      onRegisterSelf={() => {}}
      onViewRegistrations={() => {}}
      registrationCounts={{ 'evt-1': counts }}
    />
  );
}

afterEach(cleanup);

describe('the register controls on a full event', () => {
  // Register Myself has always flipped to Join Waitlist. Register A Member
  // did not, so a full card read as though one of the pair could still take
  // an ordinary registration.
  it('words both as a waitlist once the seats are gone', () => {
    renderList({ registered: 2 });

    expect(screen.getByRole('button', { name: 'Join Waitlist' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Waitlist A Member' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Register Myself' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Register A Member' })).toBeNull();
  });

  it('leaves both as ordinary registration while seats remain', () => {
    renderList({ registered: 1 });

    expect(screen.getByRole('button', { name: 'Register Myself' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Register A Member' })).toBeTruthy();
  });

  // A seat held mid-checkout, or one awaiting payment, fills the event just as
  // a confirmed registration does.
  it('counts a pending payment and a held seat as taking the last places', () => {
    renderList({ held: 1, pendingPayment: 1 });

    expect(screen.getByRole('button', { name: 'Waitlist A Member' })).toBeTruthy();
  });

  // Nothing is being offered on a closed event, waitlist included, so the
  // labels stay put rather than inviting a queue that is not forming.
  it('keeps ordinary wording on a full event whose registration has closed', () => {
    renderList({ registered: 2 }, {
      registrationCloseAt: new Date(Date.now() - 86_400_000).toISOString()
    });

    expect(screen.getByRole('button', { name: 'Register Myself' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Register A Member' })).toBeTruthy();
  });

  it('never says waitlist for an unlimited-capacity event', () => {
    renderList({ registered: 99 }, { capacity: 0, capacityUnlimited: true });

    expect(screen.getByRole('button', { name: 'Register Myself' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Register A Member' })).toBeTruthy();
  });
});
