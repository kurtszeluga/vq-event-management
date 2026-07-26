import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore';

// Exercises firestore.rules against the emulator. Written to answer one
// question: does the repo's rule set actually permit a signed-in member to
// update their own users/{uid} document? Production denies it for both an
// Admin and a General User, and every clause of the owner branch appears to
// pass when checked by hand against the stored document.
const OWNER_UID = 'user-1';

let testEnv;

// Mirrors a real profile from the live project, field for field.
function storedProfile(overrides = {}) {
  return {
    billingAddress: {
      city: 'Loudon',
      country: 'United States',
      postalCode: '37774',
      state: 'TN',
      street: '12 Awohili Drive'
    },
    createdDate: new Date('2026-01-01T00:00:00Z'),
    email: 'member@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    membershipMatchedBy: 'account',
    membershipMemberId: '1234',
    membershipReviewNote: '',
    membershipReviewedBy: '',
    membershipReviewedDate: new Date('2026-01-02T00:00:00Z'),
    membershipStatus: 'Active',
    membershipUpdatedDate: new Date('2026-01-02T00:00:00Z'),
    name: 'Ada Lovelace',
    permissions: {
      addUsers: false,
      manageEvents: false,
      manageMembershipStatus: false,
      managePayments: false,
      registerOthers: false,
      viewRegistrations: false
    },
    phone: '(352) 653-8188',
    profileTags: [],
    role: 'General User',
    status: 'Active',
    updatedDate: new Date('2026-01-02T00:00:00Z'),
    userId: OWNER_UID,
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

async function seed(profile = storedProfile()) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', OWNER_UID), profile);
  });
}

function ownerDb() {
  return testEnv.authenticatedContext(OWNER_UID).firestore();
}

// A rule that blows Firestore's 1000-expression budget is reported as
// permission-denied, so assertFails() passes for it just as it does for a real
// refusal. Every negative test below therefore has to prove the write was
// refused on its merits, or it would keep passing while the rule was broken -
// which is exactly how this bug stayed hidden.
async function assertRefusedOnMerit(promise) {
  let raised = null;

  try {
    await promise;
  } catch (error) {
    raised = error;
  }

  assert.ok(raised, 'expected the write to be refused, but it succeeded');
  assert.equal(raised.code, 'permission-denied');
  assert.ok(
    !/maximum of 1000 expressions/.test(raised.message),
    'write was refused because the rule could not be evaluated, not because the rule said no'
  );
}

describe('users/{uid} self-update', () => {
  test('the owner can update a single ordinary field', async () => {
    await seed();

    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'users', OWNER_UID), { phone: '(352) 653-8188' })
    );
  });

  test('the owner can save the full profile payload the page sends', async () => {
    await seed();

    await assertSucceeds(
      updateDoc(doc(ownerDb(), 'users', OWNER_UID), {
        billingAddress: {
          city: 'Loudon',
          country: 'United States',
          postalCode: '37774',
          state: 'TN',
          street: '12 Awohili Drive'
        },
        email: 'member@example.com',
        firstName: 'Grace',
        lastName: 'Hopper',
        name: 'Grace Hopper',
        phone: '(352) 653-8189',
        updatedDate: new Date('2026-07-25T00:00:00Z')
      })
    );
  });

  test('a signed-out client cannot update the document', async () => {
    await seed();

    await assertRefusedOnMerit(
      updateDoc(doc(testEnv.unauthenticatedContext().firestore(), 'users', OWNER_UID), {
        phone: '(000) 000-0000'
      })
    );
  });

  test('another signed-in member cannot update it', async () => {
    await seed();

    await assertRefusedOnMerit(
      updateDoc(
        doc(testEnv.authenticatedContext('someone-else').firestore(), 'users', OWNER_UID),
        { phone: '(000) 000-0000' }
      )
    );
  });

  test('the owner cannot escalate their own role', async () => {
    await seed();

    await assertRefusedOnMerit(
      updateDoc(doc(ownerDb(), 'users', OWNER_UID), { role: 'Super User' })
    );
  });

  test('the owner cannot grant themselves permissions', async () => {
    await seed();

    await assertRefusedOnMerit(
      updateDoc(doc(ownerDb(), 'users', OWNER_UID), {
        permissions: {
          addUsers: true,
          manageEvents: true,
          manageMembershipStatus: true,
          managePayments: true,
          registerOthers: true,
          viewRegistrations: true
        }
      })
    );
  });

  test('the owner cannot change their own membership status', async () => {
    await seed();

    await assertRefusedOnMerit(
      updateDoc(doc(ownerDb(), 'users', OWNER_UID), { membershipStatus: 'Inactive' })
    );
  });
});

// The admin branches still run the full validUser() sweep. These prove that
// path can actually be evaluated rather than dying on the expression ceiling -
// the failure mode that made every update look like a flat refusal.
describe('admin edits of another member', () => {
  const SUPER_UID = 'super-1';
  const ADMIN_UID = 'admin-1';

  async function seedActors() {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', OWNER_UID), storedProfile());
      await setDoc(doc(db, 'users', SUPER_UID), storedProfile({
        email: 'super@example.com',
        name: 'Super User',
        role: 'Super User',
        userId: SUPER_UID
      }));
      await setDoc(doc(db, 'users', ADMIN_UID), storedProfile({
        email: 'admin@example.com',
        membershipStatus: 'Active',
        name: 'Admin User',
        permissions: {
          addUsers: true,
          manageEvents: false,
          manageMembershipStatus: false,
          managePayments: false,
          registerOthers: false,
          viewRegistrations: false
        },
        role: 'Admin',
        status: 'Active',
        userId: ADMIN_UID
      }));
    });
  }

  test('a super user can update another member', async () => {
    await seedActors();

    await assertSucceeds(
      updateDoc(
        doc(testEnv.authenticatedContext(SUPER_UID).firestore(), 'users', OWNER_UID),
        { phone: '(352) 653-8190' }
      )
    );
  });

  test('an admin with addUsers can update a general user', async () => {
    await seedActors();

    await assertSucceeds(
      updateDoc(
        doc(testEnv.authenticatedContext(ADMIN_UID).firestore(), 'users', OWNER_UID),
        { phone: '(352) 653-8191' }
      )
    );
  });
});

// registerOthers was added after go-live. validUser() only runs at create time
// (updates go through validSelfProfileEdit()/validUserAdminUpdate() instead,
// neither of which type-checks individual permission keys), but a create can
// still arrive with a permissions object missing the new key - an old cached
// client bundle mid-deploy, or a script that predates this change. The
// bool-type check on registerOthers has to stay optional-if-present (the same
// treatment addUsers already has), or that create is refused outright.
describe('self sign-up predating the registerOthers permission', () => {
  const NEW_SELF_SIGNUP_UID = 'signup-1';

  test('a self-created profile with no registerOthers key at all is still accepted', async () => {
    await testEnv.clearFirestore();

    await assertSucceeds(
      setDoc(doc(testEnv.authenticatedContext(NEW_SELF_SIGNUP_UID).firestore(), 'users', NEW_SELF_SIGNUP_UID), {
        createdDate: new Date('2026-07-26T00:00:00Z'),
        email: 'newmember@example.com',
        name: 'New Member',
        permissions: {
          addUsers: false,
          manageEvents: false,
          manageMembershipStatus: false,
          managePayments: false,
          viewRegistrations: false
        },
        phone: '(555) 010-1000',
        role: 'General User',
        status: 'Active',
        termsAccepted: true,
        termsAcceptedDate: new Date('2026-07-26T00:00:00Z'),
        termsVersion: '2026',
        userId: NEW_SELF_SIGNUP_UID
      })
    );

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'users', NEW_SELF_SIGNUP_UID));
    });
  });
});

// The concrete privilege-escalation path hasNoAdminPermissions()'s registerOthers
// clause exists to close: demoting an Admin who holds it must not let them keep
// it silently.
describe('demoting an admin who holds registerOthers', () => {
  const SUPER_UID = 'super-2';
  const DEMOTED_ADMIN_UID = 'admin-2';

  async function seedDemotionFixture() {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', SUPER_UID), storedProfile({
        email: 'super2@example.com',
        name: 'Super User Two',
        role: 'Super User',
        userId: SUPER_UID
      }));
      await setDoc(doc(db, 'users', DEMOTED_ADMIN_UID), storedProfile({
        email: 'admin2@example.com',
        membershipStatus: 'Active',
        name: 'Admin To Demote',
        permissions: {
          addUsers: false,
          manageEvents: false,
          manageMembershipStatus: false,
          managePayments: false,
          registerOthers: true,
          viewRegistrations: false
        },
        role: 'Admin',
        status: 'Active',
        userId: DEMOTED_ADMIN_UID
      }));
    });
  }

  function superDb() {
    return testEnv.authenticatedContext(SUPER_UID).firestore();
  }

  test('the demotion is refused if registerOthers is left true', async () => {
    await seedDemotionFixture();

    await assertRefusedOnMerit(
      updateDoc(doc(superDb(), 'users', DEMOTED_ADMIN_UID), { role: 'General User' })
    );
  });

  test('the demotion succeeds once registerOthers is cleared alongside the role change', async () => {
    await seedDemotionFixture();

    await assertSucceeds(
      updateDoc(doc(superDb(), 'users', DEMOTED_ADMIN_UID), {
        permissions: {
          addUsers: false,
          manageEvents: false,
          manageMembershipStatus: false,
          managePayments: false,
          registerOthers: false,
          viewRegistrations: false
        },
        role: 'General User'
      })
    );
  });
});
