import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Deletes Payment Review items - squareWebhookEvents documents - outright.
//
// Written for a one-off cleanup: a stray Square *sandbox* webhook subscription
// pointed at production for a while, and one sandbox payment fans out to every
// subscription in the account, so production accumulated Needs Review rows for
// payments that never happened there. That subscription is deleted, so this is
// a backlog to clear rather than a recurring job.
//
// Nothing else in the app can delete these. Firestore rules deny client writes
// to the collection outright, and the admin API only ever stamps an item
// Reviewed. Prefer that resolution path for anything real: a genuine webhook
// event is payment history, and Reviewed keeps it. Deletion is right only for
// records that describe a payment which did not occur in this project.
//
// Selection mirrors the Payment Reconciliation panel's own Needs Review
// predicate (isNeedsReview in src/components/admin/PaymentReconciliationPanel.jsx)
// so the script and the screen cannot disagree about what is in scope.
//
// Dry run unless --commit is passed. Every matched document is written to a
// JSON backup before anything is deleted, on both dry and committed runs.

const NEEDS_REVIEW = 'Needs Review';

const { FIREBASE_SERVICE_ACCOUNT_PATH } = process.env;

if (!FIREBASE_SERVICE_ACCOUNT_PATH) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH is required');
}

const commit = process.argv.includes('--commit');
const flagValue = (name) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));

  return match ? match.slice(prefix.length) : '';
};

// --expect is the interlock that makes this safe to run against production: the
// count is stated up front, from what the panel shows, and a mismatch means the
// data moved under us. Refusing beats deleting a set nobody has looked at.
const expected = flagValue('expect') ? Number(flagValue('expect')) : null;

if (expected !== null && !Number.isInteger(expected)) {
  throw new Error('--expect must be a whole number');
}

// Explicit ids win over the Needs Review sweep, for the case where only some of
// the matched rows should go.
const explicitIds = flagValue('id')
  ? flagValue('id').split(',').map((id) => id.trim()).filter(Boolean)
  : [];

const serviceAccount = JSON.parse(readFileSync(FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));

initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const db = getFirestore();

console.log(`Project: ${serviceAccount.project_id}`);
console.log(`Mode:    ${commit ? 'COMMIT - documents will be deleted' : 'dry run'}`);
console.log('');

const snapshot = await db.collection('squareWebhookEvents').get();
const allDocs = snapshot.docs.map((docSnap) => ({ data: docSnap.data(), id: docSnap.id }));

const matched = explicitIds.length
  ? allDocs.filter((entry) => explicitIds.includes(entry.id))
  : allDocs.filter((entry) => String(entry.data.reconciliationStatus || '').includes(NEEDS_REVIEW));

console.log(`squareWebhookEvents holds ${allDocs.length} document(s).`);
console.log(
  explicitIds.length
    ? `${matched.length} of ${explicitIds.length} requested id(s) found.`
    : `${matched.length} carry a "${NEEDS_REVIEW}" reconciliation status.`
);
console.log('');

if (explicitIds.length) {
  const missing = explicitIds.filter((id) => !matched.some((entry) => entry.id === id));

  if (missing.length) {
    throw new Error(`These ids are not in squareWebhookEvents: ${missing.join(', ')}`);
  }
}

const describe = (entry) => {
  const { data } = entry;
  const received = data.receivedAt?.toDate ? data.receivedAt.toDate().toISOString() : String(data.receivedAt || '');

  return [
    `  ${entry.id}`,
    `    status:        ${data.reconciliationStatus || '(none)'}`,
    `    type:          ${data.eventType || data.type || '(none)'}`,
    `    received:      ${received || '(none)'}`,
    `    amount:        ${data.amount ?? '(none)'}`,
    `    registration:  ${data.registrationId || '(none)'}`,
    `    square id:     ${data.squarePaymentId || data.squareTransactionId || '(none)'}`,
    `    note:          ${data.reconciliationNote || data.note || '(none)'}`
  ].join('\n');
};

matched.forEach((entry) => {
  console.log(describe(entry));
  console.log('');
});

if (!matched.length) {
  console.log('Nothing to delete.');
  process.exit(0);
}

// The backup is written before the expectation check, not after: if the count
// has moved, the file is exactly what is needed to work out why.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath =
  flagValue('backup')
  || `${process.env.HOME}/Desktop/payment-review-backup-${serviceAccount.project_id}-${stamp}.json`;

writeFileSync(
  backupPath,
  `${JSON.stringify(
    matched.map((entry) => ({ documentId: entry.id, ...entry.data })),
    (key, value) => (value?._seconds !== undefined ? new Date(value._seconds * 1000).toISOString() : value),
    2
  )}\n`,
  { mode: 0o600 }
);

console.log(`Backup written: ${backupPath}`);
console.log('');

if (expected !== null && matched.length !== expected) {
  throw new Error(
    `Expected ${expected} document(s) but matched ${matched.length}. Nothing deleted - re-check the panel.`
  );
}

if (!commit) {
  console.log('Dry run. Re-run with --commit to delete the documents listed above.');
  process.exit(0);
}

let deleted = 0;

for (const entry of matched) {
  await db.collection('squareWebhookEvents').doc(entry.id).delete();
  deleted += 1;
  console.log(`Deleted ${entry.id}`);
}

console.log('');
console.log(`Done. ${deleted} document(s) deleted from ${serviceAccount.project_id}.`);
