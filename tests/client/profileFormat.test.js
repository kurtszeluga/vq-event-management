import { describe, expect, it } from 'vitest';
import { getAccountDisplayName } from '../../src/utils/profileFormat.js';

describe('getAccountDisplayName', () => {
  it('prefers the Firestore profile name over the Firebase Auth displayName', () => {
    const currentUser = { displayName: 'A. Lovelace' };
    const userProfile = { name: 'Ada Lovelace' };

    expect(getAccountDisplayName(currentUser, userProfile)).toBe('Ada Lovelace');
  });

  it('falls back to the Firebase Auth displayName before the Firestore snapshot arrives', () => {
    const currentUser = { displayName: 'Ada Lovelace' };

    expect(getAccountDisplayName(currentUser, null)).toBe('Ada Lovelace');
  });

  it('returns an empty string when neither source has a name', () => {
    expect(getAccountDisplayName({ email: 'ada@example.com' }, null)).toBe('');
    expect(getAccountDisplayName(null, null)).toBe('');
    expect(getAccountDisplayName(undefined, undefined)).toBe('');
  });

  it('ignores a Firestore profile with an empty name string', () => {
    const currentUser = { displayName: 'Ada Lovelace' };
    const userProfile = { name: '' };

    expect(getAccountDisplayName(currentUser, userProfile)).toBe('Ada Lovelace');
  });
});
