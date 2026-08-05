import { describe, expect, it } from 'vitest';

// configurationService.js talks to Firestore at module scope (doc(db, ...)
// refs built eagerly), so it needs firebase.js mocked even though these
// tests only exercise pure builder functions within it.
import { vi } from 'vitest';

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {} }));

const { buildImportedExistingProfile, buildImportedNewProfile, buildProfileImportPayload } = await import(
  '../../src/services/configurationService.js'
);

describe('buildProfileImportPayload quarantines malformed contact info', () => {
  it('blanks an invalid-format email rather than writing it as-is', () => {
    const payload = buildProfileImportPayload(
      { email: 'not-an-email', emailInvalid: true, issues: ['Invalid email format'], name: 'Judy Egan', phone: '(555) 201-9815', status: 'Active' },
      'p1'
    );

    expect(payload.email).toBe('');
    expect(payload.phone).toBe('(555) 201-9815');
    expect(payload.issues).toEqual(['Invalid email format']);
  });

  it('blanks a wrong-digit-count phone rather than writing it as-is', () => {
    const payload = buildProfileImportPayload(
      { email: 'a@example.com', issues: ['Phone number has 5 digits (expected 10)'], name: 'Kim Fisher', phone: '12345', phoneInvalid: true, status: 'Active' },
      'p1'
    );

    expect(payload.phone).toBe('');
    expect(payload.normalizedPhone).toBe('');
    expect(payload.email).toBe('a@example.com');
  });

  it('keeps both fields when neither is flagged invalid', () => {
    const payload = buildProfileImportPayload(
      { email: 'a@example.com', issues: [], name: 'Nancy Adams', phone: '(919) 349-2725', status: 'Active' },
      'p1'
    );

    expect(payload.email).toBe('a@example.com');
    expect(payload.phone).toBe('(919) 349-2725');
  });
});

// A roster CSV is taken to list members in good standing, so only an issue
// that makes the row untrustworthy as a member record demotes it - no name at
// all, or no email and no phone so it can neither be contacted nor matched.
// Everything else imports at its stated status with the issue in the review
// note, because demoting a real member over a missing field is worse than
// recording it.
describe('a CSV row with blocking issues imports as Pending; lesser issues are only noted', () => {
  it('marks a brand-new profile Pending when the row has a blocking issue', () => {
    const imported = {
      blockingIssues: ['Missing email and phone number - at least one is required'],
      email: '',
      firstName: 'Sam',
      issues: ['Missing email and phone number - at least one is required'],
      lastName: '',
      name: 'Sam',
      phone: '',
      profileId: 'p1',
      status: 'Active',
      town: ''
    };

    const profile = buildImportedNewProfile(imported, 'v1');

    expect(profile.membershipStatus).toBe('Pending');
    expect(profile.membershipReviewNote)
      .toBe('CSV import: Missing email and phone number - at least one is required.');
    expect(profile.membershipPaymentStatus).toBe('Pending');
  });

  it('keeps a member Active when the only issue is a missing email', () => {
    const imported = {
      blockingIssues: [],
      email: '',
      firstName: 'Susan',
      issues: ['Missing email - this member cannot be emailed'],
      lastName: 'Vachino',
      name: 'Susan Vachino',
      phone: '(717) 926-8522',
      profileId: 'p1',
      status: 'Active',
      town: ''
    };

    const profile = buildImportedNewProfile(imported, 'v1');

    expect(profile.membershipStatus).toBe('Active');
    expect(profile.membershipPaymentStatus).toBe('Paid');
    // Still recorded, just not a demotion.
    expect(profile.membershipReviewNote)
      .toBe('CSV import: Missing email - this member cannot be emailed.');
  });

  it('does not mark a clean row Pending - it keeps the imported status', () => {
    const imported = {
      email: 'a@example.com',
      firstName: 'Nancy',
      issues: [],
      lastName: 'Adams',
      name: 'Nancy Adams',
      phone: '(919) 349-2725',
      profileId: 'p1',
      status: 'Active',
      town: ''
    };

    const profile = buildImportedNewProfile(imported, 'v1');

    expect(profile.membershipStatus).toBe('Active');
    expect(profile.membershipReviewNote).toBe('');
    expect(profile.membershipPaymentStatus).toBe('Paid');
  });

  it('forces Pending on an existing profile update even during an Annual Refresh', () => {
    const existing = { id: 'u1', membershipStatus: 'Active', name: 'Judy Egan', role: 'General User', status: 'Active' };
    const imported = {
      blockingIssues: ['Missing email and phone number - at least one is required'],
      email: '',
      issues: ['Missing email and phone number - at least one is required'],
      name: 'Judy Egan',
      // importMembersFromCsvRows forces status to 'Active' during Annual Refresh
      // before this ever runs - Pending must still win when the row is
      // untrustworthy.
      status: 'Active'
    };

    const profile = buildImportedExistingProfile(existing, imported, 'email', 'v1');

    expect(profile.membershipStatus).toBe('Pending');
    expect(profile.membershipPaymentStatus).toBe('Pending');
  });

  it('appends the issue note to an existing review note instead of overwriting it', () => {
    const existing = {
      id: 'u1',
      membershipReviewNote: 'Called 3/1 - said dues check is in the mail.',
      membershipStatus: 'Pending',
      name: 'Judy Egan',
      role: 'General User',
      status: 'Active'
    };
    const imported = { email: '', issues: ['Invalid email format'], name: 'Judy Egan', status: 'Active' };

    const profile = buildImportedExistingProfile(existing, imported, 'email', 'v1');

    expect(profile.membershipReviewNote).toBe(
      'Called 3/1 - said dues check is in the mail. | CSV import: Invalid email format.'
    );
  });

  it('leaves an existing review note untouched when the row has no issues', () => {
    const existing = {
      id: 'u1',
      membershipReviewNote: 'Prior note stays as-is.',
      membershipStatus: 'Active',
      name: 'Nancy Adams',
      role: 'General User',
      status: 'Active'
    };
    const imported = { email: 'a@example.com', issues: [], name: 'Nancy Adams', status: 'Active' };

    const profile = buildImportedExistingProfile(existing, imported, 'email', 'v1');

    expect(profile.membershipReviewNote).toBe('Prior note stays as-is.');
  });
});
