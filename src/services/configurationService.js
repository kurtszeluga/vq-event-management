import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const membershipSettingsRef = () => doc(db, 'appSettings', 'membership');
const membersCollection = () => collection(db, 'members');
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
  addConfigurationAuditLog(batch, {
    actorProfile,
    after: payload,
    entityId: memberRef.id,
    summary: `Saved member "${payload.name || payload.email || payload.phone}"`
  });

  return batch.commit();
}

export async function importMembersFromCsvRows(rows, actorProfile) {
  const members = rows.map((row) => {
    const memberId = makeMemberDocumentId(row) || doc(membersCollection()).id;
    return buildMemberPayload(row, memberId);
  });
  const chunkSize = 400;

  for (let startIndex = 0; startIndex < members.length; startIndex += chunkSize) {
    const batch = writeBatch(db);
    const chunk = members.slice(startIndex, startIndex + chunkSize);

    chunk.forEach((member) => {
      batch.set(doc(db, 'members', member.memberId), member, { merge: true });
    });

    if (startIndex === 0) {
      addConfigurationAuditLog(batch, {
        actorProfile,
        after: { importedCount: members.length },
        entityId: 'members-csv-import',
        summary: `Imported ${members.length} members from CSV`
      });
    }

    await batch.commit();
  }
  return members.length;
}

export async function deleteMember(member, actorProfile) {
  const batch = writeBatch(db);

  batch.delete(doc(db, 'members', member.id));
  addConfigurationAuditLog(batch, {
    action: 'Delete',
    actorProfile,
    before: member,
    entityId: member.id,
    summary: `Deleted member "${member.name || member.email || member.phone}"`
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
  const phone = cleanText(member.phone);

  return {
    email,
    memberId,
    name: cleanText(member.name),
    normalizedEmail: email,
    normalizedPhone: normalizePhone(phone),
    notes: cleanText(member.notes),
    phone,
    status: member.status === 'Inactive' ? 'Inactive' : 'Active',
    updatedDate: serverTimestamp()
  };
}

function makeMemberDocumentId(member) {
  const email = cleanText(member.email).toLowerCase();
  const phone = normalizePhone(cleanText(member.phone));
  const name = cleanText(member.name).toLowerCase();
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
