import { getFirestore } from 'firebase-admin/firestore';
import { initializeAdminApp } from './_lib/public-event-feed.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    initializeAdminApp();

    const email = normalizeEmail(request.body?.email);
    const phone = normalizePhone(request.body?.phone);

    if (!email) {
      response.status(400).json({ error: 'Email is required.' });
      return;
    }

    if (!phone) {
      response.status(400).json({ error: 'Phone number is required.' });
      return;
    }

    const db = getFirestore();
    const member = await findMemberByEmail(db, email);

    if (!member) {
      response.status(404).json({
        error: 'We could not find a Guild membership record for this email address. Guild membership is required to register. Please contact an administrator for assistance.'
      });
      return;
    }

    const memberPhone = normalizePhone(member.normalizedPhone || member.phone || '');

    if (!memberPhone || memberPhone !== phone) {
      response.status(403).json({
        error: 'We could not verify your information. Please contact an administrator for assistance.'
      });
      return;
    }

    response.status(200).json({ verified: true });
  } catch (error) {
    response.status(500).json({ error: error.message || 'Phone verification failed.' });
  }
}

async function findMemberByEmail(db, email) {
  const normalizedSnapshot = await db
    .collection('members')
    .where('normalizedEmail', '==', email)
    .limit(1)
    .get();

  if (!normalizedSnapshot.empty) {
    const docSnapshot = normalizedSnapshot.docs[0];
    return { id: docSnapshot.id, ...docSnapshot.data() };
  }

  const emailSnapshot = await db.collection('members').where('email', '==', email).limit(1).get();

  if (emailSnapshot.empty) {
    return null;
  }

  const docSnapshot = emailSnapshot.docs[0];
  return { id: docSnapshot.id, ...docSnapshot.data() };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}
