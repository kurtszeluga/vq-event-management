import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

// Regression cover for a real production outage: the Membership Check card
// could not be saved at all, and reported a permission error to a Super User.
//
// The cause was the interaction between two things that are each fine alone.
// validMembershipSettings() pins the document with keys().hasOnly(...), and
// saveMembershipSettings() wrote it with { merge: true } - under which
// request.resource.data is the MERGED document, not the payload. So once
// allowAdminSkipMembershipCheck had been written to the stored document and was
// later dropped from the payload (89aba62, 2026-07-26), every subsequent save
// merged the orphan key back into request.resource.data and failed hasOnly().
// Production's document still carried it, and the last successful write was
// 2026-07-22.
//
// The first test here is the outage. It fails against a merging writer and
// passes against a full set, which is why the writer no longer merges.
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

// Seeds the Super User and, optionally, a stored settings document carrying a
// field the current payload no longer writes - the production shape.
async function seed({ storedExtras = null } = {}) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', SUPER_USER_UID), {
      email: 'owner@example.com',
      name: 'Guild Owner',
      role: 'Super User',
      status: 'Active'
    });

    if (storedExtras) {
      await setDoc(doc(context.firestore(), 'appSettings', 'membership'), {
        ...validPayload(),
        ...storedExtras
      });
    }
  });
}

function superUserDb() {
  return testEnv.authenticatedContext(SUPER_USER_UID).firestore();
}

function validPayload(overrides = {}) {
  return {
    matchByEmail: true,
    matchByPhone: false,
    requireMembershipCheck: true,
    termsText: '',
    termsVersion: '',
    updatedDate: new Date(),
    ...overrides
  };
}

describe('appSettings/membership', () => {
  test('a full set clears an orphan key the payload no longer writes', async () => {
    // The outage, and the fix. The stored document carries
    // allowAdminSkipMembershipCheck; a full set replaces the document with
    // exactly the six valid fields, so hasOnly() passes and the orphan is gone.
    await seed({ storedExtras: { allowAdminSkipMembershipCheck: false } });

    await assertSucceeds(
      setDoc(doc(superUserDb(), 'appSettings', 'membership'), validPayload())
    );
  });

  test('merging onto that same document is refused', async () => {
    // Why the writer must not merge. Same stored document, same valid payload,
    // denied - because request.resource.data under a merge still carries the
    // orphan key. This is the exact call the app used to make.
    await seed({ storedExtras: { allowAdminSkipMembershipCheck: false } });

    await assertFails(
      setDoc(
        doc(superUserDb(), 'appSettings', 'membership'),
        validPayload(),
        { merge: true }
      )
    );
  });

  test('a Super User can save the membership settings on a clean document', async () => {
    await seed();

    await assertSucceeds(
      setDoc(doc(superUserDb(), 'appSettings', 'membership'), validPayload())
    );
  });

  test('the registration gate can be toggled in both directions', async () => {
    // The control that was unusable. Both values have to be writable.
    await seed();

    await assertSucceeds(
      setDoc(
        doc(superUserDb(), 'appSettings', 'membership'),
        validPayload({ requireMembershipCheck: false })
      )
    );
    await assertSucceeds(
      setDoc(
        doc(superUserDb(), 'appSettings', 'membership'),
        validPayload({ requireMembershipCheck: true })
      )
    );
  });

  test('a non-boolean registration gate is refused', async () => {
    await seed();

    await assertFails(
      setDoc(
        doc(superUserDb(), 'appSettings', 'membership'),
        validPayload({ requireMembershipCheck: 'true' })
      )
    );
  });

  test('an unrecognized extra key in the payload is refused', async () => {
    await seed();

    await assertFails(
      setDoc(
        doc(superUserDb(), 'appSettings', 'membership'),
        validPayload({ notARealField: true })
      )
    );
  });

  test('a non-Super-User admin cannot write it', async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', 'admin-1'), {
        email: 'admin@example.com',
        name: 'Guild Admin',
        permissions: { manageEvents: true },
        role: 'Admin',
        status: 'Active'
      });
    });

    await assertFails(
      setDoc(
        doc(testEnv.authenticatedContext('admin-1').firestore(), 'appSettings', 'membership'),
        validPayload()
      )
    );
  });
});
