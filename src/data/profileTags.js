export const PROFILE_TAG_OPTIONS = [
  {
    key: 'vqBooking',
    label: 'VQ Booking'
  },
  {
    key: 'vqHosting',
    label: 'VQ Hosting'
  }
];

export function normalizeProfileTags(profileTags = []) {
  const allowedTags = PROFILE_TAG_OPTIONS.map((tag) => tag.key);

  return Array.isArray(profileTags)
    ? profileTags.filter((tag) => allowedTags.includes(tag))
    : [];
}

export function getProfileTagSummary(profileTags = []) {
  const selectedLabels = PROFILE_TAG_OPTIONS
    .filter((tag) => profileTags.includes(tag.key))
    .map((tag) => tag.label);

  return selectedLabels.length ? selectedLabels.join(', ') : 'None';
}
