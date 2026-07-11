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

function formatPhoneNumber(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10);

  if (digits.length <= 3) {
    return digits;
  }

  if (digits.length <= 6) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

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
    billingAddress: existingProfile.exists
      ? existingProfile.data().billingAddress || {
          city: '',
          country: 'United States',
          postalCode: '',
          state: '',
          street: ''
        }
      : {
          city: '',
          country: 'United States',
          postalCode: '',
          state: '',
          street: ''
        },
    userId: userRecord.uid,
    name,
    email,
    phone: formatPhoneNumber(FIRST_ADMIN_PHONE),
    profileTags: existingProfile.exists ? existingProfile.data().profileTags || [] : [],
    permissions: {
      addUsers: true,
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
