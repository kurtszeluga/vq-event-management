import { useMemo, useRef, useState } from 'react';
import ModalDialog from '../ModalDialog.jsx';
import { US_STATES } from '../../data/usStates.js';
import { useRegistrantForm } from '../../hooks/useRegistrantForm.js';
import { createAdminRegistration } from '../../services/registrationService.js';
import { formatCurrency } from '../../utils/eventFormat.js';
import {
  buildBillingAddress,
  buildDisplayName,
  formatPhoneNumber,
  getProfileFirstName,
  getProfileLastName,
  toTitleCase
} from '../../utils/profileFormat.js';
import {
  canPayLaterByCashCheck,
  getEventPaymentTotal,
  isPaidEvent as getIsPaidEvent
} from '../../utils/registrationEligibility.js';

const MAX_VISIBLE_RESULTS = 8;
const ACTIVE_REGISTRATION_STATUSES = ['Pending Payment', 'Registered', 'Waitlisted'];

// Lets an admin with the registerOthers permission submit a registration on
// behalf of a member who doesn't use or is afraid of online tools. The event
// is fixed by which card the admin opened this from - only a member needs
// picking, not an event too. Payment defaults to cash/check only - this UI
// has no card entry at all - but an event that doesn't otherwise offer
// cash/check can be overridden case by case (cashCheckOverride below), for a
// member who cannot pay online regardless of the event's own settings. The
// server (create-registration.js) re-checks the same override independently
// rather than trusting this component's disabled state.
function AdminRegisterMemberPanel({ event, existingRegistrations = [], isFull = false, onClose, onRegistered, open, users }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMember, setSelectedMember] = useState(null);
  const [duplicateRegistration, setDuplicateRegistration] = useState(null);
  const [cashCheckOverride, setCashCheckOverride] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const registrantForm = useRegistrantForm();
  const idempotencyKeyRef = useRef(createAttemptKey());

  const eventIsPaid = getIsPaidEvent(event || {});
  const eventAllowsCashCheck = canPayLaterByCashCheck(event || {});
  const canOverrideCashCheck = eventIsPaid && !eventAllowsCashCheck;
  const cashCheckAccepted = eventAllowsCashCheck || (canOverrideCashCheck && cashCheckOverride);
  const unsupported = eventIsPaid && !cashCheckAccepted;

  const filteredMembers = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();

    if (normalized.length < 2) {
      return [];
    }

    return (users || []).filter((member) => getMemberSearchText(member).includes(normalized));
  }, [searchTerm, users]);

  function resetForm() {
    setSearchTerm('');
    setSelectedMember(null);
    setDuplicateRegistration(null);
    setCashCheckOverride(false);
    setFieldErrors({});
    setFormError('');
    registrantForm.reset();
    idempotencyKeyRef.current = createAttemptKey();
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleSelectMember(member) {
    setSelectedMember(member);
    registrantForm.applyProfile(member);
    setSearchTerm('');
    setDuplicateRegistration(findActiveRegistration(existingRegistrations, member));
    setCashCheckOverride(false);
    setFieldErrors({});
    setFormError('');
  }

  function handleChangeMember() {
    setSelectedMember(null);
    setDuplicateRegistration(null);
    setCashCheckOverride(false);
    registrantForm.reset();
    setFieldErrors({});
  }

  async function handleSubmit(event_) {
    event_.preventDefault();
    setFormError('');

    if (!selectedMember) {
      setFormError('Search for and select a member to register.');
      return;
    }

    if (duplicateRegistration) {
      setFormError('This member already has an active registration for this event.');
      return;
    }

    const errors = validateRegistrantFields({
      billingPostalCode: registrantForm.billingPostalCode,
      billingState: registrantForm.billingState,
      firstName: registrantForm.firstName,
      lastName: registrantForm.lastName,
      phone: registrantForm.phone,
      requiresBillingAddress: eventIsPaid
    });

    setFieldErrors(errors);

    if (Object.keys(errors).length) {
      setFormError('Please fix the highlighted fields.');
      return;
    }

    if (unsupported) {
      setFormError('This event requires online card payment, which admin-initiated registration does not support.');
      return;
    }

    setSubmitting(true);

    try {
      const result = await createAdminRegistration({
        allowCashCheckOverride: canOverrideCashCheck && cashCheckOverride,
        email: selectedMember.email || '',
        eventId: event.id,
        idempotencyKey: idempotencyKeyRef.current,
        name: buildDisplayName(registrantForm.firstName, registrantForm.lastName),
        paymentPreference: eventIsPaid && cashCheckAccepted ? 'cash-check-later' : '',
        phone: registrantForm.phone,
        profileUserId: selectedMember.userId || selectedMember.id,
        profileUpdates: {
          billingAddress: buildBillingAddress({
            city: registrantForm.billingCity,
            country: registrantForm.billingCountry,
            postalCode: registrantForm.billingPostalCode,
            state: registrantForm.billingState,
            street: registrantForm.billingStreet
          }),
          firstName: toTitleCase(registrantForm.firstName),
          lastName: toTitleCase(registrantForm.lastName),
          phone: formatPhoneNumber(registrantForm.phone)
        }
      });

      resetForm();
      onRegistered(result);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalDialog
      ariaLabelledBy="admin-register-member-title"
      backdropClassName="registration-modal-backdrop"
      dialogClassName="registration-modal-card"
      onClose={submitting ? undefined : handleClose}
      open={open}
    >
      <div className="form-section-header form-section-header-stacked">
        <div className="form-section-header-top">
          <div>
            <h2 id="admin-register-member-title">Register A Member</h2>
            <p className="section-helper">
              {event?.title || 'This event'} - cash or check payment only.
            </p>
          </div>
          <button
            className="button-link button-reset secondary-action compact-action"
            disabled={submitting}
            type="button"
            onClick={handleClose}
          >
            Close
          </button>
        </div>
      </div>
      <form onSubmit={handleSubmit}>
        {!selectedMember ? (
          <>
            <label>
              <span>Search Members</span>
              <input
                autoFocus
                onChange={(inputEvent) => setSearchTerm(inputEvent.target.value)}
                placeholder="Search by name, email, or phone"
                value={searchTerm}
              />
            </label>
            {searchTerm.trim().length >= 2 ? (
              <div className="admin-register-member-results">
                {filteredMembers.length ? (
                  <>
                    {filteredMembers.slice(0, MAX_VISIBLE_RESULTS).map((member) => (
                      <button
                        className="button-link button-reset secondary-action compact-action admin-register-member-result"
                        key={member.id}
                        type="button"
                        onClick={() => handleSelectMember(member)}
                      >
                        <strong>
                          {buildDisplayName(getProfileFirstName(member), getProfileLastName(member))
                            || member.email
                            || 'Member'}
                        </strong>
                        <span>{member.email}</span>
                      </button>
                    ))}
                    {filteredMembers.length > MAX_VISIBLE_RESULTS ? (
                      <p className="form-help">
                        Showing {MAX_VISIBLE_RESULTS} of {filteredMembers.length} matches - refine your search.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="form-help">No members found.</p>
                )}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="admin-register-member-selected">
              <div>
                <strong>
                  {buildDisplayName(getProfileFirstName(selectedMember), getProfileLastName(selectedMember))
                    || selectedMember.email}
                </strong>
                <span>{selectedMember.email}</span>
              </div>
              <button
                className="button-link button-reset secondary-action compact-action"
                disabled={submitting}
                type="button"
                onClick={handleChangeMember}
              >
                Change
              </button>
            </div>
            {duplicateRegistration ? (
              <p className="form-error">
                {buildDisplayName(getProfileFirstName(selectedMember), getProfileLastName(selectedMember))
                  || selectedMember.email} already has an active registration for this event
                (status: {duplicateRegistration.status}). Use Change to pick a different member,
                or manage the existing registration from the table behind this dialog.
              </p>
            ) : null}
            <div className="registration-profile-edit-grid">
              <label>
                <span>First Name *</span>
                <input
                  className={fieldErrors.firstName ? 'field-invalid' : ''}
                  disabled={submitting}
                  onBlur={(inputEvent) => registrantForm.setFirstName(toTitleCase(inputEvent.target.value))}
                  onChange={(inputEvent) => registrantForm.setFirstName(inputEvent.target.value)}
                  value={registrantForm.firstName}
                />
              </label>
              <label>
                <span>Last Name *</span>
                <input
                  className={fieldErrors.lastName ? 'field-invalid' : ''}
                  disabled={submitting}
                  onBlur={(inputEvent) => registrantForm.setLastName(toTitleCase(inputEvent.target.value))}
                  onChange={(inputEvent) => registrantForm.setLastName(inputEvent.target.value)}
                  value={registrantForm.lastName}
                />
              </label>
              <label>
                <span>Phone *</span>
                <input
                  className={fieldErrors.phone ? 'field-invalid' : ''}
                  disabled={submitting}
                  onChange={(inputEvent) => registrantForm.setPhone(formatPhoneNumber(inputEvent.target.value))}
                  type="tel"
                  value={registrantForm.phone}
                />
              </label>
              <label>
                <span>Street Address</span>
                <input
                  disabled={submitting}
                  onBlur={(inputEvent) => registrantForm.setBillingStreet(toTitleCase(inputEvent.target.value))}
                  onChange={(inputEvent) => registrantForm.setBillingStreet(inputEvent.target.value)}
                  value={registrantForm.billingStreet}
                />
              </label>
              <label>
                <span>City</span>
                <input
                  disabled={submitting}
                  onBlur={(inputEvent) => registrantForm.setBillingCity(toTitleCase(inputEvent.target.value))}
                  onChange={(inputEvent) => registrantForm.setBillingCity(inputEvent.target.value)}
                  value={registrantForm.billingCity}
                />
              </label>
              <label>
                <span>State</span>
                <select
                  className={fieldErrors.billingState ? 'field-invalid' : ''}
                  disabled={submitting}
                  onChange={(inputEvent) => registrantForm.setBillingState(inputEvent.target.value)}
                  value={registrantForm.billingState}
                >
                  <option value="">Select State</option>
                  {US_STATES.map((state) => (
                    <option key={state.value} value={state.value}>
                      {state.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>ZIP Code</span>
                <input
                  className={fieldErrors.billingPostalCode ? 'field-invalid' : ''}
                  disabled={submitting}
                  onChange={(inputEvent) => registrantForm.setBillingPostalCode(inputEvent.target.value)}
                  value={registrantForm.billingPostalCode}
                />
              </label>
            </div>
            {canOverrideCashCheck ? (
              <label className="checkbox-label">
                <input
                  checked={cashCheckOverride}
                  disabled={submitting}
                  type="checkbox"
                  onChange={(inputEvent) => setCashCheckOverride(inputEvent.target.checked)}
                />
                <span>
                  Override: accept cash or check for this registration only, even though this
                  event does not otherwise offer it. Use this only when the member cannot pay
                  online.
                </span>
              </label>
            ) : null}
            {unsupported ? (
              <p className="form-error">
                This event requires online card payment, which admin-initiated registration does
                not support unless the override above is checked. Check it to accept cash or
                check for this registration only, or have the member register themselves.
              </p>
            ) : eventIsPaid ? (
              <p className="form-help">
                This registration will be marked pay by cash or check later. Cost:{' '}
                {formatCurrency(getEventPaymentTotal(event))}.
              </p>
            ) : (
              <p className="form-help">This event is free - no payment is required.</p>
            )}
            {isFull && !unsupported ? (
              <p className="form-help">
                This event is full. {buildDisplayName(getProfileFirstName(selectedMember), getProfileLastName(selectedMember))
                  || 'This member'} will be added to the waitlist instead of an active
                registration.
              </p>
            ) : null}
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="form-actions">
              <button
                className="button-link button-reset"
                disabled={submitting || unsupported || Boolean(duplicateRegistration)}
                type="submit"
              >
                {submitting
                  ? 'Registering...'
                  : isFull && !unsupported
                    ? 'Add Member To Waitlist'
                    : 'Register Member'}
              </button>
              <button
                className="button-link button-reset secondary-action"
                disabled={submitting}
                type="button"
                onClick={handleClose}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </form>
    </ModalDialog>
  );
}

// Mirrors create-registration.js's alreadyRegistered check (same status list,
// same userId-or-email match) so the admin sees this before filling out the
// rest of the form, not as a submit-time server error.
function findActiveRegistration(registrations, member) {
  const memberUserId = member?.userId || member?.id || '';
  const memberEmail = normalizeEmail(member?.email);

  return (registrations || []).find((registration) => {
    if (!ACTIVE_REGISTRATION_STATUSES.includes(registration.status)) {
      return false;
    }

    return (memberUserId && registration.userId === memberUserId)
      || (memberEmail && normalizeEmail(registration.email) === memberEmail);
  }) || null;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getMemberSearchText(member) {
  return [
    member.name,
    getProfileFirstName(member),
    getProfileLastName(member),
    member.email,
    member.phone
  ].filter(Boolean).join(' ').toLowerCase();
}

function validateRegistrantFields({
  billingPostalCode,
  billingState,
  firstName,
  lastName,
  phone,
  requiresBillingAddress
}) {
  const errors = {};

  if (!firstName.trim()) {
    errors.firstName = 'First name is required.';
  }

  if (!lastName.trim()) {
    errors.lastName = 'Last name is required.';
  }

  if (phone.replace(/\D/g, '').length < 10) {
    errors.phone = 'A 10-digit phone number is required.';
  }

  if (requiresBillingAddress) {
    if (billingState && billingState.length !== 2) {
      errors.billingState = 'Use the two-letter state code.';
    }

    if (billingPostalCode && billingPostalCode.trim().length < 5) {
      errors.billingPostalCode = 'ZIP code should be at least 5 characters.';
    }
  }

  return errors;
}

function createAttemptKey() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default AdminRegisterMemberPanel;
