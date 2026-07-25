import { useState } from 'react';

// Owns the "update your matched profile before registering" flow: showing
// the editable fields, validating them, and cancelling back to the matched
// profile's original values. Distinct from identity verification (proving
// who the registrant is) and from the registrant form itself (the fields
// being edited), which stay in their own hooks; this one just sequences
// start/cancel/save around them.
export function useProfileEditing({
  applyProfile,
  matchedProfile,
  registrant,
  setFieldErrors,
  setFormError
}) {
  const [needsProfileEdits, setNeedsProfileEdits] = useState(false);

  function handleStartProfileEdit() {
    setNeedsProfileEdits(true);
  }

  function handleCancelProfileEdit() {
    if (matchedProfile) {
      applyProfile(matchedProfile);
    }

    // Cancelling has to clear the validation state too, not just the values.
    // Save populates fieldErrors and formError, and formError renders well above
    // the edit block - so without this, cancelling closed the editor but left
    // "Please fix the highlighted profile fields before saving." on screen with
    // the fields still marked invalid, which reads as the button having done
    // nothing.
    setFieldErrors({});
    setFormError('');
    setNeedsProfileEdits(false);
  }

  function handleSaveProfileEdit() {
    const errors = validateProfileFields(registrant);

    setFieldErrors(errors);

    if (Object.keys(errors).length) {
      setFormError('Please fix the highlighted profile fields before saving.');
      return;
    }

    setFormError('');
    setNeedsProfileEdits(false);
  }

  return {
    handleCancelProfileEdit,
    handleSaveProfileEdit,
    handleStartProfileEdit,
    needsProfileEdits,
    setNeedsProfileEdits
  };
}

function validateProfileFields({
  billingPostalCode,
  billingState,
  firstName,
  lastName,
  phone
}) {
  const errors = {};

  if (!firstName.trim()) {
    errors.firstName = 'First name is required.';
  }

  if (!lastName.trim()) {
    errors.lastName = 'Last name is required.';
  }

  if (phone.replace(/\D/g, '').length < 10) {
    errors.phone = 'Phone number is required.';
  }

  if (billingState && billingState.length !== 2) {
    errors.billingState = 'Use the two-letter state code.';
  }

  if (billingPostalCode && billingPostalCode.trim().length < 5) {
    errors.billingPostalCode = 'ZIP code should be at least 5 characters.';
  }

  return errors;
}
