// Copies event documents from one Firebase project's `events` collection into
// another's - normally Production into vq-event-management-test, so listings
// entered once for real can be reused as test data instead of retyped.
//
// Production and test are entirely separate Firebase projects, so nothing is
// shared between them and this is the only way across. It needs a service
// account for each side:
//
//   SOURCE_SERVICE_ACCOUNT_PATH=~/prod-sa.json \
//   TARGET_SERVICE_ACCOUNT_PATH=~/test-sa.json \
//   npm run copy:events
//
// Dry run by default - it reports exactly what it would write and touches
// nothing. Add --commit to actually write:
//
//   ... npm run copy:events -- --commit
//
// Other flags:
//   --overwrite        replace events already present in the target
//                      (default: skip them, so a re-run only adds what is new)
//   --type="For Sale"  copy a single event type; repeatable
//   --limit=10         stop after this many source events
//
// Deliberately copies ONLY the events collection. Registrations, payments and
// users are not test fixtures - they carry real people's data, and a
// registration pointing at a copied event would be a fabricated record.
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const { SOURCE_SERVICE_ACCOUNT_PATH, TARGET_SERVICE_ACCOUNT_PATH } = process.env;

if (!SOURCE_SERVICE_ACCOUNT_PATH || !TARGET_SERVICE_ACCOUNT_PATH) {
  throw new Error(
    'SOURCE_SERVICE_ACCOUNT_PATH and TARGET_SERVICE_ACCOUNT_PATH are both required'
  );
}

const args = process.argv.slice(2);
const shouldCommit = args.includes('--commit');
const shouldOverwrite = args.includes('--overwrite');
const typeFilters = args
  .filter((arg) => arg.startsWith('--type='))
  .map((arg) => arg.slice('--type='.length).replace(/^["']|["']$/g, ''));
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : 0;

function loadAccount(path) {
  const account = JSON.parse(readFileSync(path.replace(/^~/, process.env.HOME || '~'), 'utf8'));

  if (!account.project_id) {
    throw new Error(`${path} is not a service account key - no project_id`);
  }

  return account;
}

const sourceAccount = loadAccount(SOURCE_SERVICE_ACCOUNT_PATH);
const targetAccount = loadAccount(TARGET_SERVICE_ACCOUNT_PATH);

// The whole point of the script is moving data between two projects, so the
// one mistake worth refusing outright is pointing both halves at the same one.
if (sourceAccount.project_id === targetAccount.project_id) {
  throw new Error(
    `Source and target are the same project (${sourceAccount.project_id}). Refusing to run.`
  );
}

const sourceApp = initializeApp(
  { credential: cert(sourceAccount), projectId: sourceAccount.project_id },
  'source'
);
const targetApp = initializeApp(
  { credential: cert(targetAccount), projectId: targetAccount.project_id },
  'target'
);
const sourceDb = getFirestore(sourceApp);
const targetDb = getFirestore(targetApp);

console.log(`Source: ${sourceAccount.project_id}`);
console.log(`Target: ${targetAccount.project_id}`);
console.log(shouldCommit ? 'Mode:   COMMIT - this will write\n' : 'Mode:   dry run - nothing will be written\n');

const sourceSnapshot = await sourceDb.collection('events').get();
const targetSnapshot = await targetDb.collection('events').get();
const existingTargetIds = new Set(targetSnapshot.docs.map((docSnap) => docSnap.id));

let candidates = sourceSnapshot.docs;

if (typeFilters.length) {
  candidates = candidates.filter((docSnap) => typeFilters.includes(docSnap.data().eventType));
}

if (limit > 0) {
  candidates = candidates.slice(0, limit);
}

const toCreate = [];
const toOverwrite = [];
const toSkip = [];

candidates.forEach((docSnap) => {
  if (!existingTargetIds.has(docSnap.id)) {
    toCreate.push(docSnap);
  } else if (shouldOverwrite) {
    toOverwrite.push(docSnap);
  } else {
    toSkip.push(docSnap);
  }
});

// Photos and PDFs are referenced by absolute download URL, and those URLs
// point at the SOURCE project's storage bucket. Copied events therefore render
// their images fine but serve them from the source - acceptable for test
// fixtures, and worth knowing before deleting anything on the source side.
const withAssets = candidates.filter((docSnap) => {
  const data = docSnap.data();
  return (Array.isArray(data.imageUrls) && data.imageUrls.some(Boolean)) || data.supplyListUrl;
});

function describe(docSnap) {
  const data = docSnap.data();
  return `  ${docSnap.id}  ${(data.eventType || 'Unknown').padEnd(18)} ${data.title || data.businessName || '(untitled)'}`;
}

if (toCreate.length) {
  console.log(`Create (${toCreate.length}):`);
  toCreate.forEach((docSnap) => console.log(describe(docSnap)));
}

if (toOverwrite.length) {
  console.log(`\nOverwrite (${toOverwrite.length}):`);
  toOverwrite.forEach((docSnap) => console.log(describe(docSnap)));
}

if (toSkip.length) {
  console.log(`\nAlready in target, skipping (${toSkip.length}) - use --overwrite to replace:`);
  toSkip.forEach((docSnap) => console.log(describe(docSnap)));
}

if (withAssets.length) {
  console.log(
    `\nNote: ${withAssets.length} of these carry photos or a PDF. Those files stay in`
  );
  console.log(`${sourceAccount.project_id}'s storage bucket and are served from there.`);
}

const writes = [...toCreate, ...toOverwrite];

if (!writes.length) {
  console.log('\nNothing to write.');
  process.exit(0);
}

if (!shouldCommit) {
  console.log(`\nDry run - would write ${writes.length} event(s). Re-run with --commit.`);
  process.exit(0);
}

// Doc IDs are preserved, which makes a re-run idempotent and keeps
// /events/{id} links pointing at the same record on both sides.
const chunkSize = 200;
let batch = targetDb.batch();
let batchOps = 0;
let written = 0;

async function commitBatch() {
  if (!batchOps) {
    return;
  }

  await batch.commit();
  batch = targetDb.batch();
  batchOps = 0;
}

for (const docSnap of writes) {
  batch.set(targetDb.collection('events').doc(docSnap.id), docSnap.data());
  batchOps += 1;
  written += 1;

  if (batchOps >= chunkSize) {
    await commitBatch();
  }
}

await commitBatch();

console.log(`\nWrote ${written} event(s) to ${targetAccount.project_id}.`);
