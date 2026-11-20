import {
  PROFILE_TAGS,
  SERVICE_ACCOUNT_TAG,
  isServiceAccount,
  normalizeProfileTags
} from '../../shared/profileTags.js';

export { SERVICE_ACCOUNT_TAG, isServiceAccount, normalizeProfileTags };

// The labels and the explanation live here; the keys live in shared/ because
// the server and the Firestore rules need the same list.
export const PROFILE_TAG_OPTIONS = [
  {
    description: 'A standing guild mailbox rather than a person - programs@, '
      + 'workshops@. Its membership and profile stay Active and its dues read '
      + 'Waived, so the annual refresh cannot deactivate it and strip its admin '
      + 'permissions. It is left out of the member directory and the membership '
      + 'counts. Only a Super User can set or clear this.',
    key: SERVICE_ACCOUNT_TAG,
    label: 'Service Account'
  }
];

export function getProfileTagSummary(profileTags = []) {
  const selectedLabels = PROFILE_TAG_OPTIONS
    .filter((tag) => normalizeProfileTags(profileTags).includes(tag.key))
    .map((tag) => tag.label);

  return selectedLabels.length ? selectedLabels.join(', ') : 'None';
}

export { PROFILE_TAGS };
