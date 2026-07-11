import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { normalizePermissions } from '../data/userRoles.js';

const usersCollection = () => collection(db, 'users');
const auditLogsCollection = () => collection(db, 'auditLogs');

export function subscribeToUsers(onNext, onError) {
  const usersQuery = query(usersCollection(), orderBy('name', 'asc'));
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
    permissions: normalizePermissions(updates.permissions)
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
