import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

// validRegistration()'s keys().hasOnly([...]) checks the FULL resulting
// document on every update, not just what changed - confirmed by reading the
// rule directly. Adding the four registeredByAdmin* fields to the
// registration document without adding them to that whitelist would silently
// break the one owner-writable path that exists today: a member cancelling
// their own registration. This test exists specifically to catch that.
const MEMBER_UID = 'member-1';
const REGISTRATION_ID = 'reg-1';

let testEnv;

function adminRegisteredRegistration(overrides = {}) {
  return {
    email: 'member@example.com',
    eventId: 'event-1',
    name: 'Ada Lovelace',
    phone: '(352) 653-8188',
    registeredByAdmin: true,
    registeredByAdminEmail: 'coordinator@example.com',
    registeredByAdminName: 'Coordinator Name',
    registeredByAdminUserId: 'admin-1',
    registrationDate: new Date('2026-07-01T00:00:00Z'),
    paymentStatus: 'No Charge',
    status: 'Registered',
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

async function seed(registration = adminRegisteredRegistration()) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'registrations', REGISTRATION_ID), registration);
  });
}

describe('self-cancel on an admin-registered record', () => {
  test('the member can still cancel their own registration that an admin created on their behalf', async () => {
    await seed();

    await assertSucceeds(
      updateDoc(
        doc(testEnv.authenticatedContext(MEMBER_UID).firestore(), 'registrations', REGISTRATION_ID),
        { status: 'Cancelled' }
      )
    );
  });

  test('an ordinary self-service registration (no admin fields at all) can still be cancelled', async () => {
    await seed({
      email: 'member@example.com',
      eventId: 'event-1',
      name: 'Ada Lovelace',
      phone: '(352) 653-8188',
      registrationDate: new Date('2026-07-01T00:00:00Z'),
      paymentStatus: 'No Charge',
      status: 'Registered',
      userId: MEMBER_UID
    });

    await assertSucceeds(
      updateDoc(
        doc(testEnv.authenticatedContext(MEMBER_UID).firestore(), 'registrations', REGISTRATION_ID),
        { status: 'Cancelled' }
      )
    );
  });
});
