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

export function getProfileFirstName(profile = {}) {
  return profile.firstName || splitDisplayName(profile.name).firstName;
}

export function getProfileLastName(profile = {}) {
  return profile.lastName || splitDisplayName(profile.name).lastName;
}

export function buildDisplayName(firstName = '', lastName = '') {
  return [toTitleCase(firstName), toTitleCase(lastName)].filter(Boolean).join(' ');
}

export function toTitleCase(value) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}
