import {
  collection,
  doc,
  deleteField,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
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
  const normalizedPermissions = normalizePermissions(updates.permissions);
  const normalizedProfileTags = normalizeProfileTags(updates.profileTags);
  const userPayload = removeUndefinedFields({
    archivedBy: before.archivedBy,
    archivedDate: before.archivedDate,
    billingAddress: updates.billingAddress,
    createdDate: before.createdDate || serverTimestamp(),
    email: updates.email,
    firstName: updates.firstName,
    lastName: updates.lastName,
    membershipMatchedBy: before.membershipMatchedBy,
    membershipMemberId: before.membershipMemberId,
    membershipStatus: updates.membershipStatus ?? before.membershipStatus,
    membershipUpdatedDate: before.membershipUpdatedDate,
    name: updates.name,
    phone: updates.phone,
    permissions: normalizedPermissions,
    profileTags: normalizedProfileTags,
    role: updates.role,
    status: updates.status,
    userId: updates.userId || before.userId || userId
  });

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

export async function archiveUserProfile(userId, actorProfile) {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  const before = userSnap.exists() ? userSnap.data() : {};
  const archivedBy = actorProfile?.name || actorProfile?.email || 'Unknown Admin';
  const batch = writeBatch(db);
  const after = {
    archivedBy,
    archivedDate: serverTimestamp(),
    status: 'Inactive',
    updatedDate: serverTimestamp()
  };

  batch.update(userRef, after);
  addAuditLog(batch, {
    actorProfile,
    after,
    before,
    entityId: userId,
    summary: `Archived user "${before.name || before.email || userId}"`
  });

  return batch.commit();
}

export async function reactivateUserProfile(userId, actorProfile) {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  const before = userSnap.exists() ? userSnap.data() : {};
  const batch = writeBatch(db);
  const after = {
    archivedBy: deleteField(),
    archivedDate: deleteField(),
    status: 'Active',
    updatedDate: serverTimestamp()
  };

  batch.update(userRef, after);
  addAuditLog(batch, {
    action: 'Reactivate',
    actorProfile,
    after: {
      status: 'Active'
    },
    before,
    entityId: userId,
    summary: `Reactivated user "${before.name || before.email || userId}"`
  });

  return batch.commit();
}

export async function createUserByAdmin(userData) {
  const idToken = await getAdminIdToken();

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
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'User could not be added.');
  }

  return result;
}

export async function updateUserPasswordByAdmin(userId, password) {
  const idToken = await getAdminIdToken();

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
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Password could not be changed.');
  }

  return result;
}

async function parseJsonResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const bodyText = await response.text();

  if (contentType.includes('application/json')) {
    try {
      return bodyText ? JSON.parse(bodyText) : {};
    } catch {
      return { error: bodyText || 'Unexpected server response.' };
    }
  }

  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    return { error: bodyText };
  }
}

async function getAdminIdToken() {
  if (!auth) {
    return '';
  }

  const currentUser = auth.currentUser || (await waitForCurrentUser());

  if (!currentUser) {
    return '';
  }

  return currentUser.getIdToken();
}

function waitForCurrentUser() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        unsubscribe();
        resolve(firebaseUser);
      },
      () => {
        unsubscribe();
        resolve(null);
      }
    );
  });
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

function removeUndefinedFields(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}
