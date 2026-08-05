import { describe, expect, it } from 'vitest';
import {
  REGISTRATION_CSV_HEADERS,
  buildCsvFilename,
  buildRegistrationCsv
} from '../../src/utils/registrationCsv.js';

// The coordinator's attendee export. This file is built to be opened in Excel
// or Google Sheets, which is exactly what makes the escaping load-bearing: a
// spreadsheet executes a cell beginning with =, +, - or @ as a formula.

// Mirrors RegistrationListPrintPage's formatPaymentSummary, including its
// fallbacks - a double looser than the real thing invents failures the code
// does not have.
const formatters = {
  formatDateTime: (value) => `formatted:${value}`,
  formatPayment: (registration) => {
    const status = registration.paymentStatus || 'Pending';

    return registration.paymentMethod ? `${status} (${registration.paymentMethod})` : status;
  }
};

function registration(overrides = {}) {
  return {
    amountPaid: 31,
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    paymentMethod: 'Cash',
    paymentStatus: 'Paid',
    phone: '(865) 555-1234',
    registrationDate: '2026-08-13T09:30',
    status: 'Registered',
    ...overrides
  };
}

function rows(csv) {
  return csv.split('\r\n');
}

describe('the attendee CSV', () => {
  it('leads with the columns the printed list shows', () => {
    // Name and email are one cell on paper for layout; separate columns here so
    // they sort and filter.
    expect(REGISTRATION_CSV_HEADERS).toEqual([
      'Name', 'Email', 'Phone', 'Registered', 'Status', 'Payment', 'Amount'
    ]);
    expect(rows(buildRegistrationCsv([], formatters))[0])
      .toBe('"Name","Email","Phone","Registered","Status","Payment","Amount"');
  });

  it('writes a registrant across those columns', () => {
    const [, row] = rows(buildRegistrationCsv([registration()], formatters));

    expect(row).toBe(
      '"Ada Lovelace","ada@example.com","(865) 555-1234",'
      + '"formatted:2026-08-13T09:30","Registered","Paid (Cash)","31.00"'
    );
  });

  it('writes the amount as a plain number so the column sums', () => {
    const [, row] = rows(buildRegistrationCsv([registration({ amountPaid: 51.5 })], formatters));

    expect(row).toContain('"51.50"');
    expect(row).not.toContain('$');
  });

  it('leaves the amount blank when no money changed hands', () => {
    // Not "0.00" - that reads as a payment of nought rather than none taken.
    const [, row] = rows(buildRegistrationCsv([registration({ amountPaid: 0 })], formatters));

    expect(row.endsWith('""')).toBe(true);
  });

  it('survives a name containing a comma and a quote', () => {
    const [, row] = rows(buildRegistrationCsv(
      [registration({ name: 'Quilter, "Mary" Jane' })],
      formatters
    ));

    expect(row.startsWith('"Quilter, ""Mary"" Jane"')).toBe(true);
    // Still one row, not split by the comma.
    expect(rows(buildRegistrationCsv([registration({ name: 'A, B' })], formatters)).length).toBe(2);
  });

  it('neutralises a value a spreadsheet would run as a formula', () => {
    // The reason this matters: opened in Sheets, an unescaped =HYPERLINK(...)
    // in a name field is executed, not displayed.
    ['=1+1', '+1', '-1', '@SUM(A1)'].forEach((name) => {
      const [, row] = rows(buildRegistrationCsv([registration({ name })], formatters));

      expect(row.startsWith(`"'${name}`)).toBe(true);
    });
  });

  it('leaves an ordinary value untouched', () => {
    const [, row] = rows(buildRegistrationCsv([registration({ name: 'Ada' })], formatters));

    expect(row.startsWith('"Ada"')).toBe(true);
  });

  it('handles a registration missing everything', () => {
    const [, row] = rows(buildRegistrationCsv([{}], formatters));

    expect(row).toBe('"","","","","Registered","Pending",""');
  });

  it('separates rows with CRLF, which Excel needs', () => {
    const csv = buildRegistrationCsv([registration(), registration()], formatters);

    expect(csv.split('\r\n').length).toBe(3);
  });
});

describe('the download filename', () => {
  it('carries the event and its date', () => {
    expect(buildCsvFilename('Pumpkin Time/Turned Edge', '2026-08-13'))
      .toBe('registrations-pumpkin-time-turned-edge-2026-08-13.csv');
  });

  it('copes with an undated event and an empty title', () => {
    expect(buildCsvFilename('Open Sew', '')).toBe('registrations-open-sew.csv');
    expect(buildCsvFilename('', '')).toBe('registrations-event.csv');
    expect(buildCsvFilename('***', '')).toBe('registrations-event.csv');
  });
});
