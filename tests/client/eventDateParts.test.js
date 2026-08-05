import { describe, expect, it } from 'vitest';
import { getEventDateParts } from '../../src/utils/eventFormat.js';

// Feeds the stacked date box on an event card. The trap here is well
// documented in this codebase: an ISO date-only string read through Date is UTC
// midnight, which in any timezone behind UTC lands on the day before - a split
// exactly like this once had the GoDaddy feed rendering every date a day early
// while the app's own page stayed correct.

describe('the stacked date box parts', () => {
  it('reads an ISO date as text, not through Date', () => {
    // The whole point. Eastern is behind UTC, so a Date-based reading of this
    // would say the 12th.
    expect(getEventDateParts('2026-08-13')).toEqual({
      day: '13',
      month: 'AUG',
      year: '2026'
    });
  });

  it('reads a datetime the same way', () => {
    expect(getEventDateParts('2026-01-01T09:30')).toEqual({
      day: '1',
      month: 'JAN',
      year: '2026'
    });
  });

  it('drops the leading zero from the day', () => {
    // "AUG 03" reads oddly at the size this renders.
    expect(getEventDateParts('2026-08-03').day).toBe('3');
  });

  it('handles both ends of the year', () => {
    expect(getEventDateParts('2026-12-31').month).toBe('DEC');
    expect(getEventDateParts('2026-01-31').month).toBe('JAN');
  });

  it('returns null rather than a placeholder when there is no date', () => {
    // The caller decides whether an undated event shows a TBD box or no box.
    expect(getEventDateParts('')).toBeNull();
    expect(getEventDateParts(null)).toBeNull();
    expect(getEventDateParts(undefined)).toBeNull();
  });

  it('returns null for something unparseable', () => {
    expect(getEventDateParts('not a date')).toBeNull();
    expect(getEventDateParts('2026-13-01')).toBeNull();
  });

  it('matches the labels the GoDaddy embed renders', () => {
    // The embed carries its own copy because it cannot import from src/. If
    // these ever diverge, the same event reads differently on the two sites.
    const months = Array.from({ length: 12 }, (_, index) =>
      getEventDateParts(`2026-${String(index + 1).padStart(2, '0')}-15`).month);

    expect(months).toEqual([
      'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
      'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
    ]);
  });
});
