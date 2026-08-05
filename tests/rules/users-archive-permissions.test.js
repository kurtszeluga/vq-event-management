import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

// The permission map the rules accept has to stay a superset of the one the app
// writes. USER_PERMISSION_OPTIONS grew a seventh key, manageWaitlist, and
// normalizePermissions() stamps all seven onto every profile saved through User
// Controls - so a rule set that allows only six silently locks those documents
// out of every client-side write afterwards. Archive is the one that bites:
// archiveUserProfile() in src/services/userService.js goes through the client
// SDK, so it is validated by these rules rather than the Admin SDK.
const ACTOR_UID = 'super-user-1';
const TARGET_UID = 'user-2';

let testEnv;

function permissions(overrides = {}) {
  return {
    addUsers: false,
    manageEvents: false,
    manageMembershipStatus: false,
    managePayments: false,
    registerOthers: false,
    viewRegistrations: false,
    ...overrides
  };
}

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
    membershipStatus: 'Active',
    name: 'Ada Lovelace',
    permissions: permissions(),
    phone: '(352) 653-8188',
    profileTags: [],
    role: 'General User',
    status: 'Active',
    updatedDate: new Date('2026-01-02T00:00:00Z'),
    userId: TARGET_UID,
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

async function seed(targetProfile) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'users', ACTOR_UID), storedProfile({
      email: 'webmaster@villagequilters.com',
      name: 'Web Master',
      role: 'Super User',
      userId: ACTOR_UID
    }));
    await setDoc(doc(db, 'users', TARGET_UID), targetProfile);
  });
}

function actorDb() {
  return testEnv.authenticatedContext(ACTOR_UID).firestore();
}

// The archive write itself, as src/services/userService.js sends it.
function archive(db) {
  return updateDoc(doc(db, 'users', TARGET_UID), {
    archivedBy: 'Web Master',
    archivedDate: new Date('2026-02-01T00:00:00Z'),
    status: 'Inactive',
    updatedDate: new Date('2026-02-01T00:00:00Z')
  });
}

describe('users/{uid} admin update against the stored permission map', () => {
  test('a Super User can archive a profile carrying the six original keys', async () => {
    await seed(storedProfile());

    await assertSucceeds(archive(actorDb()));
  });

  test('a Super User can archive a profile that also carries manageWaitlist', async () => {
    // Every profile saved through User Controls has this key, because
    // normalizePermissions() writes all of USER_PERMISSION_OPTIONS. If the
    // rules' hasOnly() list omits it, this is refused and the account can never
    // be archived from the UI again.
    await seed(storedProfile({ permissions: permissions({ manageWaitlist: false }) }));

    await assertSucceeds(archive(actorDb()));
  });

  test('a Super User can edit an Admin holding manageWaitlist', async () => {
    await seed(storedProfile({
      permissions: permissions({ manageEvents: true, manageWaitlist: true }),
      role: 'Admin'
    }));

    await assertSucceeds(
      updateDoc(doc(actorDb(), 'users', TARGET_UID), {
        phone: '(865) 555-1234',
        updatedDate: new Date('2026-02-01T00:00:00Z')
      })
    );
  });

  // The closing clause of validUserAdminUpdate() only accepts role Admin
  // alongside status Active, so archiving an Admin that stays an Admin can
  // never satisfy it - the Archive button did nothing on an admin row.
  // archiveUserProfile() now demotes as part of the same write, which is what
  // these two pin: the demoted shape is accepted, the undemoted one is not.
  test('archiving an Admin without demoting it is still refused', async () => {
    await seed(storedProfile({
      permissions: permissions({ manageEvents: true }),
      role: 'Admin'
    }));

    let raised = null;

    try {
      await archive(actorDb());
    } catch (error) {
      raised = error;
    }

    assert.ok(raised, 'expected archiving an Admin in place to be refused');
    assert.equal(raised.code, 'permission-denied');
    assert.ok(
      !/maximum of 1000 expressions/.test(raised.message),
      'refused because the rule could not be evaluated, not because it said no'
    );
  });

  test('archiving an Admin succeeds when the write demotes it', async () => {
    await seed(storedProfile({
      permissions: permissions({ manageEvents: true, manageWaitlist: true }),
      role: 'Admin'
    }));

    // Exactly what archiveUserProfile() sends for an Admin.
    await assertSucceeds(
      updateDoc(doc(actorDb(), 'users', TARGET_UID), {
        archivedBy: 'Web Master',
        archivedDate: new Date('2026-02-01T00:00:00Z'),
        permissions: permissions({ manageWaitlist: false }),
        role: 'General User',
        status: 'Inactive',
        updatedDate: new Date('2026-02-01T00:00:00Z')
      })
    );
  });
});
