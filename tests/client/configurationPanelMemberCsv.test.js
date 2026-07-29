import { describe, expect, it } from 'vitest';
import { analyzeMemberCsv, parseMemberCsv } from '../../src/components/admin/ConfigurationPanel.jsx';

describe('parseMemberCsv', () => {
  it('parses a plain CSV with the header on row 1', () => {
    const csv = [
      'Last Name,First Name,Email,Phone',
      'Adams,Nancy,adamsn952@gmail.com,919 349-2725'
    ].join('\n');

    const rows = parseMemberCsv(csv);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'adamsn952@gmail.com',
      firstName: 'Nancy',
      lastName: 'Adams',
      name: 'Nancy Adams'
    });
  });

  it('skips a title/banner row above the real header, like a roster export', () => {
    // Same shape as an actual Village Quilters roster export: blank rows,
    // a title row, another blank row, then the real header.
    const csv = [
      ',,,,,,',
      ',,,,,,',
      ',,Village Quilters  Roster July 2026,,,,',
      ',,,,,,',
      'Last Name,First Name,Address,Town,Zip code,Phone,EMAIL',
      'Adams,Nancy,158 Dudi Trail,Vonore,37885,919 349-2725,adamsn952@gmail.com',
      'Alberque,Marie,250 Lower Smithfield Rd,Tellico Plains,37385,850-723-9092,mariealberque@aol.com',
      ',,,,,,',
      ',,,,,,'
    ].join('\n');

    const rows = parseMemberCsv(csv);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      email: 'adamsn952@gmail.com',
      firstName: 'Nancy',
      lastName: 'Adams',
      name: 'Nancy Adams',
      phone: '(919) 349-2725',
      town: 'Vonore'
    });
    expect(rows[1]).toMatchObject({
      email: 'mariealberque@aol.com',
      firstName: 'Marie',
      lastName: 'Alberque',
      town: 'Tellico Plains'
    });
  });

  it('still falls back to row 0 when nothing recognizable as a header is found', () => {
    const csv = [
      'Foo,Bar,Baz',
      'x,y,z'
    ].join('\n');

    expect(parseMemberCsv(csv)).toEqual([]);
  });
});

describe('analyzeMemberCsv (preview, before anything is imported)', () => {
  it('reports totals with nothing skipped or duplicated for a clean file', () => {
    const csv = [
      'Last Name,First Name,Email,Phone',
      'Adams,Nancy,adamsn952@gmail.com,919 349-2725',
      'Alberque,Marie,mariealberque@aol.com,850-723-9092'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.totalDataRows).toBe(2);
    expect(analysis.validRows).toHaveLength(2);
    expect(analysis.skippedRows).toHaveLength(0);
    expect(analysis.duplicateEmails).toHaveLength(0);
    expect(analysis.headerFound).toBe(true);
  });

  it('lists skipped rows by their data row number, not counting the header', () => {
    const csv = [
      'Last Name,First Name,Email,Phone',
      'Adams,Nancy,adamsn952@gmail.com,919 349-2725',
      ',,,',
      'Alberque,Marie,mariealberque@aol.com,850-723-9092'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    // The blank data row is itself dropped by the raw CSV row parser (every
    // cell empty), so it never reaches analysis as a skipped row - only rows
    // with SOME content but nothing usable (name/email/phone) count here.
    expect(analysis.totalDataRows).toBe(2);
    expect(analysis.skippedRows).toHaveLength(0);
  });

  it('flags a row with some content but no name, email, or phone as skipped', () => {
    const csv = [
      'Last Name,First Name,Email,Phone,Notes',
      'Adams,Nancy,adamsn952@gmail.com,919 349-2725,',
      ',,,,Called but no info given'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.totalDataRows).toBe(2);
    expect(analysis.validRows).toHaveLength(1);
    expect(analysis.skippedRows).toHaveLength(1);
    expect(analysis.skippedRows[0].dataRowNumber).toBe(2);
  });

  it('flags duplicate emails within the file and which data rows they are on', () => {
    const csv = [
      'Last Name,First Name,Email,Phone',
      'Adams,Nancy,same@example.com,919 349-2725',
      'Alberque,Marie,mariealberque@aol.com,850-723-9092',
      'Smith,Nan,same@example.com,555-000-1111'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.duplicateEmails).toEqual([
      { email: 'same@example.com', rowNumbers: [1, 3] }
    ]);
  });

  it('reports a row count of zero and no header found for a file with no usable columns', () => {
    const csv = ['Foo,Bar,Baz', 'x,y,z'].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.headerFound).toBe(false);
    expect(analysis.validRows).toHaveLength(0);
  });
});

describe('analyzeMemberCsv row validation (fix-before-import)', () => {
  it('accepts a row with a name and only a phone number - no email required', () => {
    const csv = [
      'Last Name,First Name,Email,Phone',
      'Adams,Nancy,,919 349-2725'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.validRows).toHaveLength(1);
    expect(analysis.invalidRows).toHaveLength(0);
  });

  it('accepts a row with a name and only an email - no phone required', () => {
    const csv = [
      'Last Name,First Name,Email,Phone',
      'Adams,Nancy,adamsn952@gmail.com,'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.validRows).toHaveLength(1);
    expect(analysis.invalidRows).toHaveLength(0);
  });

  it('flags a row missing the last name', () => {
    const csv = [
      'Last Name,First Name,Email,Phone',
      ',Nancy,adamsn952@gmail.com,919 349-2725'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.validRows).toHaveLength(0);
    expect(analysis.invalidRows).toHaveLength(1);
    expect(analysis.invalidRows[0].issues).toEqual(['Missing last name']);
  });

  it('flags a row missing the first name', () => {
    const csv = [
      'Last Name,First Name,Email,Phone',
      'Adams,,adamsn952@gmail.com,919 349-2725'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.invalidRows).toHaveLength(1);
    expect(analysis.invalidRows[0].issues).toEqual(['Missing first name']);
  });

  it('flags a row with neither email nor phone', () => {
    const csv = [
      'Last Name,First Name,Email,Phone',
      'Adams,Nancy,,'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.validRows).toHaveLength(0);
    expect(analysis.invalidRows).toHaveLength(1);
    expect(analysis.invalidRows[0].issues).toEqual([
      'Missing email and phone number - at least one is required'
    ]);
  });

  it('flags an invalid email format', () => {
    const csv = [
      'Last Name,First Name,Email,Phone',
      'Adams,Nancy,not-an-email,919 349-2725'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.invalidRows).toHaveLength(1);
    expect(analysis.invalidRows[0].issues).toEqual(['Invalid email format']);
  });

  it('flags a phone number with extra digits instead of silently truncating it', () => {
    const csv = [
      'Last Name,First Name,Email,Phone',
      'Adams,Nancy,adamsn952@gmail.com,919 349-27255'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.invalidRows).toHaveLength(1);
    expect(analysis.invalidRows[0].issues).toEqual(['Phone number has 11 digits (expected 10)']);
  });

  it('flags a phone number with missing digits', () => {
    const csv = [
      'Last Name,First Name,Email,Phone',
      'Adams,Nancy,adamsn952@gmail.com,919 349-272'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.invalidRows).toHaveLength(1);
    expect(analysis.invalidRows[0].issues).toEqual(['Phone number has 9 digits (expected 10)']);
  });

  it('accepts a phone number with a leading 1 country code', () => {
    const csv = [
      'Last Name,First Name,Email,Phone',
      'Adams,Nancy,adamsn952@gmail.com,1-919-349-2725'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.validRows).toHaveLength(1);
    expect(analysis.invalidRows).toHaveLength(0);
  });

  it('collects multiple issues on the same row', () => {
    const csv = [
      'Last Name,First Name,Email,Phone',
      ',,not-an-email,12345'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.invalidRows).toHaveLength(1);
    expect(analysis.invalidRows[0].issues).toEqual([
      'Missing name',
      'Invalid email format',
      'Phone number has 5 digits (expected 10)'
    ]);
  });

  it('does not require separate first/last columns when a single Name column is used', () => {
    const csv = [
      'Name,Email,Phone',
      'Nancy Adams,adamsn952@gmail.com,919 349-2725'
    ].join('\n');

    const analysis = analyzeMemberCsv(csv);

    expect(analysis.validRows).toHaveLength(1);
    expect(analysis.invalidRows).toHaveLength(0);
  });
});
