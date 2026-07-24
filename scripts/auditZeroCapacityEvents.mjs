import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!serviceAccountJson) {
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
  process.exit(1);
}

const trimmed = String(serviceAccountJson || '').trim();
let serviceAccount;

try {
  serviceAccount = JSON.parse(trimmed);
} catch {
  try {
    serviceAccount = JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
  } catch (error) {
    console.error(`Unable to parse FIREBASE_SERVICE_ACCOUNT_JSON: ${error.message}`);
    process.exit(1);
  }
}

const existingApp = getApps()[0];
const app = existingApp || initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const db = getFirestore(app);

async function findZeroCapacityEvents() {
  console.log('Finding events with capacity 0 and capacityUnlimited unset...\n');

  const snapshot = await db
    .collection('events')
    .where('capacity', '==', 0)
    .where('capacityUnlimited', '==', false)
    .get();

  if (snapshot.empty) {
    console.log('✓ No events found with the problematic capacity configuration.');
    process.exit(0);
  }

  console.log(`Found ${snapshot.size} event(s):\n`);

  const events = [];

  snapshot.forEach((doc) => {
    const event = doc.data();
    events.push({
      id: doc.id,
      title: event.title || '(untitled)',
      eventType: event.eventType || 'Unknown',
      date: event.date || '(no date)',
      status: event.status || 'Unknown',
      capacity: event.capacity,
      capacityUnlimited: event.capacityUnlimited
    });
  });

  // Sort by date for easier scanning
  events.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  events.forEach((event) => {
    console.log(`ID: ${event.id}`);
    console.log(`  Title: ${event.title}`);
    console.log(`  Type: ${event.eventType}`);
    console.log(`  Date: ${event.date}`);
    console.log(`  Status: ${event.status}`);
    console.log(`  Capacity: ${event.capacity} (unlimited: ${event.capacityUnlimited})`);
    console.log('  Action: Edit this event and set a capacity of at least 1, or enable unlimited capacity.\n');
  });

  console.log(`\nSummary: ${events.length} event(s) need capacity correction.`);
  console.log('These events currently advertise open seats but silently waitlist all registrants.');
  console.log('Edit each one in the Admin Dashboard and save to apply the new validation.');
}

findZeroCapacityEvents().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
