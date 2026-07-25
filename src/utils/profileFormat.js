export function formatPhoneNumber(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10);

  if (digits.length <= 3) {
    return digits;
  }

  if (digits.length <= 6) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function buildBillingAddress({
  city,
  country,
  postalCode,
  state,
  street
}) {
  return {
    city: toTitleCase(city),
    country: toTitleCase(country) || 'United States',
    postalCode: postalCode.trim(),
    state: state.trim().toUpperCase(),
    street: toTitleCase(street)
  };
}

export function splitDisplayName(name = '') {
  // A null name is safe here without its own guard: toTitleCase coerces.
  const parts = toTitleCase(name).split(' ').filter(Boolean);

  if (!parts.length) {
    return { firstName: '', lastName: '' };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts.at(-1)
  };
}

// These take `profile` rather than defaulting it, because a default parameter
// only fills in for `undefined` - passing an explicit `null` skips it. Callers
// legitimately hold a null profile: `userProfile` starts as null in AuthContext
// and stays null until Firestore answers, so ProfilePage's mount effect used to
// throw here and take the whole page down before its own auth guard could
// redirect. Optional chaining covers both null and undefined.
export function getProfileFirstName(profile) {
  return profile?.firstName || splitDisplayName(profile?.name).firstName;
}

export function getProfileLastName(profile) {
  return profile?.lastName || splitDisplayName(profile?.name).lastName;
}

export function buildDisplayName(firstName = '', lastName = '') {
  return [toTitleCase(firstName), toTitleCase(lastName)].filter(Boolean).join(' ');
}

export function toTitleCase(value) {
  // Coerced rather than assumed to be a string. 69 call sites pass Firestore
  // field values, which can be absent; previously a null threw on .trim().
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}
