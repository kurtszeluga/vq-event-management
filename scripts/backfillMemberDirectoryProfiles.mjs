import { readFileSync } from 'node:fs';
import process from 'node:process';
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  applyMemberDirectorySync,
  isEligibleForMemberDirectory
} from '../api/_lib/member-directory-profile.js';

const { FIREBASE_SERVICE_ACCOUNT_PATH } = process.env;

if (!FIREBASE_SERVICE_ACCOUNT_PATH) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH is required');
}

const serviceAccount = JSON.parse(readFileSync(FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));

initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const db = getFirestore();
const usersSnapshot = await db.collection('users').get();
const directorySnapshot = await db.collection('memberDirectoryProfiles').get();
const existingDirectoryIds = new Set(directorySnapshot.docs.map((docSnap) => docSnap.id));
const eligibleUserIds = new Set();
let upsertedCount = 0;
let deletedCount = 0;
const chunkSize = 200;
let batch = db.batch();
let batchOps = 0;

async function commitBatch() {
  if (!batchOps) {
    return;
  }

  await batch.commit();
  batch = db.batch();
  batchOps = 0;
}

for (const userDoc of usersSnapshot.docs) {
  const profile = { id: userDoc.id, ...userDoc.data() };
  const userId = userDoc.id;

  if (isEligibleForMemberDirectory(profile)) {
    eligibleUserIds.add(userId);
    applyMemberDirectorySync(db, batch, userId, profile, FieldValue.serverTimestamp());
    upsertedCount += 1;
    batchOps += 1;
  } else if (existingDirectoryIds.has(userId)) {
    batch.delete(db.collection('memberDirectoryProfiles').doc(userId));
    deletedCount += 1;
    batchOps += 1;
  }

  if (batchOps >= chunkSize) {
    await commitBatch();
  }
}

for (const directoryDoc of directorySnapshot.docs) {
  if (eligibleUserIds.has(directoryDoc.id)) {
    continue;
  }

  batch.delete(directoryDoc.ref);
  deletedCount += 1;
  batchOps += 1;

  if (batchOps >= chunkSize) {
    await commitBatch();
  }
}

await commitBatch();

console.log(`Backfill complete. Upserted ${upsertedCount} directory profiles and removed ${deletedCount} ineligible docs.`);
