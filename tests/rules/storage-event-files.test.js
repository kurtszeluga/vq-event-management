import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { getMetadata, ref, uploadBytes } from 'firebase/storage';

// A 2026-07-24 version of these rules gated event-file writes on a
// cross-service firestore.get() checking the uploader's role and status.
// That call denied every account in production - Super User and Admin
// alike - despite the same accounts working fine everywhere else in the
// app and despite this exact rule text authorizing both account types
// correctly against a local Firestore+Storage emulator. Reverted to the
// ownership-only check this project ran on for weeks before that change;
// Firestore's own rules already keep event documents server-write-only
// regardless of what this file allows. This suite exists so a future
// re-introduction of an admin-role check here gets caught by a real
// account, not just by matching what a human reads in the rules text.
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'vq-rules-test',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8')
    },
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules: readFileSync('storage.rules', 'utf8')
    }
  });
});

after(async () => {
  await testEnv?.cleanup();
});

describe('event-images storage rules', () => {
  test('any signed-in user can upload an image into their own folder', async () => {
    const uid = 'any-signed-in-user';
    const storage = testEnv.authenticatedContext(uid).storage();
    const fileRef = ref(storage, `event-images/${uid}/photo.jpg`);

    await assertSucceeds(
      uploadBytes(fileRef, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' })
    );
  });

  test('a signed-in user cannot upload into another user\'s folder', async () => {
    const storage = testEnv.authenticatedContext('user-a').storage();
    const fileRef = ref(storage, 'event-images/user-b/photo.jpg');

    await assertFails(
      uploadBytes(fileRef, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' })
    );
  });

  test('a signed-out client cannot upload at all', async () => {
    const storage = testEnv.unauthenticatedContext().storage();
    const fileRef = ref(storage, 'event-images/nobody/photo.jpg');

    await assertFails(
      uploadBytes(fileRef, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' })
    );
  });

  test('a non-image content type is refused even in the uploader\'s own folder', async () => {
    const uid = 'wrong-type-user';
    const storage = testEnv.authenticatedContext(uid).storage();
    const fileRef = ref(storage, `event-images/${uid}/not-an-image.txt`);

    await assertFails(
      uploadBytes(fileRef, new Uint8Array([1, 2, 3]), { contentType: 'text/plain' })
    );
  });

  test('reads are always public, matching the public listing pages', async () => {
    const uid = 'reader-check-owner';
    const ownerStorage = testEnv.authenticatedContext(uid).storage();
    await uploadBytes(
      ref(ownerStorage, `event-images/${uid}/photo.jpg`),
      new Uint8Array([1, 2, 3]),
      { contentType: 'image/jpeg' }
    );

    const anonymousStorage = testEnv.unauthenticatedContext().storage();

    // getMetadata exercises the read rule without needing a full download.
    await assertSucceeds(getMetadata(ref(anonymousStorage, `event-images/${uid}/photo.jpg`)));
  });
});
