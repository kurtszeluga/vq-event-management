import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// Membership-type payment docs carry no userId field - only entityId, set to
// the member's own users/{uid} document ID at write time
// (buildMembershipPaymentRecord() in admin-update-user-profile.js). The
// existing self-read branch only covered entityType 'Registration', so a
// member could never read their own membership payment history before this.
const MEMBER_UID = 'member-1';
const OTHER_MEMBER_UID = 'member-2';
const MEMBERSHIP_PAYMENT_ID = 'payment-membership-1';
const REGISTRATION_PAYMENT_ID = 'payment-registration-1';

let testEnv;

function membershipPayment(overrides = {}) {
  return {
    amount: 45,
    amountDue: 0,
    createdBy: 'admin-1',
    createdByEmail: 'admin@example.com',
    createdByName: 'Admin Name',
    createdDate: new Date('2026-07-01T00:00:00Z'),
    entityId: MEMBER_UID,
    entityType: 'Membership',
    eventId: '',
    method: 'Check',
    note: '',
    paymentId: MEMBERSHIP_PAYMENT_ID,
    processor: 'Manual',
    registrationId: '',
    registrationStatus: '',
    squareTransactionId: '',
    status: 'Paid',
    updatedMembershipSnapshot: {},
    updatedRegistrationSnapshot: {},
    ...overrides
  };
}

function registrationPayment(overrides = {}) {
  return {
    amount: 25,
    amountDue: 25,
    createdBy: 'system',
    createdByEmail: '',
    createdByName: 'System',
    createdDate: new Date('2026-07-01T00:00:00Z'),
    entityId: 'reg-1',
    entityType: 'Registration',
    eventId: 'event-1',
    method: 'Online',
    note: '',
    paymentId: REGISTRATION_PAYMENT_ID,
    processor: 'Square',
    registrationId: '',
    registrationStatus: '',
    squareTransactionId: 'sq-1',
    status: 'Paid',
    updatedMembershipSnapshot: {},
    updatedRegistrationSnapshot: {},
    userId: MEMBER_UID,
    ...overrides
  };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'vq-rules-test',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8')
    }
  });
});

after(async () => {
  await testEnv?.cleanup();
});

async function seed(collection, id, payment) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), collection, id), payment);
  });
}

describe('a member reading their own membership payment history', () => {
  test('can read their own membership payment record', async () => {
    await seed('payments', MEMBERSHIP_PAYMENT_ID, membershipPayment());

    await assertSucceeds(
      getDoc(doc(testEnv.authenticatedContext(MEMBER_UID).firestore(), 'payments', MEMBERSHIP_PAYMENT_ID))
    );
  });

  test('cannot read another member\'s membership payment record', async () => {
    await seed('payments', MEMBERSHIP_PAYMENT_ID, membershipPayment());

    await assertFails(
      getDoc(doc(testEnv.authenticatedContext(OTHER_MEMBER_UID).firestore(), 'payments', MEMBERSHIP_PAYMENT_ID))
    );
  });

  test('a signed-out client cannot read it', async () => {
    await seed('payments', MEMBERSHIP_PAYMENT_ID, membershipPayment());

    await assertFails(
      getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'payments', MEMBERSHIP_PAYMENT_ID))
    );
  });

  test('the existing registration-payment self-read path still works, unaffected by the new branch', async () => {
    await seed('payments', REGISTRATION_PAYMENT_ID, registrationPayment());

    await assertSucceeds(
      getDoc(doc(testEnv.authenticatedContext(MEMBER_UID).firestore(), 'payments', REGISTRATION_PAYMENT_ID))
    );
  });

  test('a registration payment still refuses another member, unaffected by the new branch', async () => {
    await seed('payments', REGISTRATION_PAYMENT_ID, registrationPayment());

    await assertFails(
      getDoc(doc(testEnv.authenticatedContext(OTHER_MEMBER_UID).firestore(), 'payments', REGISTRATION_PAYMENT_ID))
    );
  });
});
