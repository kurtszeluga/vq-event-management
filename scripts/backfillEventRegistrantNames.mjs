import { readFileSync } from 'node:fs';
import process from 'node:process';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { buildRegistrantNames } from '../shared/eventRegistrantNames.js';

// Builds eventRegistrantNames/{eventId} for events that already have
// registrations. The app maintains these documents from now on, but only from
// the next registration change onwards - without this, every event that existed
// before the feature shipped shows an empty list until somebody registers or
// cancels.
//
// Uses the same projection the app uses (shared/eventRegistrantNames.js), so a
// backfilled list and a live-maintained one cannot disagree about who appears.
//
// Dry run unless --commit is passed.

const { FIREBASE_SERVICE_ACCOUNT_PATH } = process.env;

if (!FIREBASE_SERVICE_ACCOUNT_PATH) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH is required');
}

const commit = process.argv.includes('--commit');
const serviceAccount = JSON.parse(readFileSync(FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));

initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const db = getFirestore();

// Read every registration once and group in memory rather than querying per
// event: the collection is small, and one pass cannot miss an event whose only
// registrations are cancelled.
const registrationsSnapshot = await db.collection('registrations').get();
const registrationsByEvent = new Map();

registrationsSnapshot.docs.forEach((docSnap) => {
  const registration = docSnap.data();
  const eventId = String(registration.eventId || '').trim();

  if (!eventId) {
    return;
  }

  registrationsByEvent.set(eventId, [...(registrationsByEvent.get(eventId) || []), registration]);
});

const existingSnapshot = await db.collection('eventRegistrantNames').get();
const existing = new Map(
  existingSnapshot.docs.map((docSnap) => [docSnap.id, docSnap.data().names || []])
);

const planned = [];

registrationsByEvent.forEach((registrations, eventId) => {
  const names = buildRegistrantNames(registrations);
  const before = existing.get(eventId);

  // An event whose stored list already matches is skipped, so a re-run after a
  // partial failure only writes what is still wrong.
  if (before && before.length === names.length && before.every((name, index) => name === names[index])) {
    return;
  }

  planned.push({ eventId, names, replacing: before });
});

console.log(`Project           : ${serviceAccount.project_id}`);
console.log(`Registrations     : ${registrationsSnapshot.size}`);
console.log(`Events with any   : ${registrationsByEvent.size}`);
console.log(`Lists already set : ${existingSnapshot.size}`);
console.log(`To write          : ${planned.length}\n`);

planned.slice(0, 20).forEach(({ eventId, names, replacing }) => {
  const action = replacing ? `updating (was ${replacing.length})` : 'creating';

  console.log(`  ${eventId}  ${action}, ${names.length} name${names.length === 1 ? '' : 's'}`);
});

if (planned.length > 20) {
  console.log(`  ... and ${planned.length - 20} more`);
}

if (!planned.length) {
  console.log('\nNothing to do.');
  process.exit(0);
}

if (!commit) {
  console.log('\nDRY RUN - re-run with --commit to write.');
  process.exit(0);
}

const chunkSize = 200;

for (let index = 0; index < planned.length; index += chunkSize) {
  const batch = db.batch();

  planned.slice(index, index + chunkSize).forEach(({ eventId, names }) => {
    batch.set(db.collection('eventRegistrantNames').doc(eventId), {
      eventId,
      names,
      updatedDate: FieldValue.serverTimestamp()
    });
  });

  await batch.commit();
}

console.log(`\nWrote ${planned.length} registrant name list${planned.length === 1 ? '' : 's'}.`);
