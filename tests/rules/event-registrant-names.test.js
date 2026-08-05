import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// The member-visible registrant list is a privacy boundary, so it is proven
// against the emulator rather than by reading the rules.
//
// Two things must hold: a member can read the derived names, and a member still
// cannot read the registrations those names came from - those carry email,
// phone, amounts paid and Square transaction ids.

const MEMBER_UID = 'member-1';
const OUTSIDER_UID = 'lapsed-1';
const EVENT_ID = 'event-a';

let testEnv;

function profile(overrides = {}) {
  return {
    email: 'member@example.com',
    membershipStatus: 'Active',
    name: 'Ada Lovelace',
    permissions: {
      addUsers: false,
      manageEvents: false,
      manageMembershipStatus: false,
      managePayments: false,
      registerOthers: false,
      viewRegistrations: false
    },
    role: 'General User',
    status: 'Active',
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

async function seed({ enabled = true } = {}) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'users', MEMBER_UID), profile());
    await setDoc(doc(db, 'users', OUTSIDER_UID), profile({ membershipStatus: 'Inactive' }));
    await setDoc(doc(db, 'appSettings', 'directorySettings'), {
      directoryNote: '',
      enableMemberDirectory: true,
      showCityState: true,
      showEmail: true,
      showEventRegistrantNames: enabled,
      showFullAddress: false,
      showPhone: true
    });
    await setDoc(doc(db, 'eventRegistrantNames', EVENT_ID), {
      eventId: EVENT_ID,
      names: ['Ada Lovelace', 'Mary Quilter'],
      updatedDate: new Date('2026-08-05T00:00:00Z')
    });
    await setDoc(doc(db, 'registrations', 'reg-1'), {
      amountPaid: 42,
      email: 'ada@example.com',
      eventId: EVENT_ID,
      name: 'Ada Lovelace',
      phone: '(865) 555-1234',
      squareTransactionId: 'sq-1',
      status: 'Registered',
      userId: 'someone-else'
    });
  });
}

function db(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function assertRefused(promise) {
  let raised = null;

  try {
    await promise;
  } catch (error) {
    raised = error;
  }

  assert.ok(raised, 'expected the read to be refused, but it succeeded');
  assert.equal(raised.code, 'permission-denied');
  assert.ok(
    !/maximum of 1000 expressions/.test(raised.message),
    'refused because the rule could not be evaluated, not because it said no'
  );
}

describe('the member-visible registrant name list', () => {
  test('an active member can read it when the setting is on', async () => {
    await seed({ enabled: true });

    await assertSucceeds(getDoc(doc(db(MEMBER_UID), 'eventRegistrantNames', EVENT_ID)));
  });

  test('the same member still cannot read the registrations behind it', async () => {
    // The entire reason this collection exists.
    await seed({ enabled: true });

    await assertRefused(getDoc(doc(db(MEMBER_UID), 'registrations', 'reg-1')));
  });

  test('it is refused while the setting is off', async () => {
    await seed({ enabled: false });

    await assertRefused(getDoc(doc(db(MEMBER_UID), 'eventRegistrantNames', EVENT_ID)));
  });

  test('a member whose membership has lapsed cannot read it', async () => {
    await seed({ enabled: true });

    await assertRefused(getDoc(doc(db(OUTSIDER_UID), 'eventRegistrantNames', EVENT_ID)));
  });

  test('a signed-out visitor cannot read it', async () => {
    await seed({ enabled: true });

    await assertRefused(
      getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'eventRegistrantNames', EVENT_ID))
    );
  });

  test('a member cannot write it', async () => {
    await seed({ enabled: true });

    await assertRefused(
      setDoc(doc(db(MEMBER_UID), 'eventRegistrantNames', EVENT_ID), {
        eventId: EVENT_ID,
        names: ['Someone Made Up'],
        updatedDate: new Date('2026-08-05T00:00:00Z')
      })
    );
  });
});
