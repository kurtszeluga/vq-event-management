// The four questions a Membership signup asks beyond the usual contact
// details. Shared by the browser (which renders them) and the Vercel functions
// (which store them), so the two cannot drift into accepting different answers.
//
// Four fixed questions rather than a per-event question builder, deliberately.
// The guild asks these four of everyone who joins or renews and has no second
// form that asks anything else, so a builder would be a configuration surface
// with exactly one configuration - and a column layout in the registration
// sheet that changes under the coordinator every time someone edits it.

export const MEMBERSHIP_PHONE_TYPES = [
  { label: 'Cell Phone (Mobile)', value: 'cell' },
  { label: 'Home Phone', value: 'home' }
];

export const MEMBERSHIP_RENEWAL_TYPES = [
  { label: 'New Member', value: 'new' },
  { label: 'Renewing Membership', value: 'renewing' }
];

export const MEMBERSHIP_VETERAN_ANSWERS = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' }
];

// Long enough for a real answer about a working life, short enough that it
// cannot be used to push an unbounded string into a Firestore document or a
// spreadsheet cell.
export const MEMBERSHIP_SKILLS_MAX_LENGTH = 1500;

function labelFor(options, value) {
  return options.find((option) => option.value === value)?.label || '';
}

export function getMembershipPhoneTypeLabel(value) {
  return labelFor(MEMBERSHIP_PHONE_TYPES, value);
}

export function getMembershipRenewalTypeLabel(value) {
  return labelFor(MEMBERSHIP_RENEWAL_TYPES, value);
}

export function getMembershipVeteranLabel(value) {
  return labelFor(MEMBERSHIP_VETERAN_ANSWERS, value);
}

// Normalizes whatever arrived into the four stored fields. An unrecognised
// value becomes '' rather than being stored as typed: these are dropdown
// answers, and a value outside the list can only come from a tampered request.
export function sanitizeMembershipAnswers(answers = {}) {
  const inList = (options, value) => (
    options.some((option) => option.value === value) ? value : ''
  );

  return {
    membershipPhoneType: inList(MEMBERSHIP_PHONE_TYPES, String(answers.phoneType || '').trim()),
    membershipRenewalType: inList(MEMBERSHIP_RENEWAL_TYPES, String(answers.renewalType || '').trim()),
    membershipSkills: String(answers.skills || '').trim().slice(0, MEMBERSHIP_SKILLS_MAX_LENGTH),
    membershipVeteran: inList(MEMBERSHIP_VETERAN_ANSWERS, String(answers.veteran || '').trim())
  };
}

// Which of the four are required. Skills is optional on the user's
// instruction - plenty of members will not have an answer ready, and a
// required free-text box is how a signup gets abandoned.
export function getMembershipAnswerErrors(answers = {}) {
  const sanitized = sanitizeMembershipAnswers(answers);
  const errors = {};

  if (!sanitized.membershipPhoneType) {
    errors.membershipPhoneType = 'Select the type of phone.';
  }

  if (!sanitized.membershipRenewalType) {
    errors.membershipRenewalType = 'Select whether you are a new or renewing member.';
  }

  if (!sanitized.membershipVeteran) {
    errors.membershipVeteran = 'Select whether you are a veteran.';
  }

  return errors;
}
