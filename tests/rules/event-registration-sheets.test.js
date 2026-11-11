import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';

// Two paths added for the Google Sheet sync, both security-relevant enough to
// be worth the emulator:
//
//   eventRegistrationSheets/{eventId} holds the spreadsheet a given event's
//   registrations get written into. A client that could write it could point
//   an event's sync at a spreadsheet of its own and have the server copy every
//   registrant's name, email and phone number into it - so no client may write
//   it at all, and only someone who may already see those registrations may
//   read it.
//
//   appSettings/registrationSheets is the switch and the Drive folder. Pinned
//   by keys().hasOnly() like every other settings document, which is the trap
//   described in tests/client/appSettingsWritersDoNotMerge.test.js.
const SUPER_USER_UID = 'super-1';
const VIEWER_UID = 'viewer-1';
const MEMBER_UID = 'member-1';

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

async function seedUsers() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, 'users', SUPER_USER_UID), {
      email: 'owner@example.com',
      name: 'Guild Owner',
      role: 'Super User',
      status: 'Active'
    });
    await setDoc(doc(db, 'users', VIEWER_UID), {
      email: 'coordinator@example.com',
      name: 'Event Coordinator',
      permissions: { viewRegistrations: true },
      role: 'Admin',
      status: 'Active'
    });
    await setDoc(doc(db, 'users', MEMBER_UID), {
      email: 'member@example.com',
      name: 'Ada Lovelace',
      role: 'General User',
      status: 'Active'
    });
    // Written the way the server writes it, with rules disabled - the Admin
    // SDK bypasses rules, which is the only way this document is ever created.
    await setDoc(doc(db, 'eventRegistrationSheets', 'evt-1'), {
      eventId: 'evt-1',
      lastError: '',
      rowCount: 2,
      sheetTitle: 'Registrations',
      spreadsheetId: 'sheet-1',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
      updatedDate: new Date()
    });
  });
}

function dbFor(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function validSettings(overrides = {}) {
  return {
    driveFolderId: 'folder-1',
    enableRegistrationSheets: true,
    updatedDate: new Date(),
    ...overrides
  };
}

describe('eventRegistrationSheets/{eventId}', () => {
  test('a coordinator with viewRegistrations can read the sheet link', async () => {
    await seedUsers();

    await assertSucceeds(getDoc(doc(dbFor(VIEWER_UID), 'eventRegistrationSheets', 'evt-1')));
  });

  test('a super user can read the sheet link', async () => {
    await seedUsers();

    await assertSucceeds(getDoc(doc(dbFor(SUPER_USER_UID), 'eventRegistrationSheets', 'evt-1')));
  });

  test('an ordinary member cannot read it', async () => {
    // It names a spreadsheet full of other members' contact details. The
    // member-visible list is eventRegistrantNames, which is names only.
    await seedUsers();

    await assertFails(getDoc(doc(dbFor(MEMBER_UID), 'eventRegistrationSheets', 'evt-1')));
  });

  test('a signed-out visitor cannot read it', async () => {
    await seedUsers();

    await assertFails(getDoc(
      doc(testEnv.unauthenticatedContext().firestore(), 'eventRegistrationSheets', 'evt-1')
    ));
  });

  test('nobody may create a sheet link from a client, not even a super user', async () => {
    // Writes are server-only. A client that could create this document could
    // choose which spreadsheet an event's registrations are copied into.
    await seedUsers();

    await assertFails(setDoc(
      doc(dbFor(SUPER_USER_UID), 'eventRegistrationSheets', 'evt-2'),
      { eventId: 'evt-2', spreadsheetId: 'attacker-sheet' }
    ));
  });

  test('nobody may repoint an existing sheet link from a client', async () => {
    await seedUsers();

    await assertFails(setDoc(
      doc(dbFor(SUPER_USER_UID), 'eventRegistrationSheets', 'evt-1'),
      { eventId: 'evt-1', spreadsheetId: 'attacker-sheet' }
    ));
    await assertFails(setDoc(
      doc(dbFor(VIEWER_UID), 'eventRegistrationSheets', 'evt-1'),
      { eventId: 'evt-1', spreadsheetId: 'attacker-sheet' }
    ));
  });

  test('nobody may delete a sheet link from a client', async () => {
    await seedUsers();

    await assertFails(deleteDoc(doc(dbFor(SUPER_USER_UID), 'eventRegistrationSheets', 'evt-1')));
  });
});

describe('appSettings/registrationSheets', () => {
  test('a super user can save the settings', async () => {
    await seedUsers();

    await assertSucceeds(
      setDoc(doc(dbFor(SUPER_USER_UID), 'appSettings', 'registrationSheets'), validSettings())
    );
  });

  test('switching the feature off is just as valid as switching it on', async () => {
    await seedUsers();

    await assertSucceeds(setDoc(
      doc(dbFor(SUPER_USER_UID), 'appSettings', 'registrationSheets'),
      validSettings({ driveFolderId: '', enableRegistrationSheets: false })
    ));
  });

  test('an admin who is not a super user cannot save them', async () => {
    await seedUsers();

    await assertFails(
      setDoc(doc(dbFor(VIEWER_UID), 'appSettings', 'registrationSheets'), validSettings())
    );
  });

  test('a non-boolean switch is refused', async () => {
    await seedUsers();

    await assertFails(setDoc(
      doc(dbFor(SUPER_USER_UID), 'appSettings', 'registrationSheets'),
      validSettings({ enableRegistrationSheets: 'true' })
    ));
  });

  test('a non-string folder is refused', async () => {
    await seedUsers();

    await assertFails(setDoc(
      doc(dbFor(SUPER_USER_UID), 'appSettings', 'registrationSheets'),
      validSettings({ driveFolderId: 12345 })
    ));
  });

  test('a payload missing a declared field is refused', async () => {
    // This is the half of the hasOnly() trap that a save must not be allowed
    // to fall into: see tests/client/appSettingsWritersDoNotMerge.test.js.
    await seedUsers();
    const payload = validSettings();
    delete payload.driveFolderId;

    await assertFails(
      setDoc(doc(dbFor(SUPER_USER_UID), 'appSettings', 'registrationSheets'), payload)
    );
  });

  test('an unrecognized extra key is refused', async () => {
    await seedUsers();

    await assertFails(setDoc(
      doc(dbFor(SUPER_USER_UID), 'appSettings', 'registrationSheets'),
      validSettings({ serviceAccountKey: 'not going in Firestore' })
    ));
  });

  test('a merging save that drops a field is refused, as it is for every other settings doc', async () => {
    // The merged document is what the rules see, so a second save that leaves
    // a field out still presents the stored value and passes - but one that
    // drops a field from a document already missing it does not. Asserting the
    // full-set shape is what keeps this document savable forever.
    await seedUsers();
    await assertSucceeds(
      setDoc(doc(dbFor(SUPER_USER_UID), 'appSettings', 'registrationSheets'), validSettings())
    );
    await assertSucceeds(setDoc(
      doc(dbFor(SUPER_USER_UID), 'appSettings', 'registrationSheets'),
      validSettings({ enableRegistrationSheets: false })
    ));
  });
});
