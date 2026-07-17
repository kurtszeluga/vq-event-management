import {
  collection,
  doc,
  deleteField,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase.js';

const membershipSettingsRef = () => doc(db, 'appSettings', 'membership');
const emailInstructionsRef = () => doc(db, 'appSettings', 'emailInstructions');
const membersCollection = () => collection(db, 'members');
const usersCollection = () => collection(db, 'users');
const eventLocationsCollection = () => collection(db, 'eventLocationDefaults');
const eventTimeOptionsCollection = () => collection(db, 'eventTimeDefaults');
const coordinatorAssignmentsCollection = () => collection(db, 'coordinatorAssignments');
const auditLogsCollection = () => collection(db, 'auditLogs');
const paymentsCollection = () => collection(db, 'payments');

export const COORDINATOR_ASSIGNMENT_AREAS = [
  {
    areaId: 'programs',
    areaLabel: 'Programs',
    coveredTypes: ['Class (Half Day)', 'Class (Full Day)', 'Lecture', 'Retreat'],
    groupLabel: 'Programs',
    sortOrder: 10
  },
  {
    areaId: 'workshops',
    areaLabel: 'Workshops',
    coveredTypes: ['Workshop'],
    groupLabel: 'Other Areas',
    sortOrder: 20
  },
  {
    areaId: 'challenges',
    areaLabel: 'Challenges',
    coveredTypes: ['Challenges'],
    groupLabel: 'Other Areas',
    sortOrder: 30
  },
  {
    areaId: 'business-listings',
    areaLabel: 'Business Listings',
    coveredTypes: ['Business Listing'],
    groupLabel: 'Other Areas',
    sortOrder: 40
  },
  {
    areaId: 'for-sale',
    areaLabel: 'For Sale',
    coveredTypes: ['For Sale'],
    groupLabel: 'Other Areas',
    sortOrder: 50
  },
  {
    areaId: 'membership',
    areaLabel: 'Membership',
    coveredTypes: ['Membership'],
    groupLabel: 'Other Areas',
    sortOrder: 60
  }
];

export const DEFAULT_MEMBERSHIP_SETTINGS = {
  allowAdminSkipMembershipCheck: false,
  matchByEmail: true,
  matchByPhone: false,
  requireMembershipCheck: false,
  termsText: '',
  termsVersion: ''
};

export const EMAIL_INSTRUCTION_AREAS = [
  {
    areaId: 'programs',
    areaLabel: 'Programs',
    helperText: 'Used for Class Half Day, Class Full Day, Lecture, and Retreat registration confirmations.'
  },
  {
    areaId: 'workshops',
    areaLabel: 'Workshops',
    helperText: 'Used for Workshop registration confirmations.'
  },
  {
    areaId: 'challenges',
    areaLabel: 'Challenges',
    helperText: 'Used for Challenge registration confirmations.'
  },
  {
    areaId: 'membership',
    areaLabel: 'Membership',
    helperText: 'Used for membership signup and membership status emails.'
  }
];

export const DEFAULT_EMAIL_INSTRUCTIONS = {
  challenges: '',
  membership: '',
  programs: '',
  sendRegistrationConfirmations: false,
  workshops: ''
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

export function subscribeToEmailInstructions(onNext, onError) {
  return onSnapshot(
    emailInstructionsRef(),
    (snapshot) => {
      onNext(snapshot.exists() ? {
        ...DEFAULT_EMAIL_INSTRUCTIONS,
        ...snapshot.data()
      } : DEFAULT_EMAIL_INSTRUCTIONS);
    },
    onError
  );
}

export function subscribeToMembers(onNext, onError) {
  const membersQuery = query(membersCollection(), orderBy('name', 'asc'));
  return onSnapshot(membersQuery, onNext, onError);
}

export function subscribeToMembershipProfiles(onNext, onError) {
  const profilesQuery = query(usersCollection(), orderBy('name', 'asc'));
  return onSnapshot(
    profilesQuery,
    (snapshot) => {
      onNext({
        docs: snapshot.docs.filter((profileDoc) => profileDoc.data().role !== 'Super User')
      });
    },
    onError
  );
}

export function subscribeToEventLocationDefaults(onNext, onError) {
  const locationsQuery = query(eventLocationsCollection(), orderBy('sortOrder', 'asc'));
  return onSnapshot(locationsQuery, onNext, onError);
}

export function subscribeToEventTimeDefaults(onNext, onError) {
  const timesQuery = query(eventTimeOptionsCollection(), orderBy('sortOrder', 'asc'));
  return onSnapshot(timesQuery, onNext, onError);
}

export function subscribeToCoordinatorAssignments(onNext, onError) {
  const coordinatorQuery = query(coordinatorAssignmentsCollection(), orderBy('sortOrder', 'asc'));
  return onSnapshot(coordinatorQuery, onNext, onError);
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
    matchByEmail: true,
    matchByPhone: false,
    requireMembershipCheck: Boolean(settings.requireMembershipCheck),
    termsText: cleanText(settings.termsText),
    termsVersion: cleanText(settings.termsVersion),
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

export async function saveEmailInstructions(instructions, actorProfile) {
  const batch = writeBatch(db);
  const payload = {
    challenges: cleanText(instructions.challenges),
    membership: cleanText(instructions.membership),
    programs: cleanText(instructions.programs),
    sendRegistrationConfirmations: Boolean(instructions.sendRegistrationConfirmations),
    workshops: cleanText(instructions.workshops),
    updatedDate: serverTimestamp()
  };

  batch.set(emailInstructionsRef(), payload, { merge: true });
  addConfigurationAuditLog(batch, {
    actorProfile,
    after: payload,
    entityId: 'emailInstructions',
    summary: 'Updated email confirmation instructions'
  });

  return batch.commit();
}

export async function sendEmailInstructionsTest({ areaId, instructions, recipientEmail }) {
  const idToken = await auth?.currentUser?.getIdToken();

  if (!idToken) {
    throw new Error('Sign in again before sending a test email.');
  }

  const response = await fetch('/api/admin-update-user-profile', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'sendEmailInstructionsTest',
      areaId,
      instructions,
      recipientEmail
    })
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || 'Unable to send the test email.');
  }

  return result;
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

export async function saveMembershipProfile(profile, actorProfile) {
  const batch = writeBatch(db);
  const profileRef = profile.id ? doc(db, 'users', profile.id) : doc(usersCollection());
  const profileSnap = profile.id ? await getDoc(profileRef) : null;
  const before = profileSnap?.exists() ? { id: profileRef.id, ...profileSnap.data() } : {};
  const payload = buildManualMembershipProfile(profile, before, profileRef.id);

  batch.set(profileRef, payload, { merge: false });
  addConfigurationAuditLog(batch, {
    actorProfile,
    after: payload,
    before,
    entityId: profileRef.id,
    summary: `Saved membership profile "${payload.name || payload.email || payload.phone}"`
  });

  return batch.commit();
}

export async function importMembersFromCsvRows(rows, actorProfile, options = {}) {
  const isAnnualRefresh = options.mode === 'annualRefresh';
  const termsVersion = await getCurrentMembershipTermsVersion();
  const importedProfiles = rows.map((row) => {
    const profileId = makeProfileDocumentId(row) || doc(usersCollection()).id;
    return buildProfileImportPayload(
      {
        ...row,
        status: isAnnualRefresh ? 'Active' : row.status
      },
      profileId
    );
  });
  const userSnapshot = await getDocs(usersCollection());
  const users = userSnapshot.docs.map((userDoc) => ({ id: userDoc.id, ...userDoc.data() }));
  const allProfilesByEmail = new Map();
  const profilesByEmail = new Map();
  const profilesByPhone = new Map();
  const importedProfileIds = new Set();
  const reviewRows = [];
  const skippedSuperUserRows = [];

  users.forEach((profile) => {
    const email = cleanText(profile.email).toLowerCase();
    const phone = normalizePhone(cleanText(profile.phone));

    if (email && !allProfilesByEmail.has(email)) {
      allProfilesByEmail.set(email, profile);
    }

    if (isSuperUserProfile(profile)) {
      importedProfileIds.add(profile.id);
      return;
    }

    if (email && !profilesByEmail.has(email)) {
      profilesByEmail.set(email, profile);
    }

    if (phone) {
      profilesByPhone.set(phone, [...(profilesByPhone.get(phone) || []), profile]);
    }
  });

  const membershipPaymentWrites = [];
  const profileWrites = importedProfiles.flatMap((profile) => {
    const existingAnyProfileByEmail = profile.email ? allProfilesByEmail.get(profile.email) : null;

    if (isSuperUserProfile(existingAnyProfileByEmail)) {
      skippedSuperUserRows.push(profile);
      importedProfileIds.add(existingAnyProfileByEmail.id);
      return [];
    }

    const existingByEmail = profile.email ? profilesByEmail.get(profile.email) : null;
    const phoneMatches = !existingByEmail && profile.normalizedPhone
      ? profilesByPhone.get(profile.normalizedPhone) || []
      : [];

    if (existingByEmail) {
      importedProfileIds.add(existingByEmail.id);
      const value = buildImportedExistingProfile(existingByEmail, profile, 'email', termsVersion);

      if (shouldRecordCsvMembershipPayment(existingByEmail, profile.status, isAnnualRefresh)) {
        membershipPaymentWrites.push(buildCsvMembershipPaymentWrite({
          actorProfile,
          importMode: isAnnualRefresh ? 'Annual Refresh' : 'Add/Update Only',
          profile: value,
          targetProfileId: existingByEmail.id
        }));
      }

      return [{
        ref: doc(db, 'users', existingByEmail.id),
        value
      }];
    }

    if (phoneMatches.length) {
      phoneMatches.forEach((match) => importedProfileIds.add(match.id));
      reviewRows.push({
        csvEmail: profile.email,
        csvName: profile.name,
        csvPhone: profile.phone,
        possibleMatches: phoneMatches.map((match) => ({
          email: match.email || '',
          id: match.id,
          name: match.name || '',
          phone: match.phone || ''
        }))
      });
      return [];
    }

    importedProfileIds.add(profile.profileId);
    const value = buildImportedNewProfile(profile, termsVersion);

    if (profile.status === 'Active') {
      membershipPaymentWrites.push(buildCsvMembershipPaymentWrite({
        actorProfile,
        importMode: isAnnualRefresh ? 'Annual Refresh' : 'Add/Update Only',
        profile: value,
        targetProfileId: profile.profileId
      }));
    }

    return [{
      ref: doc(db, 'users', profile.profileId),
      value
    }];
  });
  const profilesToInactivate = isAnnualRefresh
    ? getProfilesMissingFromImport(users, importedProfileIds)
    : [];
  const chunkSize = 400;
  const writes = [
    ...profileWrites,
    ...membershipPaymentWrites,
    ...profilesToInactivate.map((profile) => ({
      merge: false,
      ref: doc(db, 'users', profile.id),
      value: buildInactivatedMembershipProfile(profile)
    }))
  ];

  for (let startIndex = 0; startIndex < writes.length; startIndex += chunkSize) {
    const batch = writeBatch(db);
    const chunk = writes.slice(startIndex, startIndex + chunkSize);

    chunk.forEach((write) => {
      batch.set(write.ref, write.value, { merge: write.merge !== false });
    });

    if (startIndex === 0) {
      addConfigurationAuditLog(batch, {
        actorProfile,
        after: {
          importMode: isAnnualRefresh ? 'Annual Refresh' : 'Add/Update Only',
          createdCount: profileWrites.filter((write) => !users.some((user) => write.ref.id === user.id)).length,
          importedCount: importedProfiles.length,
          inactivatedCount: profilesToInactivate.length,
          reviewCount: reviewRows.length,
          skippedSuperUserCount: skippedSuperUserRows.length,
          updatedCount: profileWrites.filter((write) => users.some((user) => write.ref.id === user.id)).length
        },
        entityId: 'profiles-csv-import',
        summary: isAnnualRefresh
          ? `Imported ${importedProfiles.length} membership profiles and marked ${profilesToInactivate.length} missing profiles inactive`
          : `Imported ${importedProfiles.length} membership profiles from CSV`
      });
    }

    await batch.commit();
  }

  const updatedCount = profileWrites.filter((write) =>
    users.some((user) => write.ref.id === user.id)
  ).length;
  const createdCount = profileWrites.length - updatedCount;

  return {
    createdCount,
    importedCount: importedProfiles.length,
    inactivatedCount: profilesToInactivate.length,
    reviewCount: reviewRows.length,
    reviewRows,
    skippedSuperUserCount: skippedSuperUserRows.length,
    updatedCount
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

  batch.update(doc(db, 'members', member.id), payload);
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

export async function archiveMembershipProfile(profile, actorProfile) {
  const batch = writeBatch(db);
  const profileRef = doc(db, 'users', profile.id);
  const payload = buildMembershipStatusProfile(profile, 'Archived');

  batch.set(profileRef, payload, { merge: false });
  addConfigurationAuditLog(batch, {
    action: 'Archive',
    actorProfile,
    after: {
      membershipStatus: 'Archived'
    },
    before: profile,
    entityId: profile.id,
    summary: `Archived membership for "${profile.name || profile.email || profile.phone}"`
  });

  return batch.commit();
}

export async function reactivateMember(member, actorProfile) {
  const batch = writeBatch(db);
  const payload = {
    archivedBy: deleteField(),
    archivedDate: deleteField(),
    status: 'Active',
    updatedDate: serverTimestamp()
  };

  batch.update(doc(db, 'members', member.id), payload);
  await addMembershipSyncWrites(batch, [{
    ...member,
    memberId: member.memberId || member.id,
    status: 'Active'
  }]);
  addConfigurationAuditLog(batch, {
    action: 'Reactivate',
    actorProfile,
    after: {
      status: 'Active'
    },
    before: member,
    entityId: member.id,
    summary: `Reactivated member "${member.name || member.email || member.phone}"`
  });

  return batch.commit();
}

export async function reactivateMembershipProfile(profile, actorProfile) {
  const batch = writeBatch(db);
  const profileRef = doc(db, 'users', profile.id);
  const payload = buildMembershipStatusProfile(profile, 'Active');

  batch.set(profileRef, payload, { merge: false });
  addConfigurationAuditLog(batch, {
    action: 'Reactivate',
    actorProfile,
    after: {
      membershipStatus: 'Active'
    },
    before: profile,
    entityId: profile.id,
    summary: `Reactivated membership for "${profile.name || profile.email || profile.phone}"`
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

export async function saveCoordinatorAssignment(assignment, profile, actorProfile) {
  const area = COORDINATOR_ASSIGNMENT_AREAS.find((item) => item.areaId === assignment.areaId);

  if (!area) {
    throw new Error('Choose a valid coordinator area.');
  }

  const batch = writeBatch(db);
  const assignmentRef = doc(db, 'coordinatorAssignments', area.areaId);
  const payload = {
    areaLabel: area.areaLabel,
    assignedUserEmail: cleanText(profile?.email),
    assignedUserId: cleanText(profile?.userId || profile?.id),
    assignedUserName: cleanText(profile?.name || [profile?.firstName, profile?.lastName].filter(Boolean).join(' ')),
    assignedUserPhone: cleanText(profile?.phone),
    contactNameOverride: deleteField(),
    contactEmailOverride: cleanText(assignment.contactEmailOverride),
    contactPhoneOverride: cleanText(assignment.contactPhoneOverride),
    coordinatorAreaId: area.areaId,
    groupLabel: area.groupLabel,
    isActive: assignment.isActive !== false,
    sortOrder: area.sortOrder,
    updatedDate: serverTimestamp()
  };
  const auditPayload = {
    ...payload,
    contactNameOverride: undefined
  };
  delete auditPayload.contactNameOverride;

  batch.set(assignmentRef, payload, { merge: true });
  addConfigurationAuditLog(batch, {
    actorProfile,
    after: auditPayload,
    entityId: assignmentRef.id,
    summary: `Saved coordinator assignment "${area.areaLabel}"`
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

function buildProfileImportPayload(profile, profileId) {
  const email = cleanText(profile.email).toLowerCase();
  const firstName = cleanText(profile.firstName);
  const lastName = cleanText(profile.lastName);
  const name = cleanText(profile.name || [firstName, lastName].filter(Boolean).join(' '));
  const phone = cleanText(profile.phone);

  return {
    email,
    firstName,
    lastName,
    name,
    normalizedPhone: normalizePhone(phone),
    phone,
    profileId,
    status: getValidMemberStatus(profile.status)
  };
}

function buildImportedExistingProfile(existingProfile, importedProfile, matchedBy, termsVersion) {
  const firstName = importedProfile.firstName || existingProfile.firstName || getFirstNameFallback(existingProfile.name);
  const lastName = importedProfile.lastName || existingProfile.lastName || getLastNameFallback(existingProfile.name);
  const name = importedProfile.name || existingProfile.name || [firstName, lastName].filter(Boolean).join(' ');
  const termsAcceptance = buildOfflineTermsAcceptance(existingProfile, termsVersion);
  const membershipStatus = importedProfile.status;
  const role = getMembershipAllowedRole(existingProfile, membershipStatus);

  return {
    billingAddress: existingProfile.billingAddress || getEmptyBillingAddress(),
    createdDate: existingProfile.createdDate || serverTimestamp(),
    email: importedProfile.email || existingProfile.email || '',
    firstName,
    lastName,
    membershipMatchedBy: matchedBy,
    membershipMemberId: '',
    membershipStatus,
    membershipUpdatedDate: serverTimestamp(),
    name,
    permissions: getMembershipAllowedPermissions(existingProfile, membershipStatus),
    phone: importedProfile.phone || existingProfile.phone || '',
    profileTags: Array.isArray(existingProfile.profileTags) ? existingProfile.profileTags : [],
    role,
    status: existingProfile.role === 'Super User' ? 'Active' : existingProfile.status || 'Active',
    ...termsAcceptance,
    updatedDate: serverTimestamp(),
    userId: existingProfile.userId || existingProfile.id
  };
}

function buildImportedNewProfile(importedProfile, termsVersion) {
  return {
    billingAddress: getEmptyBillingAddress(),
    createdDate: serverTimestamp(),
    email: importedProfile.email,
    firstName: importedProfile.firstName,
    lastName: importedProfile.lastName,
    membershipMatchedBy: 'csv',
    membershipMemberId: '',
    membershipStatus: importedProfile.status,
    membershipUpdatedDate: serverTimestamp(),
    name: importedProfile.name,
    permissions: normalizeUserPermissions(),
    phone: importedProfile.phone,
    profileTags: [],
    role: 'General User',
    status: 'Active',
    termsAccepted: true,
    termsAcceptedDate: serverTimestamp(),
    termsVersion,
    updatedDate: serverTimestamp(),
    userId: importedProfile.profileId
  };
}

function shouldRecordCsvMembershipPayment(existingProfile, importedMembershipStatus, isAnnualRefresh) {
  return importedMembershipStatus === 'Active'
    && (isAnnualRefresh || existingProfile.membershipStatus !== 'Active');
}

function buildCsvMembershipPaymentWrite({ actorProfile, importMode, profile, targetProfileId }) {
  const ref = doc(paymentsCollection());

  return {
    ref,
    value: buildCsvMembershipPaymentRecord({
      actorProfile,
      importMode,
      paymentId: ref.id,
      profile,
      targetProfileId
    })
  };
}

function buildCsvMembershipPaymentRecord({
  actorProfile,
  importMode,
  paymentId,
  profile,
  targetProfileId
}) {
  return {
    amount: 0,
    amountDue: 0,
    createdBy: actorProfile?.userId || actorProfile?.id || '',
    createdByEmail: actorProfile?.email || '',
    createdByName: actorProfile?.name || actorProfile?.email || 'Unknown Admin',
    createdDate: serverTimestamp(),
    entityId: targetProfileId,
    entityType: 'Membership',
    eventId: '',
    method: '',
    note: `Membership marked paid from CSV import (${importMode}). Amount and method were not included in the CSV.`,
    paymentId,
    processor: 'Manual',
    registrationId: '',
    registrationStatus: '',
    squareTransactionId: '',
    status: 'Paid',
    updatedMembershipSnapshot: {
      membershipStatus: profile.membershipStatus || 'Active',
      profileStatus: profile.status || 'Active',
      userId: profile.userId || targetProfileId
    },
    updatedRegistrationSnapshot: {}
  };
}

function buildOfflineTermsAcceptance(existingProfile, termsVersion) {
  if (existingProfile.termsAccepted) {
    return {
      termsAccepted: true,
      termsAcceptedDate: existingProfile.termsAcceptedDate || serverTimestamp(),
      termsVersion: existingProfile.termsVersion || termsVersion
    };
  }

  return {
    termsAccepted: true,
    termsAcceptedDate: serverTimestamp(),
    termsVersion
  };
}

async function getCurrentMembershipTermsVersion() {
  const snapshot = await getDoc(membershipSettingsRef());
  const settings = snapshot.exists() ? snapshot.data() : {};

  return cleanText(settings.termsVersion) || 'Offline Membership Agreement';
}

function buildManualMembershipProfile(profile, existingProfile, profileId) {
  const firstName = cleanText(profile.firstName || existingProfile.firstName || getFirstNameFallback(existingProfile.name));
  const lastName = cleanText(profile.lastName || existingProfile.lastName || getLastNameFallback(existingProfile.name));
  const name = cleanText(profile.name || existingProfile.name || [firstName, lastName].filter(Boolean).join(' '));
  const membershipStatus = getValidProfileMembershipStatus(profile.status || profile.membershipStatus);
  const role = getMembershipAllowedRole(existingProfile, membershipStatus);

  return {
    billingAddress: existingProfile.billingAddress || getEmptyBillingAddress(),
    createdDate: existingProfile.createdDate || serverTimestamp(),
    email: cleanText(profile.email || existingProfile.email).toLowerCase(),
    firstName,
    lastName,
    membershipMatchedBy: 'manual',
    membershipMemberId: existingProfile.membershipMemberId || '',
    membershipStatus,
    membershipUpdatedDate: serverTimestamp(),
    name,
    permissions: getMembershipAllowedPermissions(existingProfile, membershipStatus),
    phone: cleanText(profile.phone || existingProfile.phone),
    profileTags: Array.isArray(existingProfile.profileTags) ? existingProfile.profileTags : [],
    role,
    status: existingProfile.status || 'Active',
    ...preserveTermsAcceptance(existingProfile),
    updatedDate: serverTimestamp(),
    userId: existingProfile.userId || profileId
  };
}

function buildMembershipStatusProfile(profile, membershipStatus) {
  const firstName = profile.firstName || getFirstNameFallback(profile.name);
  const lastName = profile.lastName || getLastNameFallback(profile.name);
  const name = profile.name || [firstName, lastName].filter(Boolean).join(' ');
  const role = getMembershipAllowedRole(profile, membershipStatus);

  return {
    billingAddress: profile.billingAddress || getEmptyBillingAddress(),
    createdDate: profile.createdDate || serverTimestamp(),
    email: profile.email || '',
    firstName,
    lastName,
    membershipMatchedBy: profile.membershipMatchedBy || 'manual',
    membershipMemberId: profile.membershipMemberId || '',
    membershipStatus,
    membershipUpdatedDate: serverTimestamp(),
    name,
    permissions: getMembershipAllowedPermissions(profile, membershipStatus),
    phone: profile.phone || '',
    profileTags: Array.isArray(profile.profileTags) ? profile.profileTags : [],
    role,
    status: profile.status || 'Active',
    ...preserveTermsAcceptance(profile),
    updatedDate: serverTimestamp(),
    userId: profile.userId || profile.id
  };
}

function buildInactivatedMembershipProfile(profile) {
  const firstName = profile.firstName || getFirstNameFallback(profile.name);
  const lastName = profile.lastName || getLastNameFallback(profile.name);
  const name = profile.name || [firstName, lastName].filter(Boolean).join(' ');
  const membershipStatus = 'Inactive';
  const role = getMembershipAllowedRole(profile, membershipStatus);

  return {
    billingAddress: profile.billingAddress || getEmptyBillingAddress(),
    createdDate: profile.createdDate || serverTimestamp(),
    email: profile.email || '',
    firstName,
    lastName,
    membershipMatchedBy: profile.membershipMatchedBy || '',
    membershipMemberId: profile.membershipMemberId || '',
    membershipStatus,
    membershipUpdatedDate: serverTimestamp(),
    name,
    permissions: getMembershipAllowedPermissions(profile, membershipStatus),
    phone: profile.phone || '',
    profileTags: Array.isArray(profile.profileTags) ? profile.profileTags : [],
    role,
    status: profile.status || 'Active',
    ...preserveTermsAcceptance(profile),
    updatedDate: serverTimestamp(),
    userId: profile.userId || profile.id
  };
}

function preserveTermsAcceptance(profile) {
  if (!profile.termsAccepted) {
    return {};
  }

  return {
    termsAccepted: true,
    termsAcceptedDate: profile.termsAcceptedDate || serverTimestamp(),
    termsVersion: profile.termsVersion || 'Offline Membership Agreement'
  };
}

function getProfilesMissingFromImport(users, importedProfileIds) {
  return users.filter((profile) =>
    profile.role !== 'Super User'
      && profile.status !== 'Archived'
      && profile.membershipStatus !== 'Archived'
      && !importedProfileIds.has(profile.id)
  );
}

function isSuperUserProfile(profile) {
  return profile?.role === 'Super User';
}

function getEmptyBillingAddress() {
  return {
    city: '',
    country: 'United States',
    postalCode: '',
    state: '',
    street: ''
  };
}

function normalizeUserPermissions(permissions = {}) {
  return {
    addUsers: Boolean(permissions.addUsers),
    manageEvents: Boolean(permissions.manageEvents),
    manageMembershipStatus: Boolean(permissions.manageMembershipStatus),
    managePayments: Boolean(permissions.managePayments),
    viewRegistrations: Boolean(permissions.viewRegistrations)
  };
}

function getMembershipAllowedRole(profile, membershipStatus) {
  if (profile.role === 'Super User') {
    return 'Super User';
  }

  if (membershipStatus === 'Active' && (profile.status || 'Active') === 'Active') {
    return profile.role || 'General User';
  }

  return 'General User';
}

function getMembershipAllowedPermissions(profile, membershipStatus) {
  return getMembershipAllowedRole(profile, membershipStatus) === 'Admin'
    ? normalizeUserPermissions(profile.permissions)
    : normalizeUserPermissions();
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

function getValidProfileMembershipStatus(status) {
  if (status === 'Pending' || status === 'Active' || status === 'Inactive' || status === 'Archived' || status === 'Unknown') {
    return status;
  }

  return 'Unknown';
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

function makeProfileDocumentId(profile) {
  const email = cleanText(profile.email).toLowerCase();
  const name = cleanText(
    profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(' ')
  ).toLowerCase();
  const source = email || name;

  if (!source) {
    return '';
  }

  return source
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function getFirstNameFallback(name = '') {
  return cleanText(name).split(/\s+/)[0] || '';
}

function getLastNameFallback(name = '') {
  const parts = cleanText(name).split(/\s+/).filter(Boolean);

  return parts.length > 1 ? parts.slice(1).join(' ') : '';
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
