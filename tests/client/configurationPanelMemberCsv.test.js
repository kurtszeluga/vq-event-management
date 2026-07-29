import { describe, expect, it } from 'vitest';
import { parseMemberCsv } from '../../src/components/admin/ConfigurationPanel.jsx';

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
