import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch
} from 'firebase/firestore';
import { auth } from '../lib/firebase.js';
import { db } from '../lib/firebase.js';
import { normalizePermissions } from '../data/userRoles.js';
import { normalizeProfileTags } from '../data/profileTags.js';

const usersCollection = () => collection(db, 'users');
const auditLogsCollection = () => collection(db, 'auditLogs');

export function subscribeToUsers(onNext, onError, { includeAdminProfiles = false } = {}) {
  const usersQuery = includeAdminProfiles
    ? query(usersCollection(), orderBy('name', 'asc'))
    : query(usersCollection(), where('role', '==', 'General User'));

  return onSnapshot(usersQuery, onNext, onError);
}

export async function updateUserProfile(userId, updates, actorProfile) {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  const before = userSnap.exists() ? userSnap.data() : {};
  const batch = writeBatch(db);
  const userPayload = {
    ...before,
    ...updates,
    permissions: normalizePermissions(updates.permissions),
    profileTags: normalizeProfileTags(updates.profileTags)
  };

  batch.update(userRef, {
    ...userPayload,
    updatedDate: serverTimestamp()
  });
  addAuditLog(batch, {
    actorProfile,
    after: userPayload,
    before,
    entityId: userId,
    summary: `Updated user "${userPayload.name || userPayload.email || userId}"`
  });

  return batch.commit();
}

export async function createUserByAdmin(userData) {
  const idToken = await auth.currentUser?.getIdToken();

  if (!idToken) {
    throw new Error('You must be signed in to add users.');
  }

  const response = await fetch('/api/admin-create-user', {
    body: JSON.stringify(userData),
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'User could not be added.');
  }

  return result;
}

export async function updateUserPasswordByAdmin(userId, password) {
  const idToken = await auth.currentUser?.getIdToken();

  if (!idToken) {
    throw new Error('You must be signed in to change user passwords.');
  }

  const response = await fetch('/api/admin-set-user-password', {
    body: JSON.stringify({ password, userId }),
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Password could not be changed.');
  }

  return result;
}

function addAuditLog(batch, { actorProfile, after, before, entityId, summary }) {
  const auditRef = doc(auditLogsCollection());
  const actor = {
    email: actorProfile?.email || '',
    name: actorProfile?.name || actorProfile?.email || 'Unknown Admin',
    role: actorProfile?.role || '',
    userId: actorProfile?.userId || actorProfile?.id || ''
  };

  batch.set(auditRef, {
    action: 'Update',
    actorEmail: actor.email,
    actorName: actor.name,
    actorRole: actor.role,
    actorUserId: actor.userId,
    after,
    before,
    createdDate: serverTimestamp(),
    entityId,
    entityType: 'User',
    summary
  });
}
