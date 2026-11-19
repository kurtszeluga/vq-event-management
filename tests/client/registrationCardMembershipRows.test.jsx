import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {}, firebaseConfigured: true }));

const { getEventInfoItems } =
  await import('../../src/components/admin/RegistrationPanel.jsx');

const labelsOf = (items) => items.map((item) => item.label);

describe('the admin Registrations card for a Membership signup', () => {
  // A Membership event is never asked for a date, time or location, so the
  // card was printing three empty fields as though they were facts: "Date
  // TBD", "12:00 a.m. - 12:00 a.m." and "Not Set".
  it('prints no date, time or location', () => {
    const labels = labelsOf(getEventInfoItems({
      capacityUnlimited: true,
      cost: 10,
      endTime: '00:00',
      eventType: 'Membership',
      serviceFee: 1,
      startTime: '00:00'
    }));

    expect(labels).not.toContain('Date');
    expect(labels).not.toContain('Time');
    expect(labels).not.toContain('Location');
  });

  // The midnight range is the one worth pinning by value. 00:00 is a real
  // time and it is the event form's own default, so it formats normally
  // instead of falling back to "Time TBD" - which is why it looked deliberate
  // rather than empty.
  it('never renders the midnight-to-midnight range', () => {
    const values = getEventInfoItems({
      endTime: '00:00',
      eventType: 'Membership',
      startTime: '00:00'
    }).map((item) => String(item.value));

    for (const value of values) {
      expect(value).not.toMatch(/12:00/);
    }
  });

  it('still shows what a Membership signup does have', () => {
    const labels = labelsOf(getEventInfoItems(
      { capacityUnlimited: true, cost: 10, eventType: 'Membership', serviceFee: 1 },
      {},
      0,
      true
    ));

    expect(labels).toContain('Cost');
    expect(labels).toContain('Capacity');
  });

  it('leaves every other event type exactly as it was', () => {
    const labels = labelsOf(getEventInfoItems({
      date: '2026-12-11',
      endTime: '14:00',
      eventType: 'Workshop',
      location: 'Guild Hall',
      startTime: '10:00'
    }));

    // Order matters - this is what the card reads top to bottom.
    expect(labels).toEqual(['Date', 'Time', 'Location', 'Cost', 'Capacity']);
  });

  // Challenges already dropped Time and must keep doing so, by a separate
  // rule that predates this one.
  it('keeps dropping Time for a Challenge, and keeps its date and location', () => {
    const labels = labelsOf(getEventInfoItems({
      date: '2026-12-11',
      eventType: 'Challenges',
      location: 'Guild Hall'
    }));

    expect(labels).not.toContain('Time');
    expect(labels).toContain('Date');
    expect(labels).toContain('Location');
  });
});
