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
import { applyMemberDirectorySync, syncMemberDirectoryProfile } from './memberDirectoryProfile.js';
import { DEFAULT_USER_PERMISSIONS } from '../data/userRoles.js';

const usersCollection = () => collection(db, 'users');
const auditLogsCollection = () => collection(db, 'auditLogs');

export function subscribeToUsers(onNext, onError, { includeAdminProfiles = false } = {}) {
  const usersQuery = includeAdminProfiles
    ? query(usersCollection(), orderBy('name', 'asc'))
    : query(usersCollection(), where('role', '==', 'General User'));

  return onSnapshot(usersQuery, onNext, onError);
}

export async function updateUserProfile(userId, updates) {
  const idToken = await getAdminIdToken();

  if (!idToken) {
    throw new Error('You must be signed in to update users.');
  }

  const response = await fetch('/api/admin-update-user-profile', {
    body: JSON.stringify({
      ...updates,
      profileId: userId
    }),
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'User profile could not be saved.');
  }

  return result;
}

// Sign-in history for the admin user list, read live from Firebase Auth rather
// than from a mirrored field - see api/admin-user-auth-status.js for why there
// is no stored copy. Returns {} rather than throwing: the list is perfectly
// usable without it, and a failed lookup should not blank the page.
export async function loadUserAuthStatus(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];

  if (!ids.length) {
    return {};
  }

  const idToken = await getAdminIdToken();

  if (!idToken) {
    return {};
  }

  try {
    const response = await fetch('/api/admin-user-auth-status', {
      body: JSON.stringify({ userIds: ids }),
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      method: 'POST'
    });

    if (!response.ok) {
      return {};
    }

    const result = await parseJsonResponse(response);

    return result.accounts || {};
  } catch {
    return {};
  }
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
    updatedDate: serverTimestamp(),
    // An archived account keeps no admin authority. Demoting here is what makes
    // the write legal at all: the closing clause of validUserAdminUpdate() only
    // accepts role Admin alongside status Active, so archiving one while it
    // stayed Admin was refused outright as "Missing or insufficient
    // permissions" - the Archive button simply did nothing on an admin row.
    // A Super User is left alone; the rule accepts that role unconditionally,
    // and demoting the account able to promote people would be a trap.
    ...(before.role === 'Admin'
      ? { permissions: DEFAULT_USER_PERMISSIONS, role: 'General User' }
      : {})
  };

  batch.update(userRef, after);
  applyMemberDirectorySync(batch, userId, {
    ...before,
    status: 'Inactive'
  });
  addAuditLog(batch, {
    actorProfile,
    after,
    before,
    entityId: userId,
    summary: before.role === 'Admin'
      ? `Archived user "${before.name || before.email || userId}" and demoted it from Admin to General User`
      : `Archived user "${before.name || before.email || userId}"`
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

  await batch.commit();
  // The directory rule's eligibility check reads users/{id} with get(),
  // which only sees pre-commit state - this write can make the profile
  // newly eligible, so the directory sync has to happen after it lands.
  return syncMemberDirectoryProfile(userId, { ...before, status: 'Active' });
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

  const response = await fetch('/api/admin-update-user-profile', {
    body: JSON.stringify({ action: 'setPassword', password, userId }),
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
