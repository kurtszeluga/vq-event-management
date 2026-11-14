import { describe, expect, it } from 'vitest';
import { getAdminListingStatusLabel } from '../../src/utils/eventFormat.js';

// One line on the admin card answering "can anyone register right now, and if
// not, why". The order mirrors the gate: status, then listed, then the
// registration window - the first refusal is the useful answer.
const DAY_MS = 24 * 60 * 60 * 1000;
const local = (offsetMs) => new Date(Date.now() + offsetMs).toISOString().slice(0, 16);

function listed(overrides = {}) {
  return {
    eventType: 'Workshop',
    registrationCloseAt: local(7 * DAY_MS),
    registrationMode: 'now',
    registrationOpenAt: local(-7 * DAY_MS),
    status: 'Published',
    visibleFrom: local(-14 * DAY_MS),
    visibleUntil: local(14 * DAY_MS),
    ...overrides
  };
}

describe('getAdminListingStatusLabel', () => {
  it('shows a non-published status as itself', () => {
    expect(getAdminListingStatusLabel(listed({ status: 'Draft' }))).toBe('Draft');
    expect(getAdminListingStatusLabel(listed({ status: 'Archived' }))).toBe('Archived');
  });

  it('says a published event is not listed yet, with the date', () => {
    // The case that misled an admin: status said Published while the listing
    // was dated into the future, and the card showed only the first fact.
    const label = getAdminListingStatusLabel(listed({ visibleFrom: local(14 * DAY_MS) }));

    expect(label).toMatch(/^Published - not listed until /);
    expect(label).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('says when the listing has already come down', () => {
    const label = getAdminListingStatusLabel(listed({ visibleUntil: local(-DAY_MS) }));

    expect(label).toMatch(/^Removed from site /);
  });

  it('reports a live listing with registration open', () => {
    expect(getAdminListingStatusLabel(listed())).toBe('Listed - registration open');
  });

  it('reports a live listing whose registration has not opened yet', () => {
    const label = getAdminListingStatusLabel(listed({
      registrationMode: 'future',
      registrationOpenAt: local(3 * DAY_MS)
    }));

    expect(label).toMatch(/^Listed - registration opens /);
  });

  it('reports a live listing whose registration has closed', () => {
    const label = getAdminListingStatusLabel(listed({
      registrationCloseAt: local(-DAY_MS),
      registrationOpenAt: local(-7 * DAY_MS)
    }));

    expect(label).toMatch(/^Listed - registration closed /);
  });

  it('reports a live listing that takes no registrations', () => {
    expect(getAdminListingStatusLabel(listed({ registrationMode: 'none' })))
      .toBe('Listed - no registrations');
  });

  it('reports a Business Listing as taking no registrations', () => {
    expect(getAdminListingStatusLabel(listed({ eventType: 'Business Listing' })))
      .toBe('Listed - no registrations');
  });

  it('is empty for no event rather than throwing', () => {
    expect(getAdminListingStatusLabel(null)).toBe('');
  });
});
