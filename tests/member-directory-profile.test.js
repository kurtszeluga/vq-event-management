import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMemberDirectoryProfile,
  isEligibleForMemberDirectory
} from '../api/_lib/member-directory-profile.js';

test('directory eligibility requires active profile, active membership, and non-super-user role', () => {
  assert.equal(isEligibleForMemberDirectory({
    membershipStatus: 'Active',
    role: 'General User',
    status: 'Active'
  }), true);

  assert.equal(isEligibleForMemberDirectory({
    membershipStatus: 'Active',
    role: 'Admin',
    status: 'Active'
  }), true);

  assert.equal(isEligibleForMemberDirectory({
    membershipStatus: 'Active',
    role: 'Super User',
    status: 'Active'
  }), false);

  assert.equal(isEligibleForMemberDirectory({
    membershipStatus: 'Pending',
    role: 'General User',
    status: 'Active'
  }), false);

  assert.equal(isEligibleForMemberDirectory({
    membershipStatus: 'Active',
    role: 'General User',
    status: 'Inactive'
  }), false);
});

test('directory profile projection keeps only safe display fields', () => {
  const profile = buildMemberDirectoryProfile('user-1', {
    billingAddress: {
      city: 'Chapel Hill',
      country: 'United States',
      postalCode: '27514',
      state: 'NC',
      street: '123 Main St'
    },
    email: 'member@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    membershipPaymentStatus: 'Paid',
    membershipStatus: 'Active',
    name: 'Ada Lovelace',
    permissions: {
      manageEvents: true
    },
    phone: '(555) 010-1000',
    role: 'Admin',
    status: 'Active'
  }, 'timestamp');

  assert.deepEqual(profile, {
    billingAddress: {
      city: 'Chapel Hill',
      country: 'United States',
      postalCode: '27514',
      state: 'NC',
      street: '123 Main St'
    },
    email: 'member@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    name: 'Ada Lovelace',
    phone: '(555) 010-1000',
    sortKey: 'lovelace ada ada lovelace member@example.com',
    updatedDate: 'timestamp',
    userId: 'user-1'
  });
  assert.equal('permissions' in profile, false);
  assert.equal('membershipPaymentStatus' in profile, false);
  assert.equal('role' in profile, false);
});
