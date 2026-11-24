import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>
}));

const { default: EventList } = await import('../../src/components/admin/EventList.jsx');

// Asked for on 2026-11-24: "on the admin for sale page, remove the
// registration pill links from the for sale card."
//
// A Business Listing and a For Sale listing are in
// NON_REGISTRABLE_EVENT_TYPES - the server refuses a registration against
// either - so Review/Edit Registrations, Print Registration List, Register
// Myself and Register A Member could only ever open something empty. They
// were gated on canViewRegistrations alone, which says what the ADMIN may do
// and nothing about what the card is.

const FOR_SALE = {
  askingPrice: 120,
  contactEmail: 'seller@example.com',
  contactName: 'Ada Lovelace',
  eventType: 'For Sale',
  id: 'evt-1',
  status: 'Published',
  title: 'Featherweight 221K',
  visibleUntil: '2099-01-01T00:00'
};

const CLASS = {
  capacity: 10,
  date: '2027-12-01',
  eventType: 'Class (Half Day)',
  id: 'evt-1',
  registrationCloseAt: new Date(Date.now() + 86_400_000).toISOString(),
  registrationMode: 'now',
  registrationOpenAt: new Date(Date.now() - 86_400_000).toISOString(),
  status: 'Published',
  title: 'Binding Basics'
};

function renderList(event) {
  return render(
    <EventList
      canRegisterOthers
      canViewRegistrations
      events={[event]}
      onDelete={() => {}}
      onEdit={() => {}}
      onRegisterMember={() => {}}
      onRegisterSelf={() => {}}
      onViewRegistrations={() => {}}
      registrationCounts={{ 'evt-1': { registered: 0 } }}
    />
  );
}

const REGISTRATION_CONTROLS = [
  'Review/Edit Registrations',
  'Print Registration List',
  'Register Myself',
  'Register A Member'
];

afterEach(cleanup);

describe.each(['For Sale', 'Business Listing'])('a %s card', (eventType) => {
  it('carries none of the registration controls', () => {
    renderList({ ...FOR_SALE, eventType });

    for (const label of REGISTRATION_CONTROLS) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('offers no control of any kind that mentions registration', () => {
    // Broader than the four labels above, so a registration control added to
    // this card later is caught too. Scoped to things you can CLICK: the
    // card's status label still reads "Listed - no registrations", which is a
    // statement of fact about the listing and the clearest thing it could
    // say - what was asked for was the removal of the pill links.
    renderList({ ...FOR_SALE, eventType });

    const clickable = [...document.querySelectorAll('button, a')];
    const mentioningRegistration = clickable
      .map((element) => element.textContent)
      .filter((text) => /regist/i.test(text));

    expect(mentioningRegistration).toEqual([]);
  });

  it('keeps the status label that explains why', () => {
    renderList({ ...FOR_SALE, eventType });

    expect(screen.getByText('Listed - no registrations')).toBeInTheDocument();
  });

  it('keeps the controls that do apply to it', () => {
    renderList({ ...FOR_SALE, eventType });

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });
});

describe('an ordinary event', () => {
  it('still has every registration control', () => {
    renderList(CLASS);

    for (const label of REGISTRATION_CONTROLS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
