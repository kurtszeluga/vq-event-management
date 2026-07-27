import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

// Adding sendCoordinatorRegistrationNotifications to validEmailInstructions()'s
// hasOnly() whitelist is an easy thing to get subtly wrong - a typo'd key name
// or a missing "is bool" check would either reject every future save of this
// settings doc, or silently accept a malformed value. This exercises just the
// new field against the real emulator, since nothing previously covered this
// document at all.
const SUPER_USER_UID = 'super-1';

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
    await setDoc(doc(context.firestore(), 'users', SUPER_USER_UID), {
      email: 'owner@example.com',
      name: 'Guild Owner',
      role: 'Super User',
      status: 'Active'
    });
  });
}

function superUserDb() {
  return testEnv.authenticatedContext(SUPER_USER_UID).firestore();
}

function validPayload(overrides = {}) {
  return {
    challenges: '',
    membership: '',
    programs: '',
    sendCoordinatorRegistrationNotifications: false,
    sendRegistrationConfirmations: false,
    workshops: '',
    updatedDate: new Date(),
    ...overrides
  };
}

describe('appSettings/emailInstructions - sendCoordinatorRegistrationNotifications', () => {
  test('a Super User can save the full payload with the new field set to true', async () => {
    await seedSuperUser();

    await assertSucceeds(
      setDoc(
        doc(superUserDb(), 'appSettings', 'emailInstructions'),
        validPayload({ sendCoordinatorRegistrationNotifications: true })
      )
    );
  });

  test('a Super User can save the full payload with the new field set to false', async () => {
    await seedSuperUser();

    await assertSucceeds(
      setDoc(doc(superUserDb(), 'appSettings', 'emailInstructions'), validPayload())
    );
  });

  test('a non-boolean value for the new field is refused', async () => {
    await seedSuperUser();

    await assertFails(
      setDoc(
        doc(superUserDb(), 'appSettings', 'emailInstructions'),
        validPayload({ sendCoordinatorRegistrationNotifications: 'true' })
      )
    );
  });

  test('an otherwise-valid payload missing the new field entirely is refused', async () => {
    await seedSuperUser();
    const payload = validPayload();
    delete payload.sendCoordinatorRegistrationNotifications;

    await assertFails(
      setDoc(doc(superUserDb(), 'appSettings', 'emailInstructions'), payload)
    );
  });

  test('an unrecognized extra key is still refused', async () => {
    await seedSuperUser();

    await assertFails(
      setDoc(
        doc(superUserDb(), 'appSettings', 'emailInstructions'),
        validPayload({ notARealField: true })
      )
    );
  });
});
