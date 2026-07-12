import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const membershipSettingsRef = () => doc(db, 'appSettings', 'membership');
const membersCollection = () => collection(db, 'members');
const usersCollection = () => collection(db, 'users');
const eventLocationsCollection = () => collection(db, 'eventLocationDefaults');
const eventTimeOptionsCollection = () => collection(db, 'eventTimeDefaults');
const auditLogsCollection = () => collection(db, 'auditLogs');

export const DEFAULT_MEMBERSHIP_SETTINGS = {
  allowAdminSkipMembershipCheck: false,
  matchByEmail: true,
  matchByPhone: true,
  requireMembershipCheck: false
};

export function subscribeToMembershipSettings(onNext, onError) {
  return onSnapshot(
    membershipSettingsRef(),
    (snapshot) => {
      onNext(snapshot.exists() ? {
        ...DEFAULT_MEMBERSHIP_SETTINGS,
        ...snapshot.data()
      } : DEFAULT_MEMBERSHIP_SETTINGS);
    },
    onError
  );
}

export function subscribeToMembers(onNext, onError) {
  const membersQuery = query(membersCollection(), orderBy('name', 'asc'));
  return onSnapshot(membersQuery, onNext, onError);
}

export function subscribeToEventLocationDefaults(onNext, onError) {
  const locationsQuery = query(eventLocationsCollection(), orderBy('sortOrder', 'asc'));
  return onSnapshot(locationsQuery, onNext, onError);
}

export function subscribeToEventTimeDefaults(onNext, onError) {
  const timesQuery = query(eventTimeOptionsCollection(), orderBy('sortOrder', 'asc'));
  return onSnapshot(timesQuery, onNext, onError);
}

export function subscribeToActiveEventLocationDefaults(onNext, onError) {
  return subscribeToEventLocationDefaults(
    (snapshot) => {
      onNext(snapshot.docs
        .map((locationDoc) => ({ id: locationDoc.id, ...locationDoc.data() }))
        .filter((location) => location.isActive !== false));
    },
    onError
  );
}

export function subscribeToActiveEventTimeDefaults(onNext, onError) {
  return subscribeToEventTimeDefaults(
    (snapshot) => {
      onNext(snapshot.docs
        .map((timeDoc) => ({ id: timeDoc.id, ...timeDoc.data() }))
        .filter((timeOption) => timeOption.isActive !== false));
    },
    onError
  );
}

export async function saveMembershipSettings(settings, actorProfile) {
  const batch = writeBatch(db);
  const payload = {
    allowAdminSkipMembershipCheck: Boolean(settings.allowAdminSkipMembershipCheck),
    matchByEmail: Boolean(settings.matchByEmail),
    matchByPhone: Boolean(settings.matchByPhone),
    requireMembershipCheck: Boolean(settings.requireMembershipCheck),
    updatedDate: serverTimestamp()
  };

  batch.set(membershipSettingsRef(), payload, { merge: true });
  addConfigurationAuditLog(batch, {
    actorProfile,
    after: payload,
    entityId: 'membership',
    summary: 'Updated membership check settings'
  });

  return batch.commit();
}

export async function saveMember(member, actorProfile) {
  const batch = writeBatch(db);
  const memberRef = member.id ? doc(db, 'members', member.id) : doc(membersCollection());
  const payload = buildMemberPayload(member, memberRef.id);

  batch.set(memberRef, payload, { merge: true });
  await addMembershipSyncWrites(batch, [payload]);
  addConfigurationAuditLog(batch, {
    actorProfile,
    after: payload,
    entityId: memberRef.id,
    summary: `Saved member "${payload.name || payload.email || payload.phone}"`
  });

  return batch.commit();
}

export async function importMembersFromCsvRows(rows, actorProfile, options = {}) {
  const isAnnualRefresh = options.mode === 'annualRefresh';
  const members = rows.map((row) => {
    const memberId = makeMemberDocumentId(row) || doc(membersCollection()).id;
    return buildMemberPayload(
      {
        ...row,
        status: isAnnualRefresh ? 'Active' : row.status
      },
      memberId
    );
  });
  const importedMemberIds = new Set(members.map((member) => member.memberId));
  const membersToInactivate = isAnnualRefresh
    ? await getMembersMissingFromImport(importedMemberIds)
    : [];
  const membershipSyncMembers = [
    ...members,
    ...membersToInactivate.map((member) => ({
      ...member,
      memberId: member.memberId || member.id,
      status: 'Inactive'
    }))
  ];
  const membershipSyncWrites = await getMembershipSyncWrites(membershipSyncMembers);
  const chunkSize = 400;
  const writes = [
    ...members.map((member) => ({
      ref: doc(db, 'members', member.memberId),
      type: 'set',
      value: member
    })),
    ...membersToInactivate.map((member) => ({
      ref: doc(db, 'members', member.id),
      type: 'set',
      value: {
        status: 'Inactive',
        updatedDate: serverTimestamp()
      }
    })),
    ...membershipSyncWrites
  ];

  for (let startIndex = 0; startIndex < writes.length; startIndex += chunkSize) {
    const batch = writeBatch(db);
    const chunk = writes.slice(startIndex, startIndex + chunkSize);

    chunk.forEach((write) => {
      batch.set(write.ref, write.value, { merge: true });
    });

    if (startIndex === 0) {
      addConfigurationAuditLog(batch, {
        actorProfile,
        after: {
          importMode: isAnnualRefresh ? 'Annual Refresh' : 'Add/Update Only',
          importedCount: members.length,
          inactivatedCount: membersToInactivate.length
        },
        entityId: 'members-csv-import',
        summary: isAnnualRefresh
          ? `Imported ${members.length} members and marked ${membersToInactivate.length} missing members inactive`
          : `Imported ${members.length} members from CSV`
      });
    }

    await batch.commit();
  }
  return {
    importedCount: members.length,
    inactivatedCount: membersToInactivate.length
  };
}

export async function archiveMember(member, actorProfile) {
  const batch = writeBatch(db);
  const archivedBy = actorProfile?.name || actorProfile?.email || 'Unknown Admin';
  const payload = {
    archivedBy,
    archivedDate: serverTimestamp(),
    status: 'Archived',
    updatedDate: serverTimestamp()
  };

  batch.set(doc(db, 'members', member.id), payload, { merge: true });
  await addMembershipSyncWrites(batch, [{
    ...member,
    memberId: member.memberId || member.id,
    status: 'Archived'
  }]);
  addConfigurationAuditLog(batch, {
    action: 'Archive',
    actorProfile,
    after: payload,
    before: member,
    entityId: member.id,
    summary: `Archived member "${member.name || member.email || member.phone}"`
  });

  return batch.commit();
}

export async function saveEventLocationDefault(location, actorProfile) {
  const batch = writeBatch(db);
  const locationRef = location.id
    ? doc(db, 'eventLocationDefaults', location.id)
    : doc(eventLocationsCollection());
  const payload = {
    address: cleanText(location.address),
    eventLocationId: locationRef.id,
    isActive: location.isActive !== false,
    label: cleanText(location.label),
    sortOrder: Number(location.sortOrder || 0),
    updatedDate: serverTimestamp(),
    value: makeOptionValue(location.value || location.label || locationRef.id)
  };

  batch.set(locationRef, payload, { merge: true });
  addConfigurationAuditLog(batch, {
    actorProfile,
    after: payload,
    entityId: locationRef.id,
    summary: `Saved event location "${payload.label}"`
  });

  return batch.commit();
}

export async function saveEventTimeDefault(timeOption, actorProfile) {
  const batch = writeBatch(db);
  const timeRef = timeOption.id
    ? doc(db, 'eventTimeDefaults', timeOption.id)
    : doc(eventTimeOptionsCollection());
  const payload = {
    endTime: cleanText(timeOption.endTime),
    eventTimeId: timeRef.id,
    isActive: timeOption.isActive !== false,
    label: cleanText(timeOption.label),
    sortOrder: Number(timeOption.sortOrder || 0),
    startTime: cleanText(timeOption.startTime),
    updatedDate: serverTimestamp(),
    value: makeOptionValue(timeOption.value || timeOption.label || timeRef.id)
  };

  batch.set(timeRef, payload, { merge: true });
  addConfigurationAuditLog(batch, {
    actorProfile,
    after: payload,
    entityId: timeRef.id,
    summary: `Saved event time "${payload.label}"`
  });

  return batch.commit();
}

export async function deleteEventLocationDefault(location, actorProfile) {
  const batch = writeBatch(db);

  batch.delete(doc(db, 'eventLocationDefaults', location.id));
  addConfigurationAuditLog(batch, {
    action: 'Delete',
    actorProfile,
    before: location,
    entityId: location.id,
    summary: `Deleted event location "${location.label}"`
  });

  return batch.commit();
}

export async function deleteEventTimeDefault(timeOption, actorProfile) {
  const batch = writeBatch(db);

  batch.delete(doc(db, 'eventTimeDefaults', timeOption.id));
  addConfigurationAuditLog(batch, {
    action: 'Delete',
    actorProfile,
    before: timeOption,
    entityId: timeOption.id,
    summary: `Deleted event time "${timeOption.label}"`
  });

  return batch.commit();
}

function buildMemberPayload(member, memberId) {
  const email = cleanText(member.email).toLowerCase();
  const firstName = cleanText(member.firstName);
  const lastName = cleanText(member.lastName);
  const name = cleanText(member.name || [firstName, lastName].filter(Boolean).join(' '));
  const phone = cleanText(member.phone);

  return {
    email,
    firstName,
    lastName,
    memberId,
    name,
    normalizedEmail: email,
    normalizedPhone: normalizePhone(phone),
    notes: cleanText(member.notes),
    phone,
    status: getValidMemberStatus(member.status),
    updatedDate: serverTimestamp()
  };
}

async function getMembersMissingFromImport(importedMemberIds) {
  const snapshot = await getDocs(membersCollection());

  return snapshot.docs
    .map((memberDoc) => ({ id: memberDoc.id, ...memberDoc.data() }))
    .filter((member) => member.status !== 'Archived')
    .filter((member) => !importedMemberIds.has(member.memberId || member.id));
}

async function addMembershipSyncWrites(batch, members) {
  const writes = await getMembershipSyncWrites(members);

  writes.forEach((write) => {
    batch.set(write.ref, write.value, { merge: true });
  });
}

async function getMembershipSyncWrites(members) {
  const snapshot = await getDocs(usersCollection());
  const syncByUserId = new Map();

  members.forEach((member) => {
    const memberEmail = cleanText(member.normalizedEmail || member.email).toLowerCase();
    const memberPhone = normalizePhone(cleanText(member.normalizedPhone || member.phone));

    if (!memberEmail && !memberPhone) {
      return;
    }

    snapshot.docs.forEach((userDoc) => {
      const user = userDoc.data();
      const userEmail = cleanText(user.email).toLowerCase();
      const userPhone = normalizePhone(cleanText(user.phone));
      const matchedBy = memberEmail && userEmail && memberEmail === userEmail
        ? 'email'
        : memberPhone && userPhone && memberPhone === userPhone
          ? 'phone'
          : '';

      if (!matchedBy) {
        return;
      }

      const nextStatus = getValidMemberStatus(member.status);
      const existingSync = syncByUserId.get(userDoc.id);

      if (
        existingSync
        && getMembershipStatusPriority(existingSync.value.membershipStatus)
          > getMembershipStatusPriority(nextStatus)
      ) {
        return;
      }

      syncByUserId.set(userDoc.id, {
        ref: doc(db, 'users', userDoc.id),
        type: 'set',
        value: {
          membershipMatchedBy: matchedBy,
          membershipMemberId: member.memberId || member.id || '',
          membershipStatus: nextStatus,
          membershipUpdatedDate: serverTimestamp()
        }
      });
    });
  });

  return [...syncByUserId.values()];
}

function getValidMemberStatus(status) {
  if (status === 'Inactive' || status === 'Archived') {
    return status;
  }

  return 'Active';
}

function getMembershipStatusPriority(status) {
  if (status === 'Active') {
    return 3;
  }

  if (status === 'Archived') {
    return 2;
  }

  return 1;
}

function makeMemberDocumentId(member) {
  const email = cleanText(member.email).toLowerCase();
  const phone = normalizePhone(cleanText(member.phone));
  const name = cleanText(
    member.name || [member.firstName, member.lastName].filter(Boolean).join(' ')
  ).toLowerCase();
  const source = email || phone || name;

  if (!source) {
    return '';
  }

  return source
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function addConfigurationAuditLog(
  batch,
  { action = 'Update', actorProfile, after = {}, before = {}, entityId, summary }
) {
  const actor = {
    email: actorProfile?.email || '',
    name: actorProfile?.name || actorProfile?.email || 'Unknown Admin',
    role: actorProfile?.role || '',
    userId: actorProfile?.userId || actorProfile?.id || ''
  };

  batch.set(doc(auditLogsCollection()), {
    action,
    actorEmail: actor.email,
    actorName: actor.name,
    actorRole: actor.role,
    actorUserId: actor.userId,
    after,
    before,
    createdDate: serverTimestamp(),
    entityId,
    entityType: 'Configuration',
    summary
  });
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function makeOptionValue(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'option';
}

function normalizePhone(phone) {
  return phone.replace(/\D/g, '');
}
