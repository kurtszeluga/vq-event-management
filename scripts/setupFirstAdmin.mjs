import { readFileSync } from 'node:fs';
import process from 'node:process';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const {
  FIREBASE_SERVICE_ACCOUNT_PATH,
  FIRST_ADMIN_EMAIL,
  FIRST_ADMIN_NAME,
  FIRST_ADMIN_PASSWORD,
  FIRST_ADMIN_PHONE = ''
} = process.env;

function required(name, value) {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

const serviceAccountPath = required(
  'FIREBASE_SERVICE_ACCOUNT_PATH',
  FIREBASE_SERVICE_ACCOUNT_PATH
);
const email = required('FIRST_ADMIN_EMAIL', FIRST_ADMIN_EMAIL);
const password = required('FIRST_ADMIN_PASSWORD', FIRST_ADMIN_PASSWORD);
const name = required('FIRST_ADMIN_NAME', FIRST_ADMIN_NAME);

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const auth = getAuth();
const db = getFirestore();

let userRecord;

try {
  userRecord = await auth.getUserByEmail(email);
  userRecord = await auth.updateUser(userRecord.uid, {
    displayName: name,
    emailVerified: true,
    password
  });
  console.log(`Using existing Firebase Auth user: ${userRecord.uid}`);
} catch (error) {
  if (error.code !== 'auth/user-not-found') {
    throw error;
  }

  userRecord = await auth.createUser({
    displayName: name,
    email,
    emailVerified: true,
    password
  });
  console.log(`Created Firebase Auth user: ${userRecord.uid}`);
}

const userRef = db.collection('users').doc(userRecord.uid);
const existingProfile = await userRef.get();
const now = FieldValue.serverTimestamp();

await userRef.set(
  {
    userId: userRecord.uid,
    name,
    email,
    phone: FIRST_ADMIN_PHONE,
    permissions: {
      manageEvents: true,
      managePayments: true,
      viewRegistrations: true
    },
    role: 'Super User',
    status: 'Active',
    createdDate: existingProfile.exists ? existingProfile.data().createdDate : now,
    updatedDate: now
  },
  { merge: true }
);

console.log(`Admin profile is ready for ${email}`);
