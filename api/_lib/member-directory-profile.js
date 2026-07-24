export function isEligibleForMemberDirectory(profile = {}) {
  return profile.status === 'Active'
    && profile.membershipStatus === 'Active'
    && profile.role !== 'Super User';
}

export function buildMemberDirectoryProfile(userId, profile = {}, updatedDate) {
  const firstName = asText(profile.firstName);
  const lastName = asText(profile.lastName);
  const name = asText(profile.name) || [firstName, lastName].filter(Boolean).join(' ');
  const email = asText(profile.email);
  const phone = asText(profile.phone);

  return {
    billingAddress: copyBillingAddress(profile.billingAddress),
    email,
    firstName,
    lastName,
    name,
    phone,
    sortKey: buildDirectorySortKey(lastName, firstName, name, email),
    updatedDate,
    userId
  };
}

export function applyMemberDirectorySync(db, writer, userId, profile, updatedDate) {
  const directoryRef = db.collection('memberDirectoryProfiles').doc(userId);

  if (isEligibleForMemberDirectory(profile)) {
    writer.set(directoryRef, buildMemberDirectoryProfile(userId, profile, updatedDate));
    return;
  }

  writer.delete(directoryRef);
}

function buildDirectorySortKey(lastName, firstName, name, email) {
  return [lastName, firstName, name, email]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function copyBillingAddress(billingAddress) {
  return {
    city: asText(billingAddress?.city),
    country: asText(billingAddress?.country) || 'United States',
    postalCode: asText(billingAddress?.postalCode),
    state: asText(billingAddress?.state),
    street: asText(billingAddress?.street)
  };
}

function asText(value) {
  return value == null ? '' : String(value);
}
