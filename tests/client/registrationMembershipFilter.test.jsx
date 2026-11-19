import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {}, firebaseConfigured: true }));

const { ACTIVITY_FILTERS, getActivityFilterValue } =
  await import('../../src/components/admin/RegistrationPanel.jsx');

describe('the Registrations activity filters', () => {
  // Reported from the page: a Membership event was listed, but there was no
  // button that would show it. getActivityFilterValue returned '' for it, and
  // the filter compares that against the chosen button - so choosing ANY
  // button hid every Membership registration, and none selected it.
  it('offers a button for Membership', () => {
    expect(ACTIVITY_FILTERS).toContain('Membership');
  });

  it('maps a Membership event to that button', () => {
    expect(getActivityFilterValue('Membership')).toBe('Membership');
  });

  // The invariant underneath both: a button that matches no event type would
  // always read (0), and an event type matching no button is unreachable.
  it('leaves no button without a type and no counted type without a button', () => {
    const mapped = new Set(
      ['Class (Half Day)', 'Class (Full Day)', 'Workshop', 'Retreat', 'Lecture',
        'Challenges', 'Membership']
        .map((eventType) => getActivityFilterValue(eventType))
    );

    for (const filter of ACTIVITY_FILTERS) {
      expect(mapped.has(filter)).toBe(true);
    }
  });

  it('still groups the types that already shared a button', () => {
    expect(getActivityFilterValue('Class (Half Day)')).toBe('Programs');
    expect(getActivityFilterValue('Lecture')).toBe('Programs');
    expect(getActivityFilterValue('Workshop')).toBe('Workshops');
    expect(getActivityFilterValue('Challenge')).toBe('Challenges');
  });

  // Deliberate, and recorded so it is not mistaken for the same bug: these
  // have no button, so they appear only in the unfiltered view.
  it('leaves Business Listing, For Sale and Other unfiltered', () => {
    for (const eventType of ['Business Listing', 'For Sale', 'Other']) {
      expect(getActivityFilterValue(eventType)).toBe('');
    }
  });
});
