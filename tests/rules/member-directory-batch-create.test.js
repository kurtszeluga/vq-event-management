import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, writeBatch } from 'firebase/firestore';

// Reproduces the "Missing or insufficient permissions" error hit when
// importing a brand-new member: a single atomic batch creates users/{id}
// AND memberDirectoryProfiles/{id} in the same commit. The directory rule's
// eligibility check does get(users/{id}) to decide if the write is allowed -
// but get() inside a batched write's rule evaluation sees the database as it
// stood BEFORE the batch, so for a user who doesn't exist yet, that get()
// finds nothing and the whole batch is refused, including the users/{id}
// create that had nothing wrong with it on its own.
const SUPER_UID = 'super-1';
const NEW_USER_UID = 'new-user-1';

let testEnv;

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

async function seedSuperUser() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const { setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'users', SUPER_UID), {
      billingAddress: { city: '', country: 'United States', postalCode: '', state: '', street: '' },
      createdDate: new Date('2026-01-01T00:00:00Z'),
      email: 'webmaster@villagequilters.com',
      membershipStatus: 'Active',
      name: 'Web Master',
      permissions: {
        addUsers: false,
        manageEvents: false,
        manageMembershipStatus: false,
        managePayments: false,
        registerOthers: false,
        viewRegistrations: false
      },
      phone: '',
      profileTags: [],
      role: 'Super User',
      status: 'Active',
      updatedDate: new Date('2026-01-01T00:00:00Z'),
      userId: SUPER_UID
    });
  });
}

function newUserProfile(uid) {
  return {
    billingAddress: { city: 'Vonore', country: 'United States', postalCode: '', state: '', street: '' },
    createdDate: new Date('2026-07-29T00:00:00Z'),
    email: `${uid}@example.com`,
    firstName: 'Nancy',
    lastName: 'Adams',
    membershipMatchedBy: 'csv',
    membershipMemberId: '',
    membershipPaymentAmount: 0,
    membershipPaymentMethod: '',
    membershipPaymentNote: '',
    membershipPaymentStatus: 'Paid',
    membershipPaymentUpdatedDate: new Date('2026-07-29T00:00:00Z'),
    membershipStatus: 'Active',
    membershipUpdatedDate: new Date('2026-07-29T00:00:00Z'),
    name: 'Nancy Adams',
    permissions: {
      addUsers: false,
      manageEvents: false,
      manageMembershipStatus: false,
      managePayments: false,
      registerOthers: false,
      viewRegistrations: false
    },
    phone: '(919) 349-2725',
    profileTags: [],
    role: 'General User',
    status: 'Active',
    termsAccepted: true,
    termsAcceptedDate: new Date('2026-07-29T00:00:00Z'),
    termsVersion: 'v1',
    updatedDate: new Date('2026-07-29T00:00:00Z'),
    userId: uid
  };
}

function directoryProfile(uid) {
  return {
    billingAddress: { city: 'Vonore', country: 'United States', postalCode: '', state: '', street: '' },
    email: `${uid}@example.com`,
    firstName: 'Nancy',
    lastName: 'Adams',
    name: 'Nancy Adams',
    phone: '(919) 349-2725',
    sortKey: `adams nancy nancy adams ${uid}@example.com`,
    updatedDate: new Date('2026-07-29T00:00:00Z'),
    userId: uid
  };
}

describe('creating a brand-new eligible profile + its directory row in one batch', () => {
  test('reproduces the failure: the whole batch is refused', async () => {
    await seedSuperUser();
    const superDb = testEnv.authenticatedContext(SUPER_UID).firestore();
    const batch = writeBatch(superDb);

    batch.set(doc(superDb, 'users', NEW_USER_UID), newUserProfile(NEW_USER_UID));
    batch.set(doc(superDb, 'memberDirectoryProfiles', NEW_USER_UID), directoryProfile(NEW_USER_UID));

    let raised = null;
    try {
      await batch.commit();
    } catch (error) {
      raised = error;
    }

    assert.ok(raised, 'expected the batch to be refused (reproducing the reported bug)');
    assert.equal(raised.code, 'permission-denied');
  });

  test('the users/{id} create succeeds fine entirely on its own', async () => {
    await seedSuperUser();
    const superDb = testEnv.authenticatedContext(SUPER_UID).firestore();
    const batch = writeBatch(superDb);

    batch.set(doc(superDb, 'users', NEW_USER_UID), newUserProfile(NEW_USER_UID));

    await assert.doesNotReject(batch.commit());
  });

  test('once the user exists, the directory create succeeds on its own', async () => {
    await seedSuperUser();
    const superDb = testEnv.authenticatedContext(SUPER_UID).firestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const { setDoc } = await import('firebase/firestore');
      await setDoc(doc(context.firestore(), 'users', NEW_USER_UID), newUserProfile(NEW_USER_UID));
    });

    const batch = writeBatch(superDb);
    batch.set(doc(superDb, 'memberDirectoryProfiles', NEW_USER_UID), directoryProfile(NEW_USER_UID));

    await assert.doesNotReject(batch.commit());
  });
});

describe('reactivating an existing Inactive member back onto the directory, same batch', () => {
  test('reproduces the same failure: eligibility is read from the pre-batch state', async () => {
    await seedSuperUser();
    const superDb = testEnv.authenticatedContext(SUPER_UID).firestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const { setDoc } = await import('firebase/firestore');
      await setDoc(
        doc(context.firestore(), 'users', NEW_USER_UID),
        { ...newUserProfile(NEW_USER_UID), membershipStatus: 'Inactive', status: 'Inactive' }
      );
    });

    const batch = writeBatch(superDb);
    batch.set(doc(superDb, 'users', NEW_USER_UID), newUserProfile(NEW_USER_UID));
    batch.set(doc(superDb, 'memberDirectoryProfiles', NEW_USER_UID), directoryProfile(NEW_USER_UID));

    let raised = null;
    try {
      await batch.commit();
    } catch (error) {
      raised = error;
    }

    assert.ok(raised, 'expected the batch to be refused (reproducing the reported bug)');
    assert.equal(raised.code, 'permission-denied');
  });

  test('the fix: committing the profile write first, then the directory sync separately, succeeds', async () => {
    await seedSuperUser();
    const superDb = testEnv.authenticatedContext(SUPER_UID).firestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const { setDoc } = await import('firebase/firestore');
      await setDoc(
        doc(context.firestore(), 'users', NEW_USER_UID),
        { ...newUserProfile(NEW_USER_UID), membershipStatus: 'Inactive', status: 'Inactive' }
      );
    });

    const profileBatch = writeBatch(superDb);
    profileBatch.set(doc(superDb, 'users', NEW_USER_UID), newUserProfile(NEW_USER_UID));
    await assert.doesNotReject(profileBatch.commit());

    const directoryBatch = writeBatch(superDb);
    directoryBatch.set(doc(superDb, 'memberDirectoryProfiles', NEW_USER_UID), directoryProfile(NEW_USER_UID));
    await assert.doesNotReject(directoryBatch.commit());
  });
});

describe('at CSV-import scale: 251 users already exist (matches the real roster size)', () => {
  const COUNT = 251;
  const uids = Array.from({ length: COUNT }, (_, i) => `csv-user-${i}`);

  async function seedUsers() {
    await seedSuperUser();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const { setDoc } = await import('firebase/firestore');
      await Promise.all(uids.map((uid) => setDoc(doc(context.firestore(), 'users', uid), newUserProfile(uid))));
    });
  }

  test('reproduces the reported bug: a 200-document directory batch fails partway through', async () => {
    await seedUsers();
    const superDb = testEnv.authenticatedContext(SUPER_UID).firestore();
    const directoryBatch = writeBatch(superDb);

    uids.slice(0, 200).forEach((uid) => {
      directoryBatch.set(doc(superDb, 'memberDirectoryProfiles', uid), directoryProfile(uid));
    });

    let raised = null;
    try {
      await directoryBatch.commit();
    } catch (error) {
      raised = error;
    }

    assert.ok(raised, 'expected the 200-document batch to fail, reproducing the reported bug');
  });

  test('the fix: chunking the directory sync at a proven-safe size succeeds for all 251', async () => {
    await seedUsers();
    const superDb = testEnv.authenticatedContext(SUPER_UID).firestore();
    const DIRECTORY_CHUNK_SIZE = 5;

    for (let start = 0; start < uids.length; start += DIRECTORY_CHUNK_SIZE) {
      const chunk = uids.slice(start, start + DIRECTORY_CHUNK_SIZE);
      const batch = writeBatch(superDb);

      chunk.forEach((uid) => {
        batch.set(doc(superDb, 'memberDirectoryProfiles', uid), directoryProfile(uid));
      });

      await assert.doesNotReject(batch.commit(), `chunk starting at ${start} should succeed`);
    }
  });
});
