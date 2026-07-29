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
    await testEnv.withSecurityRulesDisabled(async () => {});
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

function newUserProfile() {
  return {
    billingAddress: { city: 'Vonore', country: 'United States', postalCode: '', state: '', street: '' },
    createdDate: new Date('2026-07-29T00:00:00Z'),
    email: 'nancy@example.com',
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
    userId: NEW_USER_UID
  };
}

function directoryProfile() {
  return {
    billingAddress: { city: 'Vonore', country: 'United States', postalCode: '', state: '', street: '' },
    email: 'nancy@example.com',
    firstName: 'Nancy',
    lastName: 'Adams',
    name: 'Nancy Adams',
    phone: '(919) 349-2725',
    sortKey: 'adams nancy nancy adams nancy@example.com',
    updatedDate: new Date('2026-07-29T00:00:00Z'),
    userId: NEW_USER_UID
  };
}

describe('creating a brand-new eligible profile + its directory row in one batch', () => {
  test('reproduces the failure: the whole batch is refused', async () => {
    await seedSuperUser();
    const superDb = testEnv.authenticatedContext(SUPER_UID).firestore();
    const batch = writeBatch(superDb);

    batch.set(doc(superDb, 'users', NEW_USER_UID), newUserProfile());
    batch.set(doc(superDb, 'memberDirectoryProfiles', NEW_USER_UID), directoryProfile());

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

    batch.set(doc(superDb, 'users', NEW_USER_UID), newUserProfile());

    await assert.doesNotReject(batch.commit());
  });

  test('once the user exists, the directory create succeeds on its own', async () => {
    await seedSuperUser();
    const superDb = testEnv.authenticatedContext(SUPER_UID).firestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const { setDoc } = await import('firebase/firestore');
      await setDoc(doc(context.firestore(), 'users', NEW_USER_UID), newUserProfile());
    });

    const batch = writeBatch(superDb);
    batch.set(doc(superDb, 'memberDirectoryProfiles', NEW_USER_UID), directoryProfile());

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
        { ...newUserProfile(), membershipStatus: 'Inactive', status: 'Inactive' }
      );
    });

    const batch = writeBatch(superDb);
    batch.set(doc(superDb, 'users', NEW_USER_UID), newUserProfile());
    batch.set(doc(superDb, 'memberDirectoryProfiles', NEW_USER_UID), directoryProfile());

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
        { ...newUserProfile(), membershipStatus: 'Inactive', status: 'Inactive' }
      );
    });

    const profileBatch = writeBatch(superDb);
    profileBatch.set(doc(superDb, 'users', NEW_USER_UID), newUserProfile());
    await assert.doesNotReject(profileBatch.commit());

    const directoryBatch = writeBatch(superDb);
    directoryBatch.set(doc(superDb, 'memberDirectoryProfiles', NEW_USER_UID), directoryProfile());
    await assert.doesNotReject(directoryBatch.commit());
  });
});
