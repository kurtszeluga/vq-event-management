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

// Lets an admin with the registerOthers permission submit a registration on
// behalf of a member who doesn't use or is afraid of online tools. The event
// is fixed by which card the admin opened this from - only a member needs
// picking, not an event too. Payment is cash/check only: this UI has no card
// entry at all, matching createAdminRegistration/create-registration.js's
// server-side guard, which refuses a paid event with no cash/check option
// regardless of what this form does.
function AdminRegisterMemberPanel({ event, onClose, onRegistered, open, users }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMember, setSelectedMember] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const registrantForm = useRegistrantForm();
  const idempotencyKeyRef = useRef(createAttemptKey());

  const eventIsPaid = getIsPaidEvent(event || {});
  const eventAllowsCashCheck = canPayLaterByCashCheck(event || {});
  // The trigger that opens this panel is already disabled for this case
  // (see RegistrationPanel.jsx); this is the same check repeated here as a
  // guard against stale event data, not the primary defense.
  const unsupported = eventIsPaid && !eventAllowsCashCheck;

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
    setFieldErrors({});
    setFormError('');
  }

  function handleChangeMember() {
    setSelectedMember(null);
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
        email: selectedMember.email || '',
        eventId: event.id,
        idempotencyKey: idempotencyKeyRef.current,
        name: buildDisplayName(registrantForm.firstName, registrantForm.lastName),
        paymentPreference: eventAllowsCashCheck && eventIsPaid ? 'cash-check-later' : '',
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
            {unsupported ? (
              <p className="form-error">
                This event requires online card payment, which admin-initiated registration does
                not support. Enable cash or check payment for this event, or have the member
                register themselves.
              </p>
            ) : eventIsPaid ? (
              <p className="form-help">
                This registration will be marked pay by cash or check later. Cost:{' '}
                {formatCurrency(getEventPaymentTotal(event))}.
              </p>
            ) : (
              <p className="form-help">This event is free - no payment is required.</p>
            )}
            {formError ? <p className="form-error">{formError}</p> : null}
            <div className="form-actions">
              <button className="button-link button-reset" disabled={submitting || unsupported} type="submit">
                {submitting ? 'Registering...' : 'Register Member'}
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
